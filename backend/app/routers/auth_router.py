import asyncio
import logging
import time
from collections import defaultdict
from fastapi import APIRouter, HTTPException, Response, Depends, Request
from app.schemas import LoginRequest, UserResponse
from typing import Optional
from pydantic import BaseModel
from app.auth import (
    hash_password,
    verify_password_async,
    create_token,
    hash_password_async,
    require_real_user,
    resolve_request_credentials,
)
from app.config import settings
from app.database import get_db
from app.services.client_ip import client_ip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Simple in-memory rate limiter for login: max 5 attempts per IP per 60 seconds
_login_attempts: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_MAX = 5
_RATE_LIMIT_WINDOW = 60  # seconds

# Pre-computed bcrypt hash for the constant-time login path. Verifying
# against this when the username doesn't exist (or is a shell account with
# password_hash='!') keeps the wall-time of failed logins indistinguishable
# from successful ones, so an attacker can't enumerate usernames by timing.
_DUMMY_PASSWORD_HASH = hash_password("dummy-constant-time-guard")


def _check_rate_limit(ip: str):
    now = time.monotonic()
    attempts = _login_attempts[ip]
    # Prune old entries
    _login_attempts[ip] = [t for t in attempts if now - t < _RATE_LIMIT_WINDOW]
    if len(_login_attempts[ip]) >= _RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please wait before trying again.",
        )
    _login_attempts[ip].append(now)


@router.post("/login")
async def login(body: LoginRequest, request: Request, response: Response):
    _check_rate_limit(client_ip(request))

    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, username, password_hash, role, display_name, email FROM users WHERE username = ? AND deleted_at IS NULL",
        (body.username,),
    )

    # 1. Local password path. Shell accounts (password_hash='!') always fail
    #    this check so bcrypt can't coincidentally accept an empty / short
    #    password; they must sign in via SSO or LDAP instead.
    user = None
    if rows and rows[0]["password_hash"] != "!":
        if await verify_password_async(body.password, rows[0]["password_hash"]):
            user = dict(rows[0])
    else:
        # Equalise wall-time against the username-not-found / SSO-only-user
        # paths so login latency doesn't enumerate usernames.
        await verify_password_async(body.password, _DUMMY_PASSWORD_HASH)

    # 2. LDAP fallback. The service is imported lazily so sites without LDAP
    #    never pay the `ldap3` import cost on every login attempt.
    if user is None and settings.LDAP_ENABLED:
        from app.services import ldap_auth
        try:
            lu = await ldap_auth.authenticate(body.username, body.password)
        except ldap_auth.LdapError as e:
            # Configuration/connectivity problem — log but still return 401
            # rather than 500 so a misconfigured LDAP doesn't reveal to the
            # world that LDAP is enabled.
            logger.error("LDAP login error: %s", e)
            lu = None
        if lu is not None:
            try:
                user = await ldap_auth.provision_ldap_user(db, lu)
            except ldap_auth.LdapError as e:
                # Takeover guard tripped (username collision with a local user).
                raise HTTPException(status_code=403, detail=str(e))

    if user is None:
        logger.warning(
            "login failed for user=%r ip=%s", body.username, client_ip(request)
        )
        # The in-memory counter resets on process restart, so add a fixed
        # latency cost on top of bcrypt to keep brute-force throughput low
        # even in restart-loop scenarios. Tiny enough that a real user
        # mistyping their password barely notices.
        await asyncio.sleep(0.5)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    logger.info("login ok user=%s role=%s", user["username"], user["role"])
    token = create_token(user["id"], user["username"], user["role"])
    response.set_cookie(
        key="token",
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        max_age=86400,
    )
    return {
        "user": {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
            "display_name": user["display_name"] or "",
            "email": user["email"] or "",
        },
    }


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("token")
    return {"ok": True}


@router.get("/me", response_model=UserResponse)
async def me(request: Request):
    # Always 401 when there's no real session, even with ANONYMOUS_READ on.
    # The frontend uses this 401 to detect "I'm a guest" vs "I'm logged in";
    # if /me silently returned the synthetic guest, the UI couldn't tell
    # the difference and would render the logged-in chrome.
    user = await resolve_request_credentials(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None


@router.get("/profile")
async def get_profile(user=Depends(require_real_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, username, role, display_name, email, created_at FROM users WHERE id = ?",
        (user["id"],),
    )
    return dict(rows[0])


@router.put("/profile")
async def update_profile(body: ProfileUpdateRequest, user=Depends(require_real_user)):
    db = await get_db()
    updates = []
    values = []
    if body.display_name is not None:
        updates.append("display_name = ?")
        values.append(body.display_name)
    if body.email is not None:
        updates.append("email = ?")
        values.append(body.email)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    values.append(user["id"])
    await db.execute(
        f"UPDATE users SET {', '.join(updates)} WHERE id = ?", values
    )
    await db.commit()

    rows = await db.execute_fetchall(
        "SELECT id, username, role, display_name, email, created_at FROM users WHERE id = ?",
        (user["id"],),
    )
    return dict(rows[0])


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@router.put("/password")
async def change_password(body: ChangePasswordRequest, user=Depends(require_real_user)):
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT password_hash FROM users WHERE id = ?", (user["id"],)
    )
    if not rows:
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    # SSO/LDAP-only accounts carry the sentinel hash '!'; bcrypt raises on
    # that value, which would surface as a 500. Block the path cleanly.
    if rows[0]["password_hash"] == "!":
        raise HTTPException(
            status_code=400,
            detail="This account is managed by SSO/LDAP; password cannot be changed here.",
        )
    if not await verify_password_async(body.old_password, rows[0]["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    await db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (await hash_password_async(body.new_password), user["id"]),
    )
    await db.commit()
    return {"ok": True}
