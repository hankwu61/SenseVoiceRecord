/**
 * Express 主伺服器
 * 會議錄音助手 API
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const FormData = require('form-data');
const { initGemini, analyzeMeeting } = require('./gemini');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const STT_SERVER_URL = process.env.STT_SERVER_URL || 'http://localhost:5000';

// 確保資料目錄存在
const DATA_DIR = path.join(__dirname, '..', 'data');
const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');
const MEETINGS_DIR = path.join(DATA_DIR, 'meetings');

[DATA_DIR, RECORDINGS_DIR, MEETINGS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// 中間件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Multer 設定 — 音檔上傳
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, RECORDINGS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.webm', '.wav', '.mp3', '.ogg', '.m4a', '.flac', '.mp4', '.aac'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error(`不支援的檔案格式: ${ext}`));
    }
  }
});

// ===== 工具函數 =====

function getMeetingPath(id) {
  return path.join(MEETINGS_DIR, `${id}.json`);
}

function loadMeeting(id) {
  const filepath = getMeetingPath(id);
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function saveMeeting(meeting) {
  fs.writeFileSync(getMeetingPath(meeting.id), JSON.stringify(meeting, null, 2), 'utf-8');
}

function resetStuckMeetings() {
  if (!fs.existsSync(MEETINGS_DIR)) return;
  const files = fs.readdirSync(MEETINGS_DIR).filter(f => f.endsWith('.json'));
  files.forEach(f => {
    try {
      const filepath = path.join(MEETINGS_DIR, f);
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      let changed = false;
      if (data.status === 'transcribing') {
        data.status = data.transcript ? 'transcribed' : 'recorded';
        changed = true;
      } else if (data.status === 'summarizing') {
        data.status = 'transcribed';
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`🔄 自動重置懸空會議狀態: ${data.id} -> ${data.status}`);
      }
    } catch (e) {}
  });
}

function getAllMeetings() {
  if (!fs.existsSync(MEETINGS_DIR)) return [];
  return fs.readdirSync(MEETINGS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(MEETINGS_DIR, f), 'utf-8'));
        // 返回列表用的精簡版
        return {
          id: data.id,
          title: data.title,
          createdAt: data.createdAt,
          duration: data.duration,
          status: data.status,
          hasTranscript: !!data.transcript,
          hasSummary: !!data.summary,
          actionItemCount: data.actionItems ? data.actionItems.length : 0
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ===== API 路由 =====

/**
 * POST /api/upload
 * 上傳錄音檔，建立新會議記錄
 */
