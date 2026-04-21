import time
from collections import defaultdict
from fastapi import APIRouter, HTTPException, Response, Depends, Request
from app.schemas import LoginRequest, UserResponse
from typing import Optional
from pydantic import BaseModel
from app.auth import verify_password, create_token, get_current_user, hash_password
from app.config import settings
from app.database import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Simple in-memory rate limiter for login: max 5 attempts per IP per 60 seconds
_login_attempts: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_MAX = 5
_RATE_LIMIT_WINDOW = 60  # seconds


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
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, username, password_hash, role, display_name, email FROM users WHERE username = ? AND deleted_at IS NULL",
        (body.username,),
    )

    # 1. Local password path. Shell accounts (password_hash='!') always fail
    #    this check so bcrypt can't coincidentally accept an empty / short
    #    password; they must sign in via SSO or LDAP instead.
    user = None
    if rows and rows[0]["password_hash"] != "!" and verify_password(body.password, rows[0]["password_hash"]):
        user = dict(rows[0])

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
            import logging
            logging.getLogger(__name__).error("LDAP login error: %s", e)
            lu = None
        if lu is not None:
            try:
                user = await ldap_auth.provision_ldap_user(db, lu)
            except ldap_auth.LdapError as e:
                # Takeover guard tripped (username collision with a local user).
                raise HTTPException(status_code=403, detail=str(e))

    if user is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")

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
async def me(user=Depends(get_current_user)):
    return user


class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None


@router.get("/profile")
async def get_profile(user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, username, role, display_name, email, created_at FROM users WHERE id = ?",
        (user["id"],),
    )
    return dict(rows[0])


@router.put("/profile")
async def update_profile(body: ProfileUpdateRequest, user=Depends(get_current_user)):
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
async def change_password(body: ChangePasswordRequest, user=Depends(get_current_user)):
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT password_hash FROM users WHERE id = ?", (user["id"],)
    )
    if not rows or not verify_password(body.old_password, rows[0]["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    await db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (hash_password(body.new_password), user["id"]),
    )
    await db.commit()
    return {"ok": True}
