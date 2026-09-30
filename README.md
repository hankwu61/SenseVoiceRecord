# 會議錄音助手 (SenseVoiceRecord)

本機自架的會議錄音工具：在瀏覽器錄音（麥克風／系統音訊／混合），透過 **SenseVoice** 模型離線語音轉文字（含講者分離與時間軸），再用 **Gemini** 自動生成會議摘要與代辦事項。支援電腦與手機使用，錄音檔與逐字稿全部存在本機。

## 功能特色

- 🎙️ **三種錄音模式**
  - **麥克風**：一般收音（電腦與手機皆可用）
  - **系統音訊**：擷取電腦播放的聲音（WASAPI Loopback，適合線上會議；僅桌面版 Chrome / Edge）
  - **混合模式**：麥克風 + 系統音訊同時錄（僅桌面版 Chrome / Edge）
- 📝 **離線語音轉文字**：SenseVoice-Small + FSMN-VAD 語音切分 + CT-PUNC 標點 + CAM++ 聲紋講者分離，輸出帶時間軸與講者標記的逐字稿，並自動簡轉繁（台灣用語）
- 🤖 **AI 會議分析**：Gemini 2.5 Pro 生成會議概述、重點、決議與代辦事項（含負責人／優先級）
- ✅ **代辦事項管理**：可勾選完成、編輯
- 📱 **手機支援**：內建 HTTPS（自簽憑證自動產生），手機瀏覽器可直接錄音上傳
- 💾 **資料本機保存**：錄音檔與會議記錄存於 `data/` 目錄，不經第三方伺服器（僅摘要功能會將逐字稿送至 Gemini API）

## 系統架構

```
瀏覽器 (public/)
   │  錄音 (MediaRecorder) → 上傳
   ▼
Node.js 伺服器 (server/index.js)          Port 3000 (HTTP) / 3443 (HTTPS)
   │  ├─ 會議 CRUD、音檔儲存 (data/)
   │  ├─ 轉錄請求 ──────────────►  Python STT 服務 (stt_server.py)   Port 5000
   │  │                              SenseVoice-Small + VAD + PUNC + CAM++
   │  └─ 摘要請求 ──────────────►  Google Gemini API (gemini-2.5-pro)
```

## 環境需求

