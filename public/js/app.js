/**
 * 主應用邏輯
 * SPA 路由、頁面管理、全域事件
 */

const App = (() => {
  let currentPage = 'record';

  /**
   * 初始化應用
   */
  async function init() {
    // 初始化 Wake Lock
    await WakeLock.init();

    // 初始化錄音畫布
    Recorder.initCanvas();
    window.addEventListener('resize', () => Recorder.initCanvas());

    // 綁定導航
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        navigateTo(btn.dataset.page);
      });
    });

    // 綁定返回按鈕
    document.getElementById('btn-back').addEventListener('click', () => {
      navigateTo('meetings');
    });

    // 綁定錄音按鈕
    document.getElementById('btn-record').addEventListener('click', handleRecordToggle);
    document.getElementById('btn-pause').addEventListener('click', handlePause);
    document.getElementById('btn-stop').addEventListener('click', handleStop);

    // 錄音完成回調
    Recorder.onComplete(handleRecordingComplete);

    // Modal 事件
    document.getElementById('modal-cancel').addEventListener('click', hideModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) hideModal();
    });

    // 搜尋
    document.getElementById('search-input').addEventListener('input', debounce(handleSearch, 300));

    // ===== 錄音模式選擇器 =====
    initModeSelector();

    // 初始頁面
    navigateTo('record');

    console.log('🚀 App 初始化完成');
  }

  /**
   * 初始化錄音模式選擇器
   * 偵測 Windows 環境，決定是否顯示系統音訊選項
   */
  function initModeSelector() {
    const modeSelector = document.getElementById('record-mode-selector');
    const systemBtn = document.getElementById('mode-system');
    const mixedBtn = document.getElementById('mode-mixed');
    const descText = document.getElementById('mode-desc-text');
    const sysHint = document.getElementById('system-audio-hint');

    // 模式說明文字
    const modeDescriptions = {
      mic: '擷取麥克風聲音',
      system: '擷取電腦系統播放的音訊 (WASAPI Loopback，音質無損)',
      mixed: '同時擷取麥克風 + 系統音訊'
    };

    // 偵測平台
    const isWin = Recorder.isWindows();
    const canSystemAudio = Recorder.isSystemAudioSupported();
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile || (!isWin && !canSystemAudio)) {
      // 手機或不支援的平台：隱藏系統音訊選項
      if (systemBtn) systemBtn.classList.add('hidden');
      if (mixedBtn) mixedBtn.classList.add('hidden');
      console.log('📱 行動裝置或不支援平台，僅顯示麥克風模式');
    } else if (isWin) {
      // Windows：加上 WASAPI 標記
      if (systemBtn) {
        systemBtn.querySelector('span').textContent = '系統音訊';
        systemBtn.title = 'WASAPI Loopback — 無損擷取系統音訊';
      }
      console.log('🖥️ Windows 環境偵測到，啟用 WASAPI Loopback 系統音訊模式');
    }

    // 綁定模式按鈕事件
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (Recorder.getState() !== 'idle') return; // 錄音中不能切換

        const mode = btn.dataset.mode;

        // 更新 UI
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // 設定錄音模式
        Recorder.setMode(mode);

        // 更新說明文字
        if (descText) descText.textContent = modeDescriptions[mode] || '';

        // 顯示/隱藏系統音訊提示
        if (sysHint) {
          sysHint.classList.toggle('hidden', mode === 'mic');
        }

        // 更新畫布顏色
        Recorder.initCanvas();
      });
    });
  }

  /**
   * 頁面導航
   */
  function navigateTo(page, data) {
    currentPage = page;

    // 切換頁面
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');

    // 更新底部導航
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.page === page);
    });

    // 返回按鈕 & 標題
    const backBtn = document.getElementById('btn-back');
    const titleEl = document.querySelector('.title-text');
    const bottomNav = document.getElementById('bottom-nav');

    if (page === 'detail') {
      backBtn.classList.remove('hidden');
      titleEl.textContent = '會議詳情';
      bottomNav.style.display = 'none';
      if (data) loadMeetingDetail(data);
    } else {
      backBtn.classList.add('hidden');
      titleEl.textContent = '會議錄音助手';
      bottomNav.style.display = '';
    }

    // 載入會議列表
    if (page === 'meetings') {
      loadMeetingsList();
    }
  }

  /**
   * 載入會議列表
   */
  async function loadMeetingsList() {
    const listEl = document.getElementById('meetings-list');
    const emptyEl = document.getElementById('empty-state');

    try {
      const meetings = await API.getMeetings();

      if (meetings.length === 0) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
      }

      emptyEl.classList.add('hidden');
      renderMeetingsList(meetings);
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
    }
  }

  /**
   * 渲染會議列表
   */
  function renderMeetingsList(meetings) {
    const listEl = document.getElementById('meetings-list');
    listEl.innerHTML = meetings.map(m => {
      const statusLabel = getStatusLabel(m.status);
      const dateStr = new Date(m.createdAt).toLocaleString('zh-TW', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      const durationStr = m.duration > 0 ? formatDurationShort(m.duration) : '';

      return `
        <div class="meeting-card" onclick="App.navigateTo('detail', '${m.id}')">
          <div class="card-header">
            <div class="card-title">${escapeHtml(m.title)}</div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="card-status ${m.status}">${statusLabel}</span>
              <button class="btn-icon btn-sm card-delete-btn" onclick="event.stopPropagation(); App.deleteCard('${m.id}')" title="刪除會議" aria-label="刪除會議">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
          <div class="card-meta">
            <span class="card-meta-item">📅 ${dateStr}</span>
            ${durationStr ? `<span class="card-meta-item">⏱️ ${durationStr}</span>` : ''}
          </div>
          <div class="card-tags">
            ${m.hasTranscript ? '<span class="card-tag">📝 逐字稿</span>' : ''}
            ${m.hasSummary ? '<span class="card-tag">📋 摘要</span>' : ''}
            ${m.actionItemCount > 0 ? `<span class="card-tag">✅ ${m.actionItemCount} 待辦</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * 列表卡片快捷刪除
   */
  function deleteCard(id) {
    showModal('確定要刪除此會議記錄嗎？此操作無法撤銷。', async () => {
      try {
        await API.deleteMeeting(id);
        showToast('🗑️ 會議已刪除', 'success');
        loadMeetingsList();
      } catch (err) {
        showToast(`❌ ${err.message}`, 'error');
      }
    });
  }

  /**
   * 載入會議詳情
   */
  async function loadMeetingDetail(meetingId) {
    try {
      const meeting = await API.getMeeting(meetingId);
      MeetingDetail.render(meeting);
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
      navigateTo('meetings');
    }
  }

  /**
   * 搜尋處理
   */
  async function handleSearch(e) {
    const query = e.target.value.trim().toLowerCase();
    try {
      const meetings = await API.getMeetings();
      const filtered = query
        ? meetings.filter(m => m.title.toLowerCase().includes(query))
        : meetings;

      const emptyEl = document.getElementById('empty-state');
      if (filtered.length === 0) {
        document.getElementById('meetings-list').innerHTML = '';
        emptyEl.classList.remove('hidden');
        emptyEl.querySelector('p').textContent = query ? '找不到符合的會議' : '還沒有任何會議記錄';
      } else {
        emptyEl.classList.add('hidden');
        renderMeetingsList(filtered);
      }
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
    }
  }

  // --- 錄音事件 ---

  async function handleRecordToggle() {
    const state = Recorder.getState();
    if (state === 'idle') {
      try {
        const mode = Recorder.getMode();
        await Recorder.start(mode);
        const modeLabels = { mic: '🎙️ 麥克風錄音已開始', system: '🔊 系統音訊錄音已開始', mixed: '🎛️ 混合錄音已開始' };
        showToast(modeLabels[mode] || '🎙️ 錄音已開始', 'success');
      } catch (err) {
        if (err.name === 'NotAllowedError') {
          const mode = Recorder.getMode();
          if (mode === 'mic') {
            showToast('❌ 請允許麥克風權限', 'error');
          } else {
            showToast('❌ 已取消畫面分享，系統音訊擷取需要分享畫面', 'error');
          }
        } else if (err.message.includes('系統音訊') || err.message.includes('Share system audio')) {
          showToast(`⚠️ ${err.message}`, 'error');
        } else {
          showToast(`❌ 錄音啟動失敗: ${err.message}`, 'error');
        }
      }
    } else {
      Recorder.stop();
    }
  }

  function handlePause() {
    const state = Recorder.getState();
    if (state === 'recording') {
      Recorder.pause();
    } else if (state === 'paused') {
      Recorder.resume();
    }
  }

  function handleStop() {
    Recorder.stop();
  }

  /**
   * 錄音完成 — 上傳至伺服器
   */
  async function handleRecordingComplete(blob, durationSec) {
    const overlay = document.getElementById('upload-overlay');
    const progressFill = document.getElementById('upload-progress-fill');
    const uploadText = document.getElementById('upload-text');

    overlay.classList.remove('hidden');
    uploadText.textContent = '正在上傳錄音...';
    progressFill.style.width = '0%';

    try {
      const result = await API.uploadRecording(blob, { duration: durationSec }, (pct) => {
        progressFill.style.width = `${pct}%`;
      });

      uploadText.textContent = '上傳完成！';
      progressFill.style.width = '100%';

      setTimeout(() => {
        overlay.classList.add('hidden');
        showToast('✅ 錄音已儲存！', 'success');
        navigateTo('detail', result.meeting.id);
      }, 600);
    } catch (err) {
      overlay.classList.add('hidden');
      showToast(`❌ 上傳失敗: ${err.message}`, 'error');
    }
  }

  // --- Toast ---

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // --- Modal ---

  let modalCallback = null;

  function showModal(message, onConfirm) {
    modalCallback = onConfirm;
    document.getElementById('modal-body').textContent = message;
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('modal-confirm').onclick = async () => {
      const cb = modalCallback;
      hideModal();
      if (cb) {
        try {
          await cb();
        } catch (err) {
          console.error('Modal callback error:', err);
        }
      }
    };
  }

  function hideModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    modalCallback = null;
  }

  // --- 工具函數 ---

  function getStatusLabel(status) {
    const labels = {
      recorded: '待轉錄',
      transcribing: '轉錄中',
      transcribed: '已轉錄',
      summarizing: '分析中',
      completed: '已完成'
    };
    return labels[status] || status;
  }

  function formatDurationShort(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}分${s}秒` : `${s}秒`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // 啟動
  document.addEventListener('DOMContentLoaded', init);

  return { navigateTo, showToast, showModal, hideModal, deleteCard };
})();
