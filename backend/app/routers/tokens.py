"""Personal API token management.

Endpoints let the authenticated user list, create, and revoke their own
tokens. Tokens inherit the owner's role and ACLs — there is no finer-grained
scoping. Plaintext is shown **once** on creation and never stored; only the
SHA-256 hash lives in the DB. A revoked token keeps its row so that the
audit trail (and any `last_used` timestamp) survives.

Viewers can't create tokens because a viewer can't do anything with one
either. Revoking and listing stay available to every authenticated user.
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import (
    API_TOKEN_DISPLAY_PREFIX_LEN,
    API_TOKEN_PREFIX,
    get_current_user,
    hash_api_token,
)
from app.database import get_db
from app.routers.activity import log_activity

router = APIRouter(prefix="/api/auth/tokens", tags=["tokens"])

# Default lifetime for a new token. Callers can override down to 1 or up to
# 365 days, or pass 0 to mean "never expires". The cap stops a token from
# silently outliving the user that created it.
_DEFAULT_EXPIRES_DAYS = 30
_MAX_EXPIRES_DAYS = 365


class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    expires_in_days: Optional[int] = Field(
        default=_DEFAULT_EXPIRES_DAYS,
        ge=0,
        le=_MAX_EXPIRES_DAYS,
        description="0 = never expires",
    )


class TokenResponse(BaseModel):
    id: int
    name: str
    prefix: Optional[str] = None
    created_at: Optional[str] = None
    last_used: Optional[str] = None
    expires_at: Optional[str] = None
    revoked_at: Optional[str] = None


class TokenCreateResponse(TokenResponse):
    token: str  # plaintext — shown exactly once


def _generate_plaintext() -> str:
    """Return a fresh `jwk_<random>` token string.

    32 bytes of randomness encoded urlsafe-b64 (no padding) comes out to
    ≈43 chars, which fits comfortably in a header alongside the 4-char
    prefix.
    """
    body = secrets.token_urlsafe(32).rstrip("=")
    return f"{API_TOKEN_PREFIX}{body}"


@router.get("", response_model=list[TokenResponse])
async def list_tokens(user=Depends(get_current_user)):
    """List the caller's own tokens (plaintext is not included)."""
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT id, name, prefix, created_at, last_used, expires_at, revoked_at
           FROM api_tokens
           WHERE user_id = ?
           ORDER BY revoked_at IS NOT NULL, created_at DESC""",
        (user["id"],),
    )
    return [dict(r) for r in rows]


@router.post("", response_model=TokenCreateResponse, status_code=201)
async def create_token(
    body: TokenCreate,
    request: Request,
    user=Depends(get_current_user),
):
    # Refuse if the caller authenticated using an API token themselves.
    # Otherwise a stolen token could be used to mint a replacement that
    # outlives the victim revoking the original.
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith(f"Bearer {API_TOKEN_PREFIX}"):
        raise HTTPException(
            status_code=403,
            detail="API tokens cannot create other API tokens; sign in as the user",
        )

    if user.get("role") == "viewer":
        raise HTTPException(
            status_code=403, detail="Viewers cannot create API tokens"
        )

    plaintext = _generate_plaintext()
    prefix = plaintext[:API_TOKEN_DISPLAY_PREFIX_LEN]
    expires_at: Optional[str] = None
    if body.expires_in_days and body.expires_in_days > 0:
        exp = datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)
        # Store in the same textual shape SQLite uses for CURRENT_TIMESTAMP so
        # the resolver can parse both rows written here and any legacy rows
        # written by CURRENT_TIMESTAMP defaults without branching.
        expires_at = exp.strftime("%Y-%m-%d %H:%M:%S")

    db = await get_db()
    cursor = await db.execute(
        """INSERT INTO api_tokens (user_id, name, token_hash, prefix, expires_at)
           VALUES (?, ?, ?, ?, ?)""",
        (user["id"], body.name, hash_api_token(plaintext), prefix, expires_at),
    )
    token_id = cursor.lastrowid
    await log_activity(
        db, user["id"], "created", "api_token", token_id,
        {"name": body.name, "expires_at": expires_at},
    )
    await db.commit()

    rows = await db.execute_fetchall(
        """SELECT id, name, prefix, created_at, last_used, expires_at, revoked_at
           FROM api_tokens WHERE id = ?""",
        (token_id,),
    )
    result = dict(rows[0])
    result["token"] = plaintext
    return result


@router.delete("/{token_id}", status_code=204)
async def revoke_token(token_id: int, user=Depends(get_current_user)):
    """Revoke one of the caller's tokens. Already-revoked is a no-op.

    The row stays in place so the audit log entry still has a target.
    """
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, user_id, name, revoked_at FROM api_tokens WHERE id = ?",
        (token_id,),
    )
    if not rows or rows[0]["user_id"] != user["id"]:
        # Treat cross-user probes as "not found" so an attacker can't
        # enumerate someone else's token ids.
        raise HTTPException(status_code=404, detail="Token not found")
    if rows[0]["revoked_at"] is not None:
        return

    await db.execute(
        "UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?",
        (token_id,),
    )
    await log_activity(
        db, user["id"], "revoked", "api_token", token_id,
        {"name": rows[0]["name"]},
    )
    await db.commit()
