from pydantic import SecretStr
from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # Secrets use SecretStr so `repr(settings)` / a debug dump / a stray
    # log line can't leak them. Read the plaintext at the point of use
    # via `.get_secret_value()`.
    SECRET_KEY: SecretStr = SecretStr("change-me-to-random-string")
    ADMIN_USER: str = "admin"
    ADMIN_PASS: SecretStr = SecretStr("admin")

    DATA_DIR: str = "./data"
    DB_PATH: str = "./data/just-wiki.db"
    MEDIA_DIR: str = "./data/media"

    COOKIE_SECURE: bool = False  # Set to True in production with HTTPS

    # Comma-separated list of origins allowed for CSRF/CORS on top of the
    # always-included localhost dev origins. Set this to your public URL(s)
    # in production, e.g. "https://wiki.example.com".
    ALLOWED_ORIGINS: str = ""

    # When deployed behind a reverse proxy (nginx/Caddy/ALB/Traefik), the
    # direct TCP peer is the proxy — rate limiters keyed on `request.client.host`
    # then see every client as the same IP and either deny everyone or no-one.
    # Setting this to True makes the rate limiters trust the left-most
    # `X-Forwarded-For` entry. Only enable this when a trusted proxy is
    # actually in front of the app; otherwise a client can spoof the header.
    TRUST_PROXY: bool = False

    # Public base URL the browser can reach. Used to build OIDC redirect_uri
    # and SSO-error redirects. In dev leave as localhost:8000; in prod set to
    # e.g. "https://wiki.example.com".
    PUBLIC_BASE_URL: str = "http://localhost:8000"

    # ── OIDC / OAuth SSO (optional) ──
    OIDC_ENABLED: bool = False
    OIDC_PROVIDERS: str = ""             # comma-separated: google,github,generic

    # When True, requests without valid credentials are treated as a
    # synthetic "guest" viewer (id=0, role=viewer) instead of being rejected
    # with 401. ACL still gates access — guests only see pages with no ACL
    # anchor in their parent chain (the open-default set). All write/admin
    # endpoints remain login-required (see auth.require_real_user).
    # Default off so existing private-wiki deployments are unaffected.
    ANONYMOUS_READ: bool = False

    # Access-control layers. Any rule that is set and does not match → 403.
    OIDC_ALLOW_SIGNUP: bool = False      # if False, only pre-provisioned users
    OIDC_ALLOWED_EMAILS: str = ""        # comma-separated individual whitelist
    OIDC_ALLOWED_EMAIL_DOMAINS: str = ""  # comma-separated domain whitelist
    OIDC_REQUIRED_GROUPS: str = ""       # IdP must return these in groups claim
    OIDC_DEFAULT_ROLE: str = "editor"    # role for newly signed-up users

    # Google
    OIDC_GOOGLE_CLIENT_ID: str = ""
    OIDC_GOOGLE_CLIENT_SECRET: SecretStr = SecretStr("")
    OIDC_GOOGLE_DISCOVERY: str = (
        "https://accounts.google.com/.well-known/openid-configuration"
    )

    # GitHub (non-OIDC OAuth2; no discovery URL)
    OIDC_GITHUB_CLIENT_ID: str = ""
    OIDC_GITHUB_CLIENT_SECRET: SecretStr = SecretStr("")

    # Generic OIDC (Keycloak / Authentik / Okta / self-hosted IdP)
    OIDC_GENERIC_NAME: str = "Company SSO"
    OIDC_GENERIC_CLIENT_ID: str = ""
    OIDC_GENERIC_CLIENT_SECRET: SecretStr = SecretStr("")
    OIDC_GENERIC_DISCOVERY: str = ""

    # ── LDAP / Active Directory (optional) ──
    LDAP_ENABLED: bool = False
    LDAP_SERVER: str = ""                # must be ldaps:// unless TLS disabled
    LDAP_TLS_VERIFY: bool = True
    LDAP_BIND_DN: str = ""
    LDAP_BIND_PASSWORD: SecretStr = SecretStr("")
    LDAP_USER_BASE: str = ""
    LDAP_USER_FILTER: str = "(&(objectClass=person)(uid={username}))"
    LDAP_ATTR_EMAIL: str = "mail"
    LDAP_ATTR_DISPLAY_NAME: str = "displayName"
    LDAP_DEFAULT_ROLE: str = "editor"

    LDAP_SYNC_GROUPS: bool = False
    LDAP_GROUP_BASE: str = ""
    LDAP_GROUP_FILTER: str = "(&(objectClass=groupOfNames)(member={user_dn}))"
    LDAP_ADMIN_GROUPS: str = ""          # CNs that grant role=admin

    # ── AI chat (optional, OpenAI-compatible) ──
    # Default targets Gemini's OpenAI-compatible endpoint, but any provider
    # that speaks the same wire format works (OpenAI, Ollama, Groq, DeepSeek…).
    AI_ENABLED: bool = False
    AI_BASE_URL: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    AI_API_KEY: SecretStr = SecretStr("")
    AI_MODEL: str = "gemini-2.0-flash"
    AI_MAX_CONTEXT_PAGES: int = 5       # top-K pages stuffed into the prompt
    AI_EXCERPT_CHARS: int = 1500        # max chars per page content excerpt
    AI_RATE_LIMIT_PER_HOUR: int = 20    # per-user request cap
    # Legacy; kept as a read-only alias so existing deployments don't break.
    # Use AI_API_KEY instead.
    GEMINI_API_KEY: SecretStr = SecretStr("")

    # Dashboard / updates
    # Off by default so air-gapped installs never make an outbound call.
    CHECK_UPDATES: bool = False
    # Repo on ghcr.io for the image-tag lookup. Matches docker-compose.yml.
    UPDATE_CHECK_IMAGE: str = "pttcodingman/justwiki/backend"

    # Repeat views by the same user within this window don't re-increment
    # a page's view_count. Keeps counts meaningful across refreshes / tab
    # switches without permanently storing per-user reading history.
    VIEW_DEDUP_MINUTES: int = 30

    # Look for .env in both the cwd (docker image's /app) and the repo root
    # one directory up (so `make dev-backend`, which cds into backend/, still
    # picks up the project-root .env). pydantic-settings uses the first file
    # that exists.
    #
    # extra='ignore' so renaming/removing a setting doesn't crash on existing
    # deployments where the user's .env still has the old key.
    model_config = {
        "env_file": (".env", "../.env"),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()

# Ensure directories exist
Path(settings.DATA_DIR).mkdir(parents=True, exist_ok=True)
Path(settings.MEDIA_DIR).mkdir(parents=True, exist_ok=True)
