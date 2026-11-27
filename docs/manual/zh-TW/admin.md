# 管理員指南

這頁給負責維運 JustWiki 的管理員。安裝與部署步驟請看 GitHub 上的 [README](https://github.com/PttCodingMan/JustWiki)；這裡說明裝好之後的日常管理。

管理員從側邊欄的 **管理** 進入以下功能。

## 網站設定

| 設定 | 說明 |
|------|------|
| 網站名稱 | 顯示在左上角與瀏覽器分頁 |
| 首頁 slug | 造訪 `/` 時導向的頁面；留空則顯示頁面列表 |
| 登入頁標題 / 副標題 | 登入畫面上的文字 |
| 公開頁面頁尾 | 匿名公開頁面底部的文字 |
| 登入有效期 | 登入後保持有效的天數（1–365），只影響之後的新登入 |
| 持續使用時自動延長登入 | 開啟後只要定期使用就不必重新登入 |
| 上傳檔案大小上限 | 單一媒體檔案上限（1–100 MB，預設 20） |
| 密碼最短長度 | 建立使用者、重設與修改密碼時套用（8–128） |

欄位留空會還原為內建預設值。

## 使用者

- **新增使用者** — 建立本機帳號並設定角色（admin / editor / viewer，見 [[zh-permissions|權限與帳號]]）
- **邀請 (SSO)** — 先用 email 建立帳號，對方用 Google / GitHub / 公司 SSO 登入時以 email 配對
- **停用** — 立即登出並禁止登入，頁面與歷史紀錄保留，之後可重新啟用
- **刪除** — 已刪除的帳號會列在「已刪除」分頁
- 重設密碼、停用帳號都會讓該使用者所有裝置上的登入失效

## 群組

建立群組、加入成員，之後可以在頁面權限裡整組授權。用 LDAP 時可以設定 `LDAP_SYNC_GROUPS=true` 從目錄同步群組。

## 範本

新增、編輯、刪除全站共用的頁面範本。內建四個：會議記錄、技術文件、Troubleshooting、ADR。

## 媒體庫

- **圖片與檔案** — 列出所有上傳檔案、大小、被哪些頁面使用；可複製 Markdown 片段貼到別頁
- **圖表** — 列出所有 Draw.io 圖表與使用位置
- 標示 **未使用** 的檔案可以安全刪除；還被頁面引用的檔案無法刪除

## Webhook

頁面有變動時向外部網址 POST 一則 JSON，可接到 Slack、Discord、自動化流程等。可訂閱的事件：

| 事件 | 時機 |
|------|------|
| `page.created` | 頁面建立 |
| `page.updated` | 頁面更新 |
| `page.deleted` | 頁面刪除 |
| `page.review_due` | 頁面到了複查期限 |

送出的內容格式：

```json
{
  "event": "page.updated",
  "page": { "id": 12, "slug": "aB3xK9pQ", "title": "上線流程", "version": 7, "updated_at": "..." },
  "actor": { "id": 3, "username": "alice" },
  "changes": { }
}
```

為了安全，Webhook 網址不能指向內網或 localhost 位址。

## 備份與還原

**從網頁備份**：管理 → 備份與還原 → **下載備份**，會得到一個包含資料庫與所有媒體檔的 `.zip`。

**從網頁還原**：上傳之前下載的 `.zip`，會 **取代目前所有資料**。

**從伺服器備份**：所有資料都在 `data/` 目錄（`just-wiki.db` 加上 `media/`），直接複製這個目錄就是完整備份。用原始碼執行時，`make backup` 會把資料庫複製到 `backup/` 並加上時間戳。

:::warning
JustWiki 使用 SQLite 的 WAL 模式。在伺服器上直接複製資料庫檔案時，請先停止服務，或連同 `just-wiki.db-wal` 一起複製；網頁上的「下載備份」會自動處理這件事。
:::

## 網站匯出

管理 → **匯出靜態網站 (.zip)** 會把整個 wiki 轉成靜態 HTML 網站，解壓後用瀏覽器就能離線閱讀，適合封存或交付。

## 儀表板

側邊欄的 **儀表板** 顯示：

- 儲存空間：資料庫、媒體與磁碟剩餘容量
- 頁面數、使用者數
- 目前版本與是否有新版（預設不對外連線檢查；在 `.env` 設 `CHECK_UPDATES=true` 才會向 ghcr.io 查詢最新版）
- 執行環境與 SQLite 版本

## 回收桶

被刪除的頁面都在 **回收桶**。原作者或管理員可以還原；只有管理員能永久刪除。

## 伺服器設定參考

以下設定都寫在伺服器的 `.env`，改完重新啟動才會生效。完整清單與註解見 repo 裡的 [.env.example](https://github.com/PttCodingMan/JustWiki/blob/main/.env.example)。

**SSO（OIDC）**

| 變數 | 說明 |
|------|------|
| `OIDC_ENABLED` | 啟用 SSO |
| `OIDC_PROVIDERS` | 要提供的登入方式，例如 `google,github,generic` |
| `OIDC_GOOGLE_CLIENT_ID` / `_SECRET` | Google OAuth 用戶端 |
| `OIDC_GITHUB_CLIENT_ID` / `_SECRET` | GitHub OAuth App |
| `OIDC_GENERIC_NAME` / `_CLIENT_ID` / `_CLIENT_SECRET` / `_DISCOVERY` | 其他 OIDC 服務（Keycloak、Authentik、Okta…） |
| `OIDC_ALLOW_SIGNUP` | 首次登入自動建立帳號（預設關閉，只有被邀請的人能登入） |
| `OIDC_ALLOWED_EMAILS` / `OIDC_ALLOWED_EMAIL_DOMAINS` / `OIDC_REQUIRED_GROUPS` | 限制誰可以登入 |
| `OIDC_DEFAULT_ROLE` | 自動建立的帳號角色，預設 `editor` |

在 IdP 註冊的 Redirect URI 是 `{對外網址}/api/auth/oauth/{google|github|generic}/callback`。

**LDAP / Active Directory**

| 變數 | 說明 |
|------|------|
| `LDAP_ENABLED` | 啟用 LDAP 登入 |
| `LDAP_SERVER` | 必須是 `ldaps://`，不接受明文 `ldap://` |
| `LDAP_BIND_DN` / `LDAP_BIND_PASSWORD` | 查詢用的服務帳號 |
| `LDAP_USER_BASE` / `LDAP_USER_FILTER` | 使用者搜尋範圍與條件 |
| `LDAP_ATTR_EMAIL` / `LDAP_ATTR_DISPLAY_NAME` | 屬性對應 |
| `LDAP_SYNC_GROUPS` / `LDAP_GROUP_BASE` / `LDAP_GROUP_FILTER` | 同步群組 |
| `LDAP_ADMIN_GROUPS` | 屬於這些群組的人自動成為管理員 |

:::info
啟用 OIDC 或 LDAP 時，網站必須走 HTTPS（`COOKIE_SECURE=true` 或對外網址是 `https://`），否則服務會拒絕啟動。
:::

**AI 問答** 的設定見 [[zh-ai|AI 問答]]；**匿名瀏覽** 見 [[zh-permissions|權限與帳號]]。
