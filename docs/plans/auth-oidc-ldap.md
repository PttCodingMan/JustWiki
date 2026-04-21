# Plan — 支援 OIDC (方案 1) 與 LDAP (方案 2) 登入

> Status: APPROVED · Effort: **M** (OIDC, 含多 provider) + **S** (LDAP) · 建議分 2 個 PR
>
> **Final decisions (2026-04-21):**
> - Providers 首發：Google + GitHub + generic OIDC（拿掉 Microsoft；之後按需求加）
> - LDAP group sync：**做**
> - `authlib` 依賴：接受
> - Base URL：新增 `PUBLIC_BASE_URL` setting，OIDC redirect_uri 用它組
> - GitHub private email：降級為「叫 `/user/emails` 拿 primary；仍無 → 403，訊息叫使用者把 GitHub email 設成 public」
> - OAuth 錯誤回前端：callback fail 時 302 到 `/login?error=<code>`，Login 頁讀 query string 顯示
> - Invite role：invite endpoint 收 role 參數（editor / viewer / admin），不走 `OIDC_DEFAULT_ROLE`

## 1. 目標
讓 JustWiki 在既有本地帳密（`backend/app/auth.py`）之外，支援：
1. **OIDC / OAuth SSO** — Google、Microsoft、GitHub，以及任何符合 OIDC Discovery 的自架 IdP（Keycloak、Authentik）。
2. **LDAP / Active Directory** — 透過 bind 驗證，首次登入自動 provision。

兩者都沿用現有的 JWT httpOnly cookie session，不動 router / ACL。

## 2. 現況
- `users` 表假設 `password_hash NOT NULL`（`backend/app/database.py:22`）。
- `POST /api/auth/login` 只查本地 `users` 表（`backend/app/routers/auth_router.py:32-63`）。
- 前端 Login 頁是單純 username/password form（`frontend/src/pages/Login.jsx`）。
- Settings 透過 `.env` + pydantic-settings 載入（`backend/app/config.py`）。
- Schema migration 已有 versioned ledger（`backend/app/migrations.py`）。

## 3. 設計

### 3.1 身份模型（兩方案共用）
新增 `auth_identities` 表，而非在 `users` 上加欄位。原因：同一個 user 可同時有本地密碼 + 多個 SSO 綁定（例如管理員關閉 SSO 時仍能用密碼救援）。

```sql
CREATE TABLE auth_identities (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL,     -- 'oidc:google' | 'oidc:github' | 'ldap'
    subject       TEXT NOT NULL,     -- OIDC `sub` claim / LDAP DN
    email         TEXT,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP,
    UNIQUE(provider, subject)
);
CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);
```

`users.password_hash` 保留 `NOT NULL`，SSO-only 使用者寫入 sentinel `!`（shadow 檔慣例的「不可登入」佔位），`verify_password` 自然會 fail，不需 SQLite 12-step table rebuild。

Migration `v6_auth_identities` append 到 `MIGRATIONS` 尾端；對既有 DB 無破壞。

### 3.2 OIDC — 方案 1（從 day 1 就多 provider）

**Lib**：`authlib` — 成熟、FastAPI 官方範例採用，自動處理 state / nonce / id_token 驗章 / PKCE。不自幹，否則容易漏掉 security 細節。

**架構：Provider registry pattern**。Router 不認 provider 名稱，只認 `{provider}` path param，邏輯一律 `PROVIDERS[provider].authenticate(...)`。純 OIDC provider 共用同一個 class，只改 config；GitHub 這類非標準 OAuth2 寫成子類。這樣新增 provider 幾乎零 code。