app.post('/api/upload', upload.single('audio'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未提供音檔' });
    }

    const id = path.basename(req.file.filename, path.extname(req.file.filename));
    const meeting = {
      id,
      title: req.body.title || `會議 ${new Date().toLocaleString('zh-TW')}`,
      createdAt: new Date().toISOString(),
      duration: parseInt(req.body.duration) || 0,
      audioFile: req.file.filename,
      status: 'recorded',
      transcript: null,
      summary: null,
      actionItems: []
    };

    saveMeeting(meeting);

    console.log(`📁 新會議已儲存: ${meeting.id} (${req.file.filename})`);
    res.json({ success: true, meeting });
  } catch (error) {
    console.error('上傳錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/transcribe/:id
 * 呼叫 STT 服務進行語音轉文字
 */
app.post('/api/transcribe/:id', async (req, res) => {
  try {
    const meeting = loadMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: '會議不存在' });

    const audioPath = path.join(RECORDINGS_DIR, meeting.audioFile);
    if (!fs.existsSync(audioPath)) {
      return res.status(404).json({ error: '音檔不存在' });
    }

    // 更新狀態
    meeting.status = 'transcribing';
    saveMeeting(meeting);

    console.log(`🎙️ 開始轉錄: ${meeting.id}`);

    // 呼叫 Python STT 服務
    const mimeMap = {
      '.webm': 'audio/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4',
      '.flac': 'audio/flac', '.aac': 'audio/aac'
    };
    const formData = new FormData();
    formData.append('file', fs.createReadStream(audioPath), {
      filename: meeting.audioFile,
      contentType: mimeMap[path.extname(meeting.audioFile).toLowerCase()] || 'audio/webm'
    });
    formData.append('language', req.body.language || 'auto');

    let sttResponse;
    try {
      sttResponse = await fetch(`${STT_SERVER_URL}/transcribe`, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders()
      });
    } catch (fetchErr) {
      if (fetchErr.code === 'ECONNREFUSED' || fetchErr.message.includes('ECONNREFUSED')) {
        throw new Error(`無法連線至 STT 服務 (${STT_SERVER_URL})。請確認已啟動 Python STT 服務 (python stt_server.py)`);
      }
      throw new Error(`連線至 STT 服務失敗: ${fetchErr.message}`);
    }

    if (!sttResponse.ok) {
      const errData = await sttResponse.json().catch(() => ({}));
      throw new Error(errData.error || `STT 服務回傳 ${sttResponse.status}`);
    }

    const sttResult = await sttResponse.json();

    meeting.transcript = sttResult.text;
    meeting.status = 'transcribed';
    saveMeeting(meeting);

    console.log(`✅ 轉錄完成: ${meeting.id}`);
    res.json({ success: true, transcript: sttResult.text });
  } catch (error) {
    console.error('轉錄錯誤:', error.message);
    // 回復狀態
    const meeting = loadMeeting(req.params.id);
    if (meeting) {
      meeting.status = 'recorded';
      saveMeeting(meeting);
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/summarize/:id
 * 呼叫 Gemini API 生成摘要與代辦事項
 */
app.post('/api/summarize/:id', async (req, res) => {
  try {
    const meeting = loadMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: '會議不存在' });

    if (!meeting.transcript) {
      return res.status(400).json({ error: '尚未轉錄，請先進行語音轉文字' });
    }

    meeting.status = 'summarizing';
    saveMeeting(meeting);

    console.log(`🤖 開始 AI 分析: ${meeting.id}`);

    const analysis = await analyzeMeeting(meeting.transcript, meeting.title);

    meeting.title = analysis.title || meeting.title;
    meeting.summary = analysis.summary;
    meeting.actionItems = (analysis.actionItems || []).map(item => ({
      id: uuidv4(),
      ...item,
      completed: false
    }));
    meeting.status = 'completed';
    saveMeeting(meeting);

    console.log(`✅ AI 分析完成: ${meeting.id}`);
    res.json({ success: true, meeting });
  } catch (error) {
    console.error('摘要錯誤:', error);
    const meeting = loadMeeting(req.params.id);
    if (meeting) {
      meeting.status = 'transcribed';
      saveMeeting(meeting);
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/meetings
 * 取得所有會議列表
 */
app.get('/api/meetings', (req, res) => {
  res.json(getAllMeetings());
});

/**
 * GET /api/meetings/:id
 * 取得單一會議詳情
 */
app.get('/api/meetings/:id', (req, res) => {
  const meeting = loadMeeting(req.params.id);
  if (!meeting) return res.status(404).json({ error: '會議不存在' });
  res.json(meeting);
});

/**
 * PUT /api/meetings/:id
 * 更新會議記錄
 */
app.put('/api/meetings/:id', (req, res) => {
  const meeting = loadMeeting(req.params.id);
  if (!meeting) return res.status(404).json({ error: '會議不存在' });

  const { title, transcript, actionItems } = req.body;
  if (title !== undefined) meeting.title = title;
  if (transcript !== undefined) meeting.transcript = transcript;
  if (actionItems !== undefined) meeting.actionItems = actionItems;

  meeting.updatedAt = new Date().toISOString();
  saveMeeting(meeting);

  res.json({ success: true, meeting });
});

/**
 * PATCH /api/meetings/:id/action-items/:itemId
 * 更新單一代辦事項（如勾選完成）
 */
app.patch('/api/meetings/:id/action-items/:itemId', (req, res) => {
  const meeting = loadMeeting(req.params.id);
  if (!meeting) return res.status(404).json({ error: '會議不存在' });

  const item = meeting.actionItems.find(a => a.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: '代辦事項不存在' });

  Object.assign(item, req.body);
  saveMeeting(meeting);

  res.json({ success: true, item });
});

/**
 * DELETE /api/meetings/:id
 * 刪除會議
 */
app.delete('/api/meetings/:id', (req, res) => {
  try {
    const meeting = loadMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: '會議不存在' });

    // 刪除音檔 (使用 try-catch 防止 Windows 檔案鎖定 EBUSY 導致崩潰)
    if (meeting.audioFile) {
      const audioPath = path.join(RECORDINGS_DIR, meeting.audioFile);
      if (fs.existsSync(audioPath)) {
        try {
          fs.unlinkSync(audioPath);
        } catch (audioErr) {
          console.warn(`⚠️ 音檔刪除延遲 (檔案鎖定中): ${audioPath}`, audioErr.message);
          // 如果受鎖定，嘗試非同步重新刪除
          setTimeout(() => {
            try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (e) {}
          }, 2000);
        }
      }
    }

    // 刪除 JSON 記錄 (必定刪除)
    const jsonPath = getMeetingPath(meeting.id);
    if (fs.existsSync(jsonPath)) {
      fs.unlinkSync(jsonPath);
    }

    console.log(`🗑️ 會議記錄已刪除: ${meeting.id}`);
    res.json({ success: true });
  } catch (error) {
    console.error('刪除會議錯誤:', error.message);
    res.status(500).json({ error: `刪除失敗: ${error.message}` });
  }
});

/**
 * GET /api/audio/:filename
 * 提供音檔串流
 */
app.get('/api/audio/:filename', (req, res) => {
  const filepath = path.join(RECORDINGS_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: '音檔不存在' });
  res.sendFile(filepath);
});

// 所有其他路由返回 index.html（SPA）
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ===== HTTPS 憑證（手機需要 HTTPS 才能使用麥克風錄音） =====

const CERTS_DIR = path.join(DATA_DIR, 'certs');
const KEY_PATH = path.join(CERTS_DIR, 'server.key');
const CERT_PATH = path.join(CERTS_DIR, 'server.crt');

function getLanIPs() {
  const ips = [];
  const interfaces = os.networkInterfaces();
  Object.values(interfaces).forEach(addrs => {
    (addrs || []).forEach(addr => {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    });
  });
  return ips;
}

async function ensureCerts() {
  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
    return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
  }
  const selfsigned = require('selfsigned');
  const lanIPs = getLanIPs();
  const attrs = [{ name: 'commonName', value: 'SenseVoiceRecord' }];
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...lanIPs.map(ip => ({ type: 7, ip }))
  ];
  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    days: 3650,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }]
  });
  if (!fs.existsSync(CERTS_DIR)) fs.mkdirSync(CERTS_DIR, { recursive: true });
  fs.writeFileSync(KEY_PATH, pems.private, 'utf-8');
  fs.writeFileSync(CERT_PATH, pems.cert, 'utf-8');
  console.log(`🔐 已產生自簽 HTTPS 憑證: ${CERTS_DIR}`);
  return { key: pems.private, cert: pems.cert };
}

// 啟動伺服器
initGemini();
resetStuckMeetings();

app.listen(PORT, '0.0.0.0', () => {
  const lanIPs = getLanIPs();
  console.log(`\n🚀 會議錄音助手伺服器已啟動`);
  console.log(`   📡 本機: http://localhost:${PORT}`);
  lanIPs.forEach(ip => console.log(`   📱 區網: http://${ip}:${PORT} (手機無法錄音，僅供瀏覽)`));
  console.log(`   🎙️ STT 服務: ${STT_SERVER_URL}`);
  console.log(`   📁 資料目錄: ${DATA_DIR}`);
});

ensureCerts()
  .then(credentials => {
    https.createServer(credentials, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      const lanIPs = getLanIPs();
      console.log(`\n🔒 HTTPS 伺服器已啟動（手機請用以下網址，才能使用麥克風錄音）`);
      lanIPs.forEach(ip => console.log(`   📱 https://${ip}:${HTTPS_PORT}`));
      console.log(`   ⚠️ 手機首次連線會出現憑證警告，選擇「進階 > 繼續前往」即可\n`);
    });
  })
  .catch(err => {
    console.warn(`⚠️ HTTPS 啟動失敗（手機將無法錄音）: ${err.message}\n`);
  });
