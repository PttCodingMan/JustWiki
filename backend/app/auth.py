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

# Synthetic id for the guest user produced when ANONYMOUS_READ is on and
# the request carries no valid credentials. The users table starts at 1
# (AUTOINCREMENT), so 0 cannot collide with any real account.
ANONYMOUS_USER_ID = 0


def anonymous_user() -> dict:
    """Synthetic viewer used when ANONYMOUS_READ=true and creds are absent.

    Carries the `anonymous=True` flag so write endpoints can reject it via
    `require_real_user` and the ACL layer can short-circuit cheaply.
    """
    return {
        "id": ANONYMOUS_USER_ID,
        "username": "guest",
        "role": "viewer",
        "display_name": "Guest",
        "email": "",
        "anonymous": True,
    }


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
    return jwt.encode(payload, settings.SECRET_KEY.get_secret_value(), algorithm=ALGORITHM)


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


async def resolve_request_credentials(request: Request) -> dict | None:
    """Decode whichever credential the request carries, or return None.

    Recognises both personal API tokens (prefixed with `jwk_`) and JWT
    session tokens, read from `Authorization: Bearer` first and falling
    back to the `token` cookie. Returns the resolved user dict on success
    and None on any failure (no token, invalid token, missing user). The
    caller decides whether to raise 401 or treat it as anonymous.
    """
    token = None
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.cookies.get("token")
    if not token:
        return None

    if token.startswith(API_TOKEN_PREFIX):
        return await _resolve_api_token(token)

    try:
        payload = jwt.decode(token, settings.SECRET_KEY.get_secret_value(), algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        return None

    db = await get_db()
    row = await db.execute_fetchall(
        "SELECT id, username, role, display_name, email FROM users WHERE id = ? AND deleted_at IS NULL",
        (user_id,),
    )
    if not row:
        return None
    return dict(row[0])


async def get_current_user(request: Request):
    user = await resolve_request_credentials(request)
    if user is not None:
        return user
    # When ANONYMOUS_READ is on, fall through to a synthetic guest viewer
    # rather than 401. ACL caps viewers at `read` and write/admin endpoints
    # use `require_real_user` / `require_admin` to reject the guest, so this
    # opens reads without affecting writes.
    if settings.ANONYMOUS_READ:
        return anonymous_user()
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
    )


async def get_optional_user(request: Request) -> dict | None:
    """Same credential resolution as `get_current_user` but returns None
    instead of raising on missing/invalid credentials. Use for endpoints
    that serve both authenticated and anonymous traffic (e.g. media
    files referenced by public pages)."""
    return await resolve_request_credentials(request)


async def require_real_user(user=Depends(get_current_user)):
    """Reject the synthetic anonymous user.

    Use on endpoints that don't go through ACL (bookmarks, comments POST,
    tokens, notifications, watch, profile, password, ai). ACL-gated writes
    don't need this — viewer cap turns them into 403 automatically.
    """
    if user.get("anonymous"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Login required",
        )
    return user


async def require_admin(user=Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin required")
    return user


async def ensure_admin_exists():
    db = await get_db()
    rows = await db.execute_fetchall("SELECT id FROM users WHERE role = 'admin'")
    if not rows:
        pw_hash = hash_password(settings.ADMIN_PASS.get_secret_value())
        await db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
            (settings.ADMIN_USER, pw_hash),
        )
        await db.commit()