```python
# backend/app/services/oidc.py
class OIDCProvider:
    def __init__(self, id, name, discovery_url, client_id, client_secret, scope):
        ...
    async def authorize_redirect(self, request, redirect_uri): ...
    async def authenticate(self, request) -> UserInfo: ...  # → (sub, email, email_verified, name)

class GitHubProvider(OIDCProvider):
    # 非 OIDC：沒有 id_token、沒 email_verified、primary email 可能 private
    async def authenticate(self, request) -> UserInfo:
        token = await self._exchange_code(request)
        user = await self._get("https://api.github.com/user", token)
        emails = await self._get("https://api.github.com/user/emails", token)
        ...

PROVIDERS = _build_registry_from_settings()  # 依 OIDC_PROVIDERS 載入
```

**Config**（`.env`）：啟用的 provider 列在 `OIDC_PROVIDERS`，每個 provider 三個變數（client_id / secret / discovery_url；GitHub 不需 discovery）。泛用 OIDC（Keycloak / Authentik / Okta）用 `generic` provider id：
```
OIDC_ENABLED=false
OIDC_PROVIDERS=google,github,generic     # 逗號分隔啟用清單
PUBLIC_BASE_URL=http://localhost:8000    # 用來組 redirect_uri；prod 必填

# ── 誰可以登入（見 §3.2.1 詳細說明）──
# 由嚴到鬆，可疊用；任何一項不通過即拒絕。
OIDC_ALLOW_SIGNUP=false                 # 預設 invitation-only：只允許 link 既有 user
OIDC_ALLOWED_EMAILS=                    # 逗號分隔；非空時只有這些 email 能登入
OIDC_ALLOWED_EMAIL_DOMAINS=             # 逗號分隔；非空時限定 email domain
OIDC_REQUIRED_GROUPS=                   # 逗號分隔；IdP 必須回傳對應 groups claim
OIDC_DEFAULT_ROLE=editor                # signup 開啟時，新帳號的 role

OIDC_GOOGLE_CLIENT_ID=...
OIDC_GOOGLE_CLIENT_SECRET=...
# Google discovery URL 有 sane default，可省略
OIDC_GOOGLE_DISCOVERY=https://accounts.google.com/.well-known/openid-configuration

OIDC_GITHUB_CLIENT_ID=...
OIDC_GITHUB_CLIENT_SECRET=...
# GitHub 走 OAuth2 + /user API，無 discovery

# 泛用自架 IdP（Keycloak、Authentik、Okta…）
OIDC_GENERIC_NAME="Company SSO"         # 顯示在 Login 按鈕上
OIDC_GENERIC_CLIENT_ID=...
OIDC_GENERIC_CLIENT_SECRET=...
OIDC_GENERIC_DISCOVERY=https://sso.example.com/application/o/justwiki/.well-known/openid-configuration
```

**Endpoints**（新增 `backend/app/routers/oauth_router.py`）：
- `GET /api/auth/providers` — 回傳 `[{id, name, icon}]`，前端用來 render 按鈕
- `GET /api/auth/oauth/{provider}/login?redirect=/foo` — 產 state + PKCE 存 httpOnly cookie，302 到 IdP
- `GET /api/auth/oauth/{provider}/callback?code=...&state=...` — 驗 state、換 token、驗 id_token（非 OIDC 則打 profile API）、upsert user、set JWT cookie、302 回 `redirect`

#### 3.2.1 誰可以登入（access control）

小團隊最常見的需求是「只想讓自己人進來」。提供四層控制，由嚴到鬆，可疊用；**只要任何一層拒絕就拒絕登入**（回 403 並帶說明）：

| # | 機制 | Config | 適用場景 |
|---|------|--------|---------|
| 1 | **Invitation-only**（預設） | `OIDC_ALLOW_SIGNUP=false` | 小團隊：admin 先建空殼 user（email 填好、`password_hash='!'`），SSO 首登只能走 email link path；沒被 pre-provision 的人直接 403。 |
| 2 | **Email 個人白名單** | `OIDC_ALLOWED_EMAILS=a@x.com,b@x.com` | 中小團隊不想每次手動建 user，但要精確控名單。 |
| 3 | **Domain 白名單** | `OIDC_ALLOWED_EMAIL_DOMAINS=company.com` | 有 Google Workspace / M365 的公司：信任整個 domain。 |
| 4 | **Group claim 限制** | `OIDC_REQUIRED_GROUPS=wiki-users` | Keycloak / Azure AD / Authentik 回傳 `groups` claim 時使用；Google 不送，無效。 |

