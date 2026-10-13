"""Local-account helpers shared by admin invites, OIDC, and LDAP provisioning."""
import re

# Sentinel password hash for SSO/LDAP-only and invited-but-not-yet-logged-in
# accounts: bcrypt can never match it, so password login is impossible.
DISABLED_PASSWORD_HASH = "!"

_USERNAME_CLEAN = re.compile(r"[^a-zA-Z0-9._-]")


def derive_username(email: str) -> str:
    local = email.split("@", 1)[0]
    return _USERNAME_CLEAN.sub("-", local).strip("-") or "user"


async def pick_unique_username(db, base: str) -> str | None:
    """Return the first free name among `base`, `base-2` … `base-99`, else None."""
    for cand in [base] + [f"{base}-{i}" for i in range(2, 100)]:
        if not await db.execute_fetchall(
            "SELECT 1 FROM users WHERE username = ? LIMIT 1", (cand,)
        ):
            return cand
    return None


async def link_identity(db, user_id: int, provider: str, subject: str, email) -> None:
    await db.execute(
        """INSERT INTO auth_identities (user_id, provider, subject, email, last_login_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)""",
        (user_id, provider, subject, email),
    )


async def create_sso_user(
    db, username: str, role: str, display_name, email, provider: str, subject: str
) -> int:
    """Insert a password-less user plus its linked identity; return the new user id."""
    cursor = await db.execute(
        """INSERT INTO users (username, password_hash, role, display_name, email)
           VALUES (?, ?, ?, ?, ?)""",
        (username, DISABLED_PASSWORD_HASH, role, display_name, email),
    )
    await link_identity(db, cursor.lastrowid, provider, subject, email)
    return cursor.lastrowid
