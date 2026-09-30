/**
 * 會議詳情模組
 * 處理會議詳情頁面的渲染與交互
 */

const MeetingDetail = (() => {

  let currentMeeting = null;

  /**
   * 渲染會議詳情頁面
   */
  function render(meeting) {
    currentMeeting = meeting;
    const container = document.getElementById('detail-content');
    if (!container) return;

    const statusLabel = getStatusLabel(meeting.status);
    const statusClass = meeting.status;
    const dateStr = new Date(meeting.createdAt).toLocaleString('zh-TW');
    const durationStr = formatDuration(meeting.duration);

    container.innerHTML = `
      <!-- 標題 -->
      <div class="detail-title-row">
        <h2 class="detail-title">${escapeHtml(meeting.title)}</h2>
        <span class="card-status ${statusClass}">${statusLabel}</span>
      </div>

      <!-- 元資料 -->
      <div class="detail-meta">
        <span class="detail-meta-item">📅 ${dateStr}</span>
        ${meeting.duration > 0 ? `<span class="detail-meta-item">⏱️ ${durationStr}</span>` : ''}
      </div>

      <!-- 自訂高顏值音檔播放器 -->
      ${meeting.audioFile ? `
      <div class="custom-audio-player">
        <audio id="meeting-audio-el" preload="metadata" src="${API.getAudioUrl(meeting.audioFile)}"></audio>
        <div class="player-main-row">
          <button class="player-play-btn" id="player-play-btn" aria-label="播放">
            <svg id="play-svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>
            <svg id="pause-svg" class="hidden" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          </button>
          <div class="player-info">
            <div class="player-title-row">
              <span class="player-label">🎵 會議錄音檔</span>
              <span class="player-time-text" id="player-time-display">00:00 / 00:00</span>
            </div>
            <div class="seekbar-container">
              <div class="seekbar-fill" id="seekbar-fill"></div>
              <input type="range" class="player-seekbar-input" id="player-seekbar" min="0" max="100" value="0" step="0.1">
            </div>
          </div>
          <button class="player-speed-btn" id="player-speed-btn">1.0x</button>
        </div>
      </div>
      ` : ''}

      <!-- 操作按鈕 -->
      <div class="detail-actions">
        ${meeting.status === 'recorded' || (!meeting.transcript && meeting.status !== 'transcribing') ? `
          <button class="btn btn-primary" id="btn-transcribe" onclick="MeetingDetail.transcribe()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
            語音轉文字
          </button>
        ` : ''}
        ${meeting.status === 'transcribing' ? `
          <button class="btn btn-primary" disabled>
            <div class="spinner"></div>
            轉錄中...
          </button>
        ` : ''}
        ${meeting.transcript && !meeting.summary && meeting.status !== 'summarizing' ? `
          <button class="btn btn-success" id="btn-summarize" onclick="MeetingDetail.summarize()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            AI 摘要
          </button>
        ` : ''}
        ${meeting.status === 'summarizing' ? `
          <button class="btn btn-success" disabled>
            <div class="spinner"></div>
            分析中...
          </button>
        ` : ''}
        <button class="btn btn-ghost" onclick="MeetingDetail.deleteMeeting()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          刪除
        </button>
      </div>

      <!-- 摘要 -->
      ${meeting.summary ? renderSummary(meeting.summary) : ''}

      <!-- 代辦事項 -->
      ${meeting.actionItems && meeting.actionItems.length > 0 ? renderActionItems(meeting.actionItems) : ''}

      <!-- 逐字稿 -->
      ${meeting.transcript ? `
      <div class="detail-section">
        <div class="section-header">
          <span class="section-icon">📝</span>
          <span class="section-title">逐字稿</span>
        </div>
        <div class="section-content">
          <div class="transcript-text">${escapeHtml(meeting.transcript)}</div>
        </div>
      </div>
      ` : ''}
    `;

    // 初始化自訂音檔播放器事件 (傳入錄音時記錄的精確秒數作為降級備援)
    initCustomPlayer(meeting.duration);
  }

  /**
   * 初始化自訂高顏值音檔播放器
   */
  function initCustomPlayer(fallbackDuration = 0) {
    const audio = document.getElementById('meeting-audio-el');
    if (!audio) return;

    const playBtn = document.getElementById('player-play-btn');
    const playSvg = document.getElementById('play-svg');
    const pauseSvg = document.getElementById('pause-svg');
    const timeDisplay = document.getElementById('player-time-display');
    const seekbar = document.getElementById('player-seekbar');
    const fill = document.getElementById('seekbar-fill');
    const speedBtn = document.getElementById('player-speed-btn');

    const speeds = [1.0, 1.25, 1.5, 2.0, 0.75];
    let speedIndex = 0;

    function getValidDuration() {
      if (audio.duration && isFinite(audio.duration) && !isNaN(audio.duration) && audio.duration > 0) {
        return audio.duration;
      }
      return fallbackDuration || 0;
    }

    // 初始時間顯示
    const initDur = getValidDuration();
    if (timeDisplay) {
      timeDisplay.textContent = `00:00 / ${formatAudioTime(initDur)}`;
    }

    // 播放 / 暫停
    if (playBtn) {
      playBtn.onclick = () => {
        if (audio.paused) {
          audio.play();
        } else {
          audio.pause();
        }
      };
    }

    audio.onplay = () => {
      if (playSvg) playSvg.classList.add('hidden');
      if (pauseSvg) pauseSvg.classList.remove('hidden');
    };

    audio.onpause = () => {
      if (playSvg) playSvg.classList.remove('hidden');
      if (pauseSvg) pauseSvg.classList.add('hidden');
    };

    // 時間與進度更新
    audio.ontimeupdate = () => {
      const dur = getValidDuration();
      if (!dur) return;
      const pct = Math.min(100, Math.max(0, (audio.currentTime / dur) * 100));
      if (seekbar) seekbar.value = pct;
      if (fill) fill.style.width = `${pct}%`;
      if (timeDisplay) timeDisplay.textContent = `${formatAudioTime(audio.currentTime)} / ${formatAudioTime(dur)}`;
    };

    audio.onloadedmetadata = () => {
      const dur = getValidDuration();
      if (timeDisplay && dur) {
        timeDisplay.textContent = `${formatAudioTime(audio.currentTime)} / ${formatAudioTime(dur)}`;
      }
    };

    // 進度條拖曳 / 點擊尋軌
    if (seekbar) {
      seekbar.oninput = (e) => {
        const dur = getValidDuration();
        if (!dur) return;
        const targetTime = (parseFloat(e.target.value) / 100) * dur;
        audio.currentTime = targetTime;
        if (fill) fill.style.width = `${e.target.value}%`;
      };
    }

    // 播放倍速按鈕
    if (speedBtn) {
      speedBtn.onclick = () => {
        speedIndex = (speedIndex + 1) % speeds.length;
        const spd = speeds[speedIndex];
        audio.playbackRate = spd;
        speedBtn.textContent = `${spd.toFixed(1)}x`;
      };
    }
  }

  /**
   * 渲染摘要區塊
   */
  function renderSummary(summary) {
    return `
      <div class="detail-section">
        <div class="section-header">
          <span class="section-icon">📋</span>
          <span class="section-title">會議摘要</span>
        </div>
        <div class="section-content">
          <p class="summary-overview">${escapeHtml(summary.overview || '')}</p>

          ${summary.keyPoints && summary.keyPoints.length > 0 ? `
            <div class="summary-sub-title">重點</div>
            <ul class="summary-list">
              ${summary.keyPoints.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
            </ul>
          ` : ''}

          ${summary.decisions && summary.decisions.length > 0 ? `
            <div class="summary-sub-title">決議</div>
            <ul class="summary-list summary-decisions">
              ${summary.decisions.map(d => `<li>${escapeHtml(d)}</li>`).join('')}
            </ul>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * 渲染代辦事項
   */
  function renderActionItems(items) {
    return `
      <div class="detail-section">
        <div class="section-header">
          <span class="section-icon">✅</span>
          <span class="section-title">代辦事項</span>
          <span style="margin-left:auto;font-size:0.75rem;color:var(--text-muted)">
            ${items.filter(i => i.completed).length}/${items.length} 完成
          </span>
        </div>
        <div class="action-items-list">
          ${items.map(item => `
            <div class="action-item ${item.completed ? 'completed' : ''}" data-item-id="${item.id}">
              <input type="checkbox" class="action-checkbox"
                ${item.completed ? 'checked' : ''}
                onchange="MeetingDetail.toggleActionItem('${item.id}', this.checked)">
              <div class="action-content">
                <div class="action-task">${escapeHtml(item.task)}</div>
                <div class="action-meta">
                  ${item.owner ? `<span class="action-badge owner">👤 ${escapeHtml(item.owner)}</span>` : ''}
                  ${item.dueDate && item.dueDate !== 'null' ? `<span class="action-badge due">📅 ${item.dueDate}</span>` : ''}
                  ${item.priority ? `<span class="action-badge priority-${item.priority}">${getPriorityLabel(item.priority)}</span>` : ''}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  /**
   * 語音轉文字
   */
  async function transcribe() {
    if (!currentMeeting) return;
    const btn = document.getElementById('btn-transcribe');

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner"></div> 轉錄中...';
      }
      App.showToast('🎙️ 開始語音轉文字，請稍候...', 'info');

      await API.transcribe(currentMeeting.id);

      // 重新載入並渲染
      const updated = await API.getMeeting(currentMeeting.id);
      render(updated);
      App.showToast('✅ 語音轉文字完成！', 'success');
    } catch (err) {
      App.showToast(`❌ ${err.message}`, 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '語音轉文字';
      }
    }
  }

  /**
   * AI 摘要
   */
  async function summarize() {
    if (!currentMeeting) return;
    const btn = document.getElementById('btn-summarize');

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner"></div> AI 分析中...';
      }
      App.showToast('🤖 正在進行 AI 分析...', 'info');

      await API.summarize(currentMeeting.id);

      const updated = await API.getMeeting(currentMeeting.id);
      render(updated);
      App.showToast('✅ AI 摘要已生成！', 'success');
    } catch (err) {
      App.showToast(`❌ ${err.message}`, 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'AI 摘要';
      }
    }
  }

  /**
   * 切換代辦事項完成狀態
   */
  async function toggleActionItem(itemId, completed) {
    if (!currentMeeting) return;
    try {
      await API.updateActionItem(currentMeeting.id, itemId, { completed });

      // 更新本地狀態
      const item = currentMeeting.actionItems.find(a => a.id === itemId);
      if (item) item.completed = completed;

      // 更新 UI
      const el = document.querySelector(`[data-item-id="${itemId}"]`);
      if (el) el.classList.toggle('completed', completed);

      // 更新完成計數
      const header = el?.closest('.detail-section')?.querySelector('.section-header span:last-child');
      if (header) {
        const done = currentMeeting.actionItems.filter(i => i.completed).length;
        header.textContent = `${done}/${currentMeeting.actionItems.length} 完成`;
      }
    } catch (err) {
      App.showToast('❌ 更新失敗', 'error');
    }
  }

  /**
   * 刪除會議
   */
  async function deleteMeeting() {
    if (!currentMeeting) return;
    App.showModal('確定要刪除此會議記錄嗎？此操作無法撤銷。', async () => {
      try {
        // 釋放音訊播放器控制，避免 Windows 檔案鎖定
        const audioEl = document.getElementById('meeting-audio-el');
        if (audioEl) {
          audioEl.pause();
          audioEl.src = '';
          audioEl.load();
        }

        await API.deleteMeeting(currentMeeting.id);
        App.showToast('🗑️ 會議已刪除', 'success');
        App.navigateTo('meetings');
      } catch (err) {
        App.showToast(`❌ ${err.message}`, 'error');
      }
    });
  }

  // --- 工具函數 ---

  function formatAudioTime(totalSec) {
    if (isNaN(totalSec) || !isFinite(totalSec) || totalSec < 0) return '00:00';
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(m)}:${pad(s)}`;
  }

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

  function getPriorityLabel(p) {
    const labels = { high: '🔴 高', medium: '🟡 中', low: '🟢 低' };
    return labels[p] || p;
  }

  function formatDuration(seconds) {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { render, transcribe, summarize, toggleActionItem, deleteMeeting };
})();