**Provisioning 流程**（合併所有 gate）：
1. Callback 拿到 IdP profile 後，依序跑 **email domain → email 白名單 → group 檢查** 三道 gate，任一失敗 → 403。
2. 依 `(provider, sub)` 查 `auth_identities` → 命中就登入（已 link 過的 user 不再重跑 gate 2 的 email 白名單，避免 admin 改 email 清單後把既有 user 鎖在外面；但 domain / group 仍每次檢查，以便移除人員時立即生效）。
3. 沒命中但 IdP 回 `email_verified=true`：找 `users.email` 相同的帳號 → 自動 link（寫 `auth_identities`）。**Invitation-only 模式（`OIDC_ALLOW_SIGNUP=false`）到這步為止，找不到就 403**。
4. 找不到且 `OIDC_ALLOW_SIGNUP=true`：建新 user（username = email local-part，碰撞就 suffix `-2`…），password_hash 寫 `!`，role 取 `OIDC_DEFAULT_ROLE`。

**Admin 「Invite by email」UX**（列入 Phase 1 — 否則 invitation-only 無法使用）：
- Admin → Users 頁新增按鈕「Invite」，彈窗填 email + display_name + role。
- 後端 `POST /api/admin/users/invite`：建 user row（username = email local-part、`password_hash='!'`、`email=填入值`），不寄信（寄信需 SMTP 設定，留 v2），直接把 SSO 登入網址 copy 給 admin 貼給對方。
- 清理：invited 但從未登入的 user，`auth_identities` 會是空的，admin 可用 `deleted_at` 軟刪。

**Cookie 注意**：state/PKCE cookie 必須 `samesite=lax`（`none` 會在多數瀏覽器被擋），因為 callback 是 top-level navigation，`lax` 會帶 cookie。現有 session cookie 已是 `lax`，一致。

### 3.3 LDAP — 方案 2

**Lib**：`ldap3` — 純 Python、無 C 依賴，符合專案 low-deps 精神。延遲 import（只在 `LDAP_ENABLED=true` 時載入）。

**Config**：
```
LDAP_ENABLED=false
LDAP_SERVER=ldaps://ldap.example.com     # ldap:// 在程式裡拒絕，避免明文
LDAP_TLS_VERIFY=true
LDAP_BIND_DN=cn=svc-wiki,ou=services,dc=example,dc=com
LDAP_BIND_PASSWORD=...
LDAP_USER_BASE=ou=people,dc=example,dc=com
LDAP_USER_FILTER=(&(objectClass=person)(uid={username}))
LDAP_ATTR_EMAIL=mail
LDAP_ATTR_DISPLAY_NAME=displayName

# 選用：把 LDAP group 同步到 JustWiki groups
LDAP_SYNC_GROUPS=true
LDAP_GROUP_BASE=ou=groups,dc=example,dc=com
LDAP_GROUP_FILTER=(&(objectClass=groupOfNames)(member={user_dn}))
LDAP_ADMIN_GROUPS=wiki-admins            # CN 對到就升 role=admin
LDAP_DEFAULT_ROLE=editor
```

**流程**：擴充現有 `POST /api/auth/login`（`auth_router.py:32`）。偽碼：
```python
row = query_local_user(username)
if row and verify_password(body.password, row.password_hash):
    return issue_token(row)
if settings.LDAP_ENABLED:
    ldap_user = ldap_authenticate(username, body.password)  # bind svc → search → bind user
    if ldap_user:
        row = upsert_ldap_user(ldap_user)       # 寫 users + auth_identities(provider='ldap')
        if settings.LDAP_SYNC_GROUPS:
            sync_ldap_groups(row, ldap_user.groups)
        return issue_token(row)
raise 401
```

