import hashlib
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, status, Request
from jose import JWTError, jwt
import bcrypt

from app.config import settings
from app.database import get_db

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24

# Personal API tokens use a fixed prefix so the auth path can branch on
# token shape alone — no need to probe the DB for every request. 32 random
# bytes (urlsafe-base64, ≈43 chars) give >128 bits of entropy, which is
# comfortably larger than the HMAC secret for a forged JWT.
API_TOKEN_PREFIX = "jwk_"
API_TOKEN_DISPLAY_PREFIX_LEN = 12  # "jwk_" + 8 chars shown in the UI


def hash_api_token(token: str) -> str:
    """Return the canonical hash we store in api_tokens.token_hash.

    Plain SHA-256 is fine here: the input is already 32 bytes of
    cryptographic randomness, so a slow KDF would only add latency without
    raising the bar for an attacker who's already stolen the DB.
    """
    return hashlib.sha256(token.encode()).hexdigest()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(user_id: int, username: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


async def _resolve_api_token(token: str) -> dict | None:
    """Look up a personal API token and return the owning user dict, or None.

    Bumps `last_used` on hit. Rejects tokens that are revoked or past their
    `expires_at`; both paths simply return None so the caller emits a single
    generic 401 rather than leaking token state.
    """
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT t.id, t.expires_at, t.revoked_at,
                  u.id AS user_id, u.username, u.role, u.display_name, u.email,
                  u.deleted_at
           FROM api_tokens t
           JOIN users u ON u.id = t.user_id
           WHERE t.token_hash = ?""",
        (hash_api_token(token),),
    )
    if not rows:
        return None
    row = dict(rows[0])
    if row["deleted_at"] is not None or row["revoked_at"] is not None:
        return None
    if row["expires_at"] is not None:
        # SQLite stores these as strings; parse tolerantly so 'YYYY-MM-DD HH:MM:SS'
        # and ISO8601 both round-trip. A naive datetime is interpreted as UTC,
        # matching how create-token writes it below.
        try:
            exp = datetime.fromisoformat(str(row["expires_at"]).replace(" ", "T"))
        except ValueError:
            exp = None
        if exp is not None:
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp <= datetime.now(timezone.utc):
                return None

    await db.execute(
        "UPDATE api_tokens SET last_used = CURRENT_TIMESTAMP WHERE id = ?",
        (row["id"],),
    )
    await db.commit()

    return {
        "id": row["user_id"],
        "username": row["username"],
        "role": row["role"],
        "display_name": row["display_name"],
        "email": row["email"],
    }


async def get_current_user(request: Request):
    token = None

    # Check Authorization header
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:]

    # Check cookie
    if not token:
        token = request.cookies.get("token")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    # Personal API tokens are distinguished by a fixed prefix so we don't
    # have to guess-and-fall-back. Anything else must parse as a JWT.
    if token.startswith(API_TOKEN_PREFIX):
        user = await _resolve_api_token(token)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token",
            )
        return user

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )

    db = await get_db()
    row = await db.execute_fetchall(
        "SELECT id, username, role, display_name, email FROM users WHERE id = ? AND deleted_at IS NULL",
        (user_id,),
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return dict(row[0])


async def require_admin(user=Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin required")
    return user


async def ensure_admin_exists():
    db = await get_db()
    rows = await db.execute_fetchall("SELECT id FROM users WHERE role = 'admin'")
    if not rows:
        pw_hash = hash_password(settings.ADMIN_PASS)
        await db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
            (settings.ADMIN_USER, pw_hash),
        )
        await db.commit()
