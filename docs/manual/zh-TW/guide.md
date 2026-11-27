
# 使用手冊

> 🌐 **語言：** 中文 · [[en-guide|English]]

JustWiki 是一套輕量、自架式的小團隊 Wiki。以 Markdown 為核心，所有資料存放在單一 SQLite 檔案加上一個媒體目錄，不需要外部資料庫，一台 1 vCPU / 512 MB 的 VM 或樹莓派就能跑。

![JustWiki 主介面](/api/media/hero.png)

## 為什麼選 JustWiki

- **vs Outline** — 不用 PostgreSQL、Redis、MinIO，也不用 4 CPU / 8 GB 的機器
- **vs Wiki.js** — v3 自 2021 宣布至今仍無正式版、v2 進入 maintenance；JustWiki 持續更新
- **vs BookStack** — 頁面可無限巢狀，不是 Book → Chapter → Page 三層到底
- **vs Notion / Obsidian** — 自架、資料在自己機器上，並有完整多人協作（ACL、留言、訂閱通知）

## 目錄

**寫作**
- [[zh-quick-start|快速上手]] — 第一頁、頁面樹、快捷鍵
- [[zh-editor|編輯器]] — 所見即所得、Slash 指令、圖片、草稿自動儲存
- [[zh-rich-content|豐富內容]] — 提示框、Mermaid、KaTeX、Draw.io、程式碼
- [[zh-links|連結與嵌入]] — Wikilinks、反向連結、Transclusion、@提及

**整理與瀏覽**
- [[zh-organize|整理頁面]] — 階層、標籤、範本、頁面類型
- [[zh-mindmap|心智圖頁面]] — 心智圖頁面的實際範例
- [[zh-browse|搜尋與瀏覽]] — 全文搜尋、圖譜、活動、書籤、主題與語言

**團隊**
- [[zh-collaboration|協作]] — 留言、訂閱通知、版本歷史、併發編輯、定期複查
- [[zh-permissions|權限與帳號]] — 角色、頁面 ACL、群組、公開頁面、SSO、API Token
- [[zh-ai|AI 問答]] — 以 wiki 為知識來源的問答助理

**維運**
- [[zh-admin|管理員指南]] — 網站設定、使用者、Webhook、備份、匯出
- [[zh-developer|開發者指南]] — 技術堆疊、本地開發、API

:::info
這份手冊本身就是 JustWiki 頁面，用到的語法都會即時渲染。看到想學的寫法，可以直接到 GitHub 上的 `docs/manual/` 看原始 Markdown。
:::