**Group sync**：`groups` 表加 `ldap_dn TEXT UNIQUE` 欄位（migration v7）。每次 LDAP 登入：對使用者當下的 LDAP group 列表 reconcile — 新增缺的 `group_members`、移除不再屬於的 `ldap_dn` 來源成員。人工加的（`ldap_dn IS NULL`）不動。

**Admin role**：若 LDAP group CN 命中 `LDAP_ADMIN_GROUPS` 清單，把 `users.role` 升為 `admin`；移出清單下次登入會降回 `LDAP_DEFAULT_ROLE`。這行為需在文件明寫，避免管理員意外自貶。

### 3.4 前端

- Login 頁（`frontend/src/pages/Login.jsx`）mount 時呼叫 `GET /api/auth/providers`。
- 回傳非空時，在本地表單底下加「Continue with Google / GitHub / …」按鈕。按鈕是 `<a href="/api/auth/oauth/{id}/login?redirect=...">` — 必須是完整 navigation（不能 fetch，因為要跟 IdP 做 top-level redirect）。
- LDAP 使用者走原本的帳密表單，前端完全無感。
- `usePermissions` / `useAuth` 不動；callback 後照樣是 `/api/auth/me` 拿 user。

### 3.5 Admin UI

**Phase 1 必做**（invitation-only 依賴這個才 usable）：
- Users 頁新增「Invite」按鈕 + `POST /api/admin/users/invite` endpoint（見 §3.2.1）。

**Phase 1 可選**（建議一起做，Users 頁本來就要改）：
- Users 列表顯示每個 user 綁了哪些 identity（Google / LDAP / Local），讀 `auth_identities`。

**之後再做**（不擋 Phase 1）：
- 解除 OIDC 綁定按鈕（刪 `auth_identities` row）。
- 停用 local password（把 `password_hash` 改 `!`）。
- Email 邀請信（需要 SMTP 設定，留 v2）。

## 4. 要動的檔案

**Phase 1 — OIDC（多 provider，registry pattern）**
- `backend/app/config.py` — 加 OIDC 設定（含 Google / Microsoft / GitHub / generic + 四層 access control）。
- `backend/app/migrations.py` — `_m006_auth_identities`。
- `backend/app/database.py` — `auth_identities` 加到 `SCHEMA_SQL`（for fresh DB）。
- `backend/app/services/oidc.py`（新）— `OIDCProvider` 基底 + `GitHubProvider` 子類 + registry builder + provisioning（gates / upsert / link / signup gate）。
- `backend/app/routers/oauth_router.py`（新）— `/providers`、`/{provider}/login`、`/{provider}/callback`，handler 全走 registry，不寫死名稱。
- `backend/app/routers/users.py` — 加 `POST /api/admin/users/invite`（admin-only，建空殼 user）。
- `backend/app/main.py` — 掛 router。
- `backend/pyproject.toml` — 加 `authlib`, `itsdangerous`（Starlette session 需要）。
- `frontend/src/pages/Login.jsx` — providers query + 動態 render SSO 按鈕（icon 依 provider id）。
- `frontend/src/pages/admin/Users.jsx`（或等效檔） — 加 Invite 按鈕 + identity 欄位顯示。
- `.env.example` — 加四組 provider 範例 + 四層 access control 範例 + redirect URI 設定說明。
- `backend/tests/test_oauth.py`（新）— mock provider 測 invitation-only / email link / signup / domain 白名單 / email 白名單 / group claim / GitHub private email 特例。
- `backend/tests/test_invite.py`（新）— `/invite` endpoint、權限、username 碰撞。

