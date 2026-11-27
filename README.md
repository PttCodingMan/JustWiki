# JustWiki

一套輕量、自架式的小團隊 Wiki。Markdown 優先，所有資料就是一個 SQLite 檔加一個媒體目錄，不需要外部資料庫；1 vCPU / 512 MB 的 VM 或樹莓派就能跑。

<p align="center">
  <img src="docs/images/hero.png" alt="JustWiki 主介面：左側頁面樹、右側目錄、中央 Markdown 檢視" width="100%">
</p>

<p align="center">
  <strong>中文</strong> · <a href="README.en.md">English</a>
</p>

**📖 說明文件與線上 demo：<https://codingman.cc/JustWiki/>**

功能介紹、使用教學、權限、SSO、AI 問答與管理功能都寫在說明文件裡，它本身就是一個唯讀的 JustWiki。這份 README 只講怎麼部署。

## 快速開始（Docker Compose）

需求：Docker 與 Docker Compose。

```bash
mkdir justwiki && cd justwiki
curl -fsSLO https://raw.githubusercontent.com/PttCodingMan/JustWiki/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/PttCodingMan/JustWiki/main/.env.example -o .env
```

編輯 `.env`，至少改掉這兩項：

```bash
# 產生隨機金鑰：python3 -c "import secrets; print(secrets.token_urlsafe(32))"
SECRET_KEY=<隨機字串>
ADMIN_PASS=<強密碼>
```

啟動：

```bash
docker compose up -d
```

開啟 <http://localhost:3000>，用 `admin` 與你設定的 `ADMIN_PASS` 登入。

> [!IMPORTANT]
> `SECRET_KEY` 還是預設值、或管理員還在用預設密碼時，容器會**拒絕啟動**，原因會印在 log 裡（`docker compose logs justwiki`）。

## 不用 Compose：docker run

JustWiki 是單一 image（`ghcr.io/pttcodingman/justwiki`），API 與前端由同一個容器提供：

```bash
docker run -d --name justwiki --restart unless-stopped \
  -p 3000:8000 -v ./data:/app/data \
  -e SECRET_KEY=<隨機字串> -e ADMIN_PASS=<強密碼> \
  -e PUBLIC_BASE_URL=http://localhost:3000 \
  ghcr.io/pttcodingman/justwiki:latest
```

容器內監聽 8000 port，健康檢查端點是 `/api/health`。

## 對外開放

從其他機器或用網域連進來時，還要設定三件事：

1. **走 HTTPS** — 在前面放一個 TLS reverse proxy（Caddy、Traefik、nginx…），否則登入 cookie 會以明文傳送
2. **對外網址加進允許來源** — 沒加的話，從該網址送出的編輯、留言等寫入請求都會被 CSRF 檢查擋下（403）
3. **信任 proxy** — 讓登入速率限制以真正的客戶端 IP 計算

`.env`：

```bash
PUBLIC_BASE_URL_DOCKER=https://wiki.example.com   # 用 docker run 時改設 PUBLIC_BASE_URL
ALLOWED_ORIGINS=https://wiki.example.com
TRUST_PROXY=true
```

對外網址是 `https://` 開頭時，安全 cookie 會自動開啟（等同 `COOKIE_SECURE=true`）。

Caddy 範例（自動申請憑證）：

```
wiki.example.com {
    reverse_proxy localhost:3000
}
```

nginx 範例：

```nginx
server {
    listen 443 ssl;
    server_name wiki.example.com;
    # ssl_certificate / ssl_certificate_key ...

    # 媒體上傳最大 100 MB；網頁還原備份最大 500 MB
    client_max_body_size 510m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> [!NOTE]
> 只在內網使用、直接以 `http://<主機 IP>:3000` 連線時，同樣要把這個網址加進 `ALLOWED_ORIGINS`（多個用逗號分隔），否則無法編輯；`TRUST_PROXY` 維持 `false`。

## 設定

所有設定都在 `.env`，修改後執行 `docker compose up -d` 重建容器生效。完整選項與註解見 [.env.example](.env.example)。

| 變數 | 說明 | 預設值 |
| ---- | ---- | ------ |
| `SECRET_KEY` | Session 簽章金鑰，**必須更換** | `change-me-...` |
| `ADMIN_USER` / `ADMIN_PASS` | 第一個管理員帳號；`ADMIN_PASS` **必須更換** | `admin` / `admin` |
| `PUBLIC_BASE_URL_DOCKER` | 對外網址（Compose） | `http://localhost:3000` |
| `ALLOWED_ORIGINS` | 允許送出寫入請求的來源，逗號分隔 | 只有 localhost |
| `TRUST_PROXY` | 前面有 reverse proxy 時設 `true` | `false` |
| `COOKIE_SECURE` | 強制安全 cookie（對外網址為 https 時自動開啟） | `false` |
| `ANONYMOUS_READ` | 未登入也能閱讀整個 wiki | `false` |
| `AI_ENABLED` | 啟用 AI 問答（另需 `AI_API_KEY` 等） | `false` |
| `OIDC_ENABLED` / `LDAP_ENABLED` | 啟用 SSO / LDAP 登入（需要 HTTPS） | `false` |
| `CHECK_UPDATES` | 儀表板向 ghcr.io 檢查新版本 | `false` |

AI 問答、SSO 與 LDAP 的詳細設定請看說明文件的 [AI 問答](https://codingman.cc/JustWiki/page/aCzzL0mH) 與 [管理員指南](https://codingman.cc/JustWiki/page/ZovmUEPg)。

## 資料與備份

所有資料都在 `./data`：

```
data/
├── just-wiki.db   # SQLite 資料庫（WAL 模式，旁邊可能有 -wal / -shm 檔）
└── media/         # 上傳的圖片與檔案
```

- **從網頁** — 管理 → 備份與還原 → 下載備份，會得到包含資料庫與媒體的 `.zip`；同一頁也能上傳 `.zip` 還原
- **從主機** — 停止容器後複製整個 `data/`；不停機的話，`-wal` 檔要一起複製
- **搬家** — 在新機器放好 `docker-compose.yml`、`.env` 與 `data/`，執行 `docker compose up -d`

## 升級

```bash
docker compose pull
docker compose up -d
```

資料庫結構會在啟動時自動遷移。升級前建議先備份 `data/`。

> **從舊版（backend + frontend 兩個 image）升級**：換成新版 `docker-compose.yml` 後執行 `docker compose up -d --remove-orphans`。資料目錄 `./data` 與對外 port 3000 都不變；舊版 compose 會強制開啟 `TRUST_PROXY`，新版不會，前面有 proxy 的話請自行在 `.env` 設定。

## 從原始碼建置

```bash
git clone https://github.com/PttCodingMan/JustWiki.git
cd JustWiki
cp .env.example .env   # 依上方說明修改
docker compose up -d --build
```

本地開發、測試與專案結構請看說明文件的 [開發者指南](https://codingman.cc/JustWiki/page/JK0cazw3)。

## 授權

本專案以 [MIT License](LICENSE) 授權釋出。
