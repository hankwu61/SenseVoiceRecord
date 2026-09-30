/**
 * API 通訊模組
 * 封裝所有與後端的 HTTP 通訊
 */

const API = (() => {
  const BASE = '';

  /**
   * 上傳錄音檔案
   * @param {Blob} audioBlob - 錄音 Blob
   * @param {Object} metadata - { title, duration }
   * @param {Function} onProgress - 進度回調 (0-100)
   * @returns {Promise<Object>} meeting object
   */
  async function uploadRecording(audioBlob, metadata = {}, onProgress) {
    return new Promise((resolve, reject) => {
      // 依實際錄音格式決定副檔名（iOS Safari 錄的是 audio/mp4）
      const type = (audioBlob.type || '').toLowerCase();
      let ext = '.webm';
      if (type.includes('mp4')) ext = '.m4a';
      else if (type.includes('ogg')) ext = '.ogg';
      else if (type.includes('wav')) ext = '.wav';

      const formData = new FormData();
      formData.append('audio', audioBlob, `recording${ext}`);
      if (metadata.title) formData.append('title', metadata.title);
      if (metadata.duration) formData.append('duration', String(metadata.duration));

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/api/upload`);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          try {
            reject(new Error(JSON.parse(xhr.responseText).error || '上傳失敗'));
          } catch {
            reject(new Error('上傳失敗'));
          }
        }
      });

      xhr.addEventListener('error', () => reject(new Error('網路錯誤')));
      xhr.send(formData);
    });
  }

  /**
   * 觸發語音轉文字
   */
  async function transcribe(meetingId, language = 'auto') {
    const res = await fetch(`${BASE}/api/transcribe/${meetingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `轉錄失敗 (${res.status})`);
    }
    return res.json();
  }

  /**
   * 觸發 AI 摘要
   */
  async function summarize(meetingId) {
    const res = await fetch(`${BASE}/api/summarize/${meetingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `摘要失敗 (${res.status})`);
    }
    return res.json();
  }

  /**
   * 取得所有會議列表
   */
  async function getMeetings() {
    const res = await fetch(`${BASE}/api/meetings`);
    if (!res.ok) throw new Error('無法載入會議列表');
    return res.json();
  }

  /**
   * 取得單一會議詳情
   */
  async function getMeeting(id) {
    const res = await fetch(`${BASE}/api/meetings/${id}`);
    if (!res.ok) throw new Error('會議不存在');
    return res.json();
  }

  /**
   * 更新會議
   */
  async function updateMeeting(id, data) {
    const res = await fetch(`${BASE}/api/meetings/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('更新失敗');
    return res.json();
  }

  /**
   * 更新代辦事項
   */
  async function updateActionItem(meetingId, itemId, data) {
    const res = await fetch(`${BASE}/api/meetings/${meetingId}/action-items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('更新失敗');
    return res.json();
  }

  /**
   * 刪除會議
   */
  async function deleteMeeting(id) {
    const res = await fetch(`${BASE}/api/meetings/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('刪除失敗');
    return res.json();
  }

  /**
   * 取得音檔 URL
   */
  function getAudioUrl(filename) {
    return `${BASE}/api/audio/${filename}`;
  }

  return {
    uploadRecording,
    transcribe,
    summarize,
    getMeetings,
    getMeeting,
    updateMeeting,
    updateActionItem,
    deleteMeeting,
    getAudioUrl
  };
})();