- **Node.js** 18+
- **Python** 3.9+（第一次啟動會自動下載 SenseVoice 等模型，需要數 GB 磁碟空間）
- **Gemini API Key**（摘要功能用，於 [Google AI Studio](https://aistudio.google.com/) 免費取得；不設定也能錄音與轉錄）

## 安裝

```bash
npm install
```

```bash
pip install -r requirements.txt
```

複製 `.env.example` 為 `.env`，填入你的 Gemini API Key：

```
GEMINI_API_KEY=你的金鑰
STT_SERVER_URL=http://localhost:5000
PORT=3000
HTTPS_PORT=3443
```

## 啟動

需要開兩個終端機視窗：

**1. STT 轉錄服務**（第一次啟動會下載模型，較久）

```bash
python stt_server.py
```

**2. 主伺服器**

```bash
npm start
```

啟動後 console 會顯示可用網址：

- 電腦：`http://localhost:3000`
- 手機：`https://<電腦區網IP>:3443`（啟動訊息會直接列出）

開發模式（server 目錄變更自動重啟）：

```bash
npm run dev
```

## 手機使用

1. 手機連到**與電腦相同的 Wi-Fi**
2. 開啟啟動訊息列出的 `https://<區網IP>:3443` 網址
3. 首次連線會出現憑證警告（自簽憑證），選「進階 → 繼續前往」即可
4. 之後即可錄音、上傳、轉錄、看摘要

注意事項：

- **必須用 HTTPS 網址**（port 3443）。手機瀏覽器只允許 HTTPS 網頁使用麥克風，用 `http://...:3000` 只能瀏覽、無法錄音
- 手機上只有**麥克風模式**可用；系統音訊擷取是桌面版 Chrome / Edge 才支援的功能
- iPhone Safari 錄音格式為 `audio/mp4`（自動處理，會存成 `.m4a`）
- Windows 防火牆需放行 HTTPS port（系統管理員 PowerShell 執行一次即可）：

```bash
netsh advfirewall firewall add rule name="SenseVoiceRecord HTTPS" dir=in action=allow protocol=TCP localport=3443
```

- 電腦區網 IP 變動時手機網址要跟著換，建議在路由器上為電腦設定固定 IP

## 使用流程

1. **錄音**：選擇模式 → 按紅色按鈕開始，可暫停／繼續，按停止後自動上傳
2. **轉錄**：在會議列表點入會議 → 按「轉錄」，等待 SenseVoice 產出逐字稿（依音檔長度，CPU 轉錄需要一些時間）
3. **AI 摘要**：轉錄完成後按「AI 分析」，Gemini 生成摘要與代辦事項
4. **管理**：勾選完成代辦、編輯標題／逐字稿、回放音檔、刪除會議

也可以直接上傳既有音檔，支援格式：`.webm` `.wav` `.mp3` `.ogg` `.m4a` `.flac` `.mp4` `.aac`（上限 500MB）。

## 專案結構

```
SenseVoiceRecord/
├── server/
│   ├── index.js          # Express 主伺服器（API、HTTPS、靜態檔案）
│   └── gemini.js         # Gemini 摘要封裝
├── public/               # 前端（無框架，原生 JS）
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js        # 頁面邏輯與導航
│       ├── recorder.js   # 錄音模組（MediaRecorder + 音波視覺化）
│       ├── api.js        # 後端 API 封裝
│       ├── meeting.js    # 會議列表／詳情
│       └── wakelock.js   # 錄音時防止螢幕休眠
├── stt_server.py         # Python STT 服務（Flask + FunASR / SenseVoice）
├── data/                 # 執行時產生，不需手動建立
│   ├── recordings/       # 音檔
│   ├── meetings/         # 會議記錄 (JSON)
│   └── certs/            # 自簽 HTTPS 憑證（首次啟動自動產生）
├── requirements.txt      # Python 依賴
└── package.json          # Node 依賴
```

## API 端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| POST | `/api/upload` | 上傳音檔，建立會議（multipart，欄位 `audio`、`title`、`duration`） |
| POST | `/api/transcribe/:id` | 觸發語音轉文字 |
| POST | `/api/summarize/:id` | 觸發 Gemini 摘要 |
| GET | `/api/meetings` | 會議列表 |
| GET | `/api/meetings/:id` | 會議詳情 |
| PUT | `/api/meetings/:id` | 更新會議（標題／逐字稿／代辦） |
| PATCH | `/api/meetings/:id/action-items/:itemId` | 更新單一代辦事項 |
| DELETE | `/api/meetings/:id` | 刪除會議（含音檔） |
| GET | `/api/audio/:filename` | 音檔串流 |

STT 服務另有 `GET /health`（狀態檢查）與 `POST /transcribe`（欄位 `file`、`language`）。

## 常見問題

**轉錄時顯示「無法連線至 STT 服務」**
`python stt_server.py` 沒有啟動，或還在載入模型。等 console 出現「模型載入完成」再試。

**摘要功能顯示未初始化**
`.env` 沒有設定 `GEMINI_API_KEY`，設定後重啟 `npm start`。

**手機顯示「拒絕連線」**
依序確認：主伺服器有在跑、防火牆已放行 3443、手機和電腦在同一個 Wi-Fi、網址用的是啟動訊息列出的 IP。

**手機按錄音沒反應／沒有詢問麥克風權限**
你用了 `http://` 網址。改用 `https://<IP>:3443`。

**憑證警告一直出現**
自簽憑證的正常現象，不影響功能。若想移除警告，可刪除 `data/certs/` 讓系統重新產生（新憑證會包含目前的區網 IP），並在手機上信任該憑證。