**Phase 2 — LDAP**
- `backend/app/config.py` — LDAP 設定。
- `backend/app/migrations.py` — `_m007_groups_ldap_dn`。
- `backend/app/services/ldap_auth.py`（新）— bind + search + group sync，延遲 import `ldap3`。
- `backend/app/routers/auth_router.py:32` — login fallback。
- `backend/pyproject.toml` — 加 `ldap3`（optional extra：`pip install "just-wiki[ldap]"`，讓沒開 LDAP 的人不用裝）。
- `backend/tests/test_ldap_auth.py`（新）— 用 `ldap3.Server(get_info=OFFLINE)` + `MockSyncStrategy`。

> Dual-render 注意：純登入流程，Editor / Viewer 不涉及。

## 5. 風險與邊界情況

**OIDC**
- **Redirect URI 一致性**：dev (`http://localhost:5173`) vs prod domain，每個 IdP 都要各自登記。.env.example 要明寫 `{BASE_URL}/api/auth/oauth/{provider}/callback`。
- **GitHub 無 `email_verified`**：若 GitHub 是唯一 provider，email 自動 link 流程要降級為「永遠建新帳號」或強制 email 驗證。
- **Cookie on HTTPS**：`COOKIE_SECURE=true` 時 state cookie 也得 secure，部署文件要同步更新。
- **Clock skew**：id_token `iat`/`exp` 驗章對時鐘敏感，authlib 預設 tolerance 夠但要在 README 提。
- **管理員自鎖**：若唯一 admin 切到 OIDC-only 後 IdP 掛了就進不來。建議保留 `ADMIN_USER` 環境變數自動 bootstrap 的本地密碼（目前 `ensure_admin_exists` 已有這邏輯）。

**LDAP**
- **明文 LDAP**：`ldap://` 會把密碼送明文。程式要求 `ldaps://` 或 STARTTLS，否則 startup 直接 raise。
- **Service account 權限**：bind DN 只需 read；文件要警告不要給 write。
- **大型 AD 的 group 查詢成本**：每次登入都打 LDAP 會慢；若 group 很多可加 session-local cache（TTL 跟 JWT 一致，24h）。
- **Username 碰撞**：LDAP user 可能與本地 user 同名。第一次 LDAP 登入時，若 `users` 已有同名且 `password_hash != '!'`（真實本地帳號）→ 拒絕登入並要求 admin 手動處理，避免 silent takeover。

**共用**
- **Rate limit**：`_check_rate_limit` 目前只保護本地 login path；OIDC callback 不需要（provider 會擋），但 LDAP 要走同一層。
- **Session fixation**：OIDC callback 成功後重發 JWT（現在 `create_token` 就是這樣，沒問題）。
- **移除 SSO**：admin 關掉 `OIDC_ENABLED` 後，SSO-only user（`password_hash='!'`）會變無法登入。UI 要警告；或提供「寄 reset 連結」流程（v2）。

## 6. Open questions
- Phase 1 首發要包含哪幾家？目前規劃 Google + Microsoft + GitHub + generic OIDC（四家一次上）。也可只上 Google + generic，GitHub/Microsoft 後續 PR 補。
- LDAP group sync 要不要做？不做的話 LDAP 使用者就只有 default role，沒辦法對應到 JustWiki ACL group。
- 是否保留「純本地模式」為預設？目前傾向**是**（`OIDC_ENABLED=false`、`LDAP_ENABLED=false` 為預設值），不影響既有使用者。
- `authlib` 是否接受（它有 2 個間接 dep：`cryptography` 已被 bcrypt 相關套件拉進來，`httpx` 也是 FastAPI 測試既有依賴）？

## 7. Effort
- **Phase 1 (OIDC 多 provider, registry pattern + invite UX)**: **M** — 約 700 行 backend + 100 行 frontend + migrations + tests，5–6 天。含 invite endpoint 與 Admin Users 頁小改動，因為 invitation-only 預設需要配套才能用。
- **Phase 2 (LDAP)**: **S** — 1–2 天，ldap3 用法直觀，難點在 group sync 與測試。

建議順序：**Phase 1 → Phase 2**。兩個 PR 獨立，LDAP 可依需求延後。
