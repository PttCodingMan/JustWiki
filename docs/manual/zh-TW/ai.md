# AI 問答

JustWiki 可以接上大型語言模型，讓使用者用自然語言問 wiki 裡的知識，例如「新人到職要準備哪些帳號？」。這是選用功能，預設關閉。

## 運作方式

```mermaid
graph LR
    Q[使用者提問] --> S[全文搜尋相關頁面]
    S --> F[過濾掉提問者沒權限的頁面]
    F --> L[頁面摘錄 + 問題送給模型]
    L --> A[回答＋引用頁面連結]
```

- **以 wiki 為知識來源（RAG）** — 先用全文搜尋找出相關頁面，把摘錄交給模型回答，回答底部附上引用頁面的連結，方便查證
- **遵守權限** — 只有提問者本人有權閱讀的頁面會被送進模型，不會透過 AI 讀到別人的限制頁面
- **串流回覆** — 回答逐字顯示，可隨時按 **停止**

在側邊欄點 **AI 對話** 開始使用；按 Enter 送出、Shift+Enter 換行。

## 啟用

由伺服器管理員在 `.env` 設定：

```
AI_ENABLED=true
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_API_KEY=你的金鑰
AI_MODEL=gemini-2.0-flash
```

任何 OpenAI 相容的服務都能用，換 `AI_BASE_URL` 與 `AI_MODEL` 即可：

| 服務 | AI_BASE_URL | AI_MODEL 範例 |
|------|-------------|---------------|
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Ollama（本機） | `http://localhost:11434/v1` | `llama3.1`（`AI_API_KEY=ollama`） |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |

其他可調整的設定：

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `AI_MAX_CONTEXT_PAGES` | 每次提問最多帶入幾頁 | `5` |
| `AI_EXCERPT_CHARS` | 每頁摘錄的字數上限 | `1500` |
| `AI_RATE_LIMIT_PER_HOUR` | 每位使用者每小時提問上限 | `20` |

:::warning
啟用後，相關頁面的摘錄會送到你設定的模型服務。如果內容不能離開公司，請用 Ollama 這類自架模型。
:::

:::info
這個 demo 站沒有後端，所以 AI 對話無法使用。
:::
