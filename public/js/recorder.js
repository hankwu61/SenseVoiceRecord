/**
 * 錄音模組
 * 支援三種模式：
 * - mic: 麥克風錄音 (getUserMedia)
 * - system: 系統音訊擷取 (getDisplayMedia / WASAPI Loopback on Windows)
 * - mixed: 麥克風 + 系統音訊混合
 *
 * MediaRecorder API + Web Audio API 音波視覺化
 */

const Recorder = (() => {
  let mediaRecorder = null;
  let audioContext = null;
  let analyser = null;
  let sourceNode = null;
  let micStream = null;
  let displayStream = null;
  let mergedStream = null;
  let chunks = [];
  let startTime = 0;
  let pausedDuration = 0;
  let pauseStart = 0;
  let timerInterval = null;
  let animationFrame = null;
  let state = 'idle'; // idle | recording | paused
  let currentMode = 'mic'; // mic | system | mixed

  // DOM elements
  const canvas = () => document.getElementById('visualizer');
  const timerEl = () => document.getElementById('record-timer');
  const statusEl = () => document.getElementById('record-status');
  const btnRecord = () => document.getElementById('btn-record');
  const btnPause = () => document.getElementById('btn-pause');
  const btnStop = () => document.getElementById('btn-stop');
  const recordIcon = () => document.getElementById('record-icon');

  // Callbacks
  let onRecordingComplete = null;

  /**
   * 偵測是否為 Windows 環境
   */
  function isWindows() {
    const ua = navigator.userAgent;
    return ua.includes('Windows') || navigator.platform?.startsWith('Win');
  }

  /**
   * 偵測瀏覽器是否支援 getDisplayMedia 的音訊擷取
   */
  function isSystemAudioSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  }

  /**
   * 設定錄音模式
   */
  function setMode(mode) {
    if (state !== 'idle') return; // 錄音中不能切換模式
    currentMode = mode;
    console.log(`🔄 錄音模式切換: ${mode}`);
  }

  /**
   * 取得當前模式
   */
  function getMode() {
    return currentMode;
  }

  /**
   * 初始化畫布
   */
  function initCanvas() {
    const c = canvas();
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    drawIdle();
  }

  /**
   * 待機狀態的靜態視覺化
   */
  function drawIdle() {
    const c = canvas();
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width;
    const h = c.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(cx, cy) * 0.85;

    ctx.clearRect(0, 0, w, h);

    // 外圈靜態光環
    const rings = [0.95, 0.85, 0.75, 0.65];
    rings.forEach((scale, i) => {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * scale, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(99, 102, 241, ${0.04 + i * 0.02})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // 中心漸層圓 — 根據模式顯示不同顏色
    const colors = {
      mic: 'rgba(99, 102, 241, 0.08)',
      system: 'rgba(59, 130, 246, 0.08)',
      mixed: 'rgba(139, 92, 246, 0.08)'
    };
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.3);
    grad.addColorStop(0, colors[currentMode] || colors.mic);
    grad.addColorStop(1, 'rgba(99, 102, 241, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  /**
   * 錄音中的動態音波視覺化
   */
  function drawWaveform() {
    const c = canvas();
    if (!c || !analyser) return;
    const ctx = c.getContext('2d');
    const w = c.width;
    const h = c.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(cx, cy) * 0.85;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, w, h);

    // 計算平均音量
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
    const avg = sum / bufferLength;
    const normalizedAvg = avg / 255;

    // 根據模式設定色彩
    const modeColors = {
      mic: { r: 239, g: 68, b: 68, hueStart: 0, hueRange: 60 },     // 紅-橘
      system: { r: 59, g: 130, b: 246, hueStart: 200, hueRange: 60 }, // 藍-靛
      mixed: { r: 139, g: 92, b: 246, hueStart: 260, hueRange: 60 }   // 紫-粉
    };
    const mc = modeColors[currentMode] || modeColors.mic;

    // 背景脈動光暈
    const glowR = maxR * (0.3 + normalizedAvg * 0.25);
    const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    glowGrad.addColorStop(0, `rgba(${mc.r}, ${mc.g}, ${mc.b}, ${0.08 + normalizedAvg * 0.12})`);
    glowGrad.addColorStop(0.5, `rgba(${mc.r}, ${mc.g}, ${mc.b}, ${0.04 + normalizedAvg * 0.06})`);
    glowGrad.addColorStop(1, `rgba(${mc.r}, ${mc.g}, ${mc.b}, 0)`);
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fillStyle = glowGrad;
    ctx.fill();

    // 頻率圓環柱狀圖
    const bars = 64;
    const step = Math.floor(bufferLength / bars);

    for (let i = 0; i < bars; i++) {
      const val = dataArray[i * step] / 255;
      const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
      const innerR = maxR * 0.4;
      const barLen = maxR * 0.4 * val;

      const x1 = cx + Math.cos(angle) * innerR;
      const y1 = cy + Math.sin(angle) * innerR;
      const x2 = cx + Math.cos(angle) * (innerR + barLen);
      const y2 = cy + Math.sin(angle) * (innerR + barLen);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);

      const hue = mc.hueStart + (i / bars) * mc.hueRange;
      ctx.strokeStyle = `hsla(${hue}, 85%, 60%, ${0.4 + val * 0.6})`;
      ctx.lineWidth = Math.max(2, (w / bars) * 0.4);
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // 外圈動態環
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * (0.88 + normalizedAvg * 0.07), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${mc.r}, ${mc.g}, ${mc.b}, ${0.1 + normalizedAvg * 0.2})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (state === 'recording') {
      animationFrame = requestAnimationFrame(drawWaveform);
    }
  }

  /**
   * 暫停狀態的視覺化
   */
  function drawPaused() {
    const c = canvas();
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width;
    const h = c.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(cx, cy) * 0.85;

    ctx.clearRect(0, 0, w, h);

    // 暗淡的暫停環
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.4);
    grad.addColorStop(0, 'rgba(245, 158, 11, 0.06)');
    grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // 暫停圖示（兩條線）
    const barW = 8;
    const barH = 36;
    const gap = 12;
    ctx.fillStyle = 'rgba(245, 158, 11, 0.3)';
    ctx.fillRect(cx - gap - barW / 2, cy - barH / 2, barW, barH);
    ctx.fillRect(cx + gap - barW / 2, cy - barH / 2, barW, barH);
  }

  // ===== 音訊串流取得 =====

  /**
   * 取得麥克風串流
   */
  async function getMicStream() {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44100
      }
    });
  }

  /**
   * 取得系統音訊串流 (WASAPI Loopback on Windows via getDisplayMedia)
   * 使用者需要在系統對話框中勾選「分享系統音訊」
   */
  async function getSystemAudioStream() {
    if (!isSystemAudioSupported()) {
      throw new Error('此瀏覽器不支援系統音訊擷取，請使用 Chrome 或 Edge');
    }

    // 請求畫面分享 + 系統音訊
    // preferCurrentTab: 優先當前分頁
    // systemAudio: 'include' — 請求包含系統音訊
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,  // video 是必要的（API 要求），但我們只取音軌
      audio: {
        echoCancellation: false,    // 系統音訊不需要回音消除
        noiseSuppression: false,    // 保持原始音質（WASAPI 無損）
        autoGainControl: false,     // 不自動增益
        sampleRate: 48000,          // 高採樣率
      },
      systemAudio: 'include',       // 明確要求系統音訊
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'include'
    });

    // 檢查是否成功取得音軌
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      // 停止所有 video 軌道
      stream.getTracks().forEach(t => t.stop());
      throw new Error('未取得系統音訊。請在分享對話框中勾選「分享系統音訊」或「Share system audio」');
    }

    // 停止影像軌道（我們不需要）
    stream.getVideoTracks().forEach(t => t.stop());

    // 監聽使用者手動停止分享
    audioTracks[0].addEventListener('ended', () => {
      console.log('🔇 系統音訊分享已被使用者停止');
      if (state !== 'idle') {
        stop();
      }
    });

    console.log('🔊 系統音訊擷取成功 (WASAPI Loopback)');
    return stream;
  }

  /**
   * 將麥克風和系統音訊混合為單一串流
   */
  function mixStreams(micStr, sysStr, ctx) {
    const micSource = ctx.createMediaStreamSource(micStr);
    const sysSource = ctx.createMediaStreamSource(sysStr);
    const destination = ctx.createMediaStreamDestination();

    // 麥克風增益（可調整，預設稍微降低以平衡）
    const micGain = ctx.createGain();
    micGain.gain.value = 1.0;
    micSource.connect(micGain);
    micGain.connect(destination);

    // 系統音訊增益
    const sysGain = ctx.createGain();
    sysGain.gain.value = 1.0;
    sysSource.connect(sysGain);
    sysGain.connect(destination);

    return { stream: destination.stream, micSource, sysSource, micGain, sysGain };
  }

  // ===== 主要功能 =====

  /**
   * 開始錄音
   * @param {string} mode - 'mic' | 'system' | 'mixed'
   */
  async function start(mode) {
    if (mode) currentMode = mode;

    try {
      let recordingStream;

      // 根據模式取得音訊串流
      switch (currentMode) {
        case 'mic':
          micStream = await getMicStream();
          recordingStream = micStream;
          break;

        case 'system':
          displayStream = await getSystemAudioStream();
          recordingStream = displayStream;
          break;

        case 'mixed':
          // 同時取得麥克風和系統音訊
          // 先取系統音訊（因為需要使用者互動選擇畫面）
          displayStream = await getSystemAudioStream();
          micStream = await getMicStream();
          break;

        default:
          throw new Error(`未知的錄音模式: ${currentMode}`);
      }

      // Web Audio API 設定
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;

      if (currentMode === 'mixed' && micStream && displayStream) {
        // 混合模式：合併兩個串流
        const mixed = mixStreams(micStream, displayStream, audioContext);
        mergedStream = mixed.stream;
        recordingStream = mergedStream;

        // 連接分析器到混合輸出
        const mergedSource = audioContext.createMediaStreamSource(mergedStream);
        mergedSource.connect(analyser);
        sourceNode = mergedSource;
      } else {
        // 單一來源模式
        sourceNode = audioContext.createMediaStreamSource(recordingStream);
        sourceNode.connect(analyser);
      }

      // MediaRecorder — 依瀏覽器支援度挑選格式（iOS Safari 只支援 audio/mp4）
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/ogg;codecs=opus'
      ];
      const mimeType = candidates.find(t => MediaRecorder.isTypeSupported(t));

      mediaRecorder = mimeType
        ? new MediaRecorder(recordingStream, { mimeType })
        : new MediaRecorder(recordingStream);
      chunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mediaRecorder?.mimeType || mimeType || 'audio/webm' });
        const duration = getElapsedSeconds();
        if (onRecordingComplete) {
          onRecordingComplete(blob, duration);
        }
        cleanup();
      };

      // 每 30 秒 requestData，防止意外丟失
      mediaRecorder.start(30000);
      state = 'recording';
      startTime = Date.now();
      pausedDuration = 0;

      updateUI();
      startTimer();
      drawWaveform();

      // 啟用 Wake Lock
      WakeLock.enable();

      const modeLabels = { mic: '麥克風', system: '系統音訊 (WASAPI)', mixed: '混合模式' };
      console.log(`🎙️ 錄音開始 [${modeLabels[currentMode]}]`);
    } catch (err) {
      // 清理已取得的串流
      cleanup();
      console.error('錄音啟動失敗:', err);
      throw err;
    }
  }

  /**
   * 暫停錄音
   */
  function pause() {
    if (state !== 'recording' || !mediaRecorder) return;
    mediaRecorder.pause();
    state = 'paused';
    pauseStart = Date.now();
    cancelAnimationFrame(animationFrame);
    drawPaused();
    updateUI();
    console.log('⏸️ 錄音暫停');
  }

  /**
   * 繼續錄音
   */
  function resume() {
    if (state !== 'paused' || !mediaRecorder) return;
    mediaRecorder.resume();
    state = 'recording';
    pausedDuration += Date.now() - pauseStart;
    drawWaveform();
    updateUI();
    console.log('▶️ 錄音繼續');
  }

  /**
   * 停止錄音
   */
  function stop() {
    if (!mediaRecorder || state === 'idle') return;
    if (state === 'paused') {
      pausedDuration += Date.now() - pauseStart;
    }
    mediaRecorder.stop();
    state = 'idle';
    updateUI();
    console.log('⏹️ 錄音停止');
  }

  /**
   * 清理資源
   */
  function cleanup() {
    stopTimer();
    cancelAnimationFrame(animationFrame);

    if (sourceNode) { try { sourceNode.disconnect(); } catch(e) {} sourceNode = null; }
    if (audioContext) { try { audioContext.close(); } catch(e) {} audioContext = null; }
    analyser = null;

    // 停止所有串流
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    if (displayStream) {
      displayStream.getTracks().forEach(t => t.stop());
      displayStream = null;
    }
    if (mergedStream) {
      mergedStream.getTracks().forEach(t => t.stop());
      mergedStream = null;
    }

    mediaRecorder = null;
    chunks = [];
    state = 'idle';

    WakeLock.disable();
    drawIdle();
    updateUI();
  }

  /**
   * 計時器
   */
  function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
      const el = timerEl();
      if (el) el.textContent = formatTime(getElapsedSeconds());
    }, 200);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function getElapsedSeconds() {
    if (!startTime) return 0;
    let elapsed = Date.now() - startTime - pausedDuration;
    if (state === 'paused') {
      elapsed -= (Date.now() - pauseStart);
    }
    return Math.floor(elapsed / 1000);
  }

  function formatTime(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  /**
   * 更新 UI 狀態
   */
  function updateUI() {
    const btn = btnRecord();
    const pauseBtn = btnPause();
    const stopBtn = btnStop();
    const status = statusEl();
    const modeSelector = document.getElementById('record-mode-selector');

    if (btn) {
      btn.classList.toggle('recording', state !== 'idle');
    }

    // 錄音中隱藏模式選擇器
    if (modeSelector) {
      modeSelector.classList.toggle('disabled', state !== 'idle');
    }

    if (pauseBtn) {
      pauseBtn.classList.toggle('hidden', state === 'idle');
      if (state === 'paused') {
        pauseBtn.querySelector('svg').innerHTML = '<polygon points="5 3 19 12 5 21"/>';
        pauseBtn.querySelector('span').textContent = '繼續';
      } else {
        pauseBtn.querySelector('svg').innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
        pauseBtn.querySelector('span').textContent = '暫停';
      }
    }

    if (stopBtn) {
      stopBtn.classList.toggle('hidden', state === 'idle');
    }

    if (status) {
      status.className = 'record-status' + (state !== 'idle' ? ` ${state}` : '');
      const textEl = status.querySelector('.status-text');
      if (textEl) {
        const modeLabels = { mic: '麥克風', system: '系統音訊', mixed: '混合' };
        switch (state) {
          case 'idle': textEl.textContent = '準備錄音'; break;
          case 'recording': textEl.textContent = `錄音中 [${modeLabels[currentMode]}]...`; break;
          case 'paused': textEl.textContent = '已暫停'; break;
        }
      }
    }

    if (state === 'idle') {
      const timer = timerEl();
      if (timer) timer.textContent = '00:00';
    }
  }

  /**
   * 設定錄音完成回調
   */
  function onComplete(cb) {
    onRecordingComplete = cb;
  }

  /**
   * 取得當前狀態
   */
  function getState() {
    return state;
  }

  return {
    initCanvas, start, pause, resume, stop, onComplete, getState,
    setMode, getMode, isWindows, isSystemAudioSupported
  };
})();
