/**
 * Wake Lock 模組
 * 使用 Screen Wake Lock API 防止手機螢幕休眠
 * 搭配 NoSleep.js 作為降級方案
 */

const WakeLock = (() => {
  let wakeLock = null;
  let noSleep = null;
  let isActive = false;
  let useNative = 'wakeLock' in navigator;

  const indicator = () => document.getElementById('wake-lock-indicator');
  const mobileHint = () => document.getElementById('mobile-hint');

  /**
   * 初始化 — 嘗試載入 NoSleep.js 作為 fallback
   */
  async function init() {
    if (!useNative) {
      try {
        // 動態載入 NoSleep.js CDN
        await loadScript('https://cdn.jsdelivr.net/npm/nosleep.js@0.12.0/dist/NoSleep.min.js');
        noSleep = new NoSleep();
        console.log('📱 使用 NoSleep.js 作為防休眠方案');
      } catch (e) {
        console.warn('⚠️ NoSleep.js 載入失敗，防休眠可能不可用');
      }
    } else {
      console.log('📱 使用原生 Wake Lock API');
    }
  }

  /**
   * 啟用螢幕常亮
   * 如果頁面當前不可見（例如系統音訊的分享對話框開啟中），
   * 會等待頁面重新可見後再啟用
   */
  async function enable() {
    if (isActive) return;
    isActive = true;
    updateUI(true);

    // 如果頁面當前不可見，等待它變為可見
    if (document.visibilityState !== 'visible') {
      console.log('🔒 Wake Lock 延遲啟用（等待頁面可見）');
      return; // visibilitychange 事件會觸發 reacquire()
    }

    await doRequest();
  }

  /**
   * 實際執行 Wake Lock 請求
   */
  async function doRequest() {
    try {
      if (useNative) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          console.log('🔓 Wake Lock 已被系統釋放');
          if (isActive) {
            reacquire();
          }
        });
        console.log('🔒 Wake Lock 啟用成功');
      } else if (noSleep) {
        noSleep.enable();
        console.log('🔒 NoSleep 啟用成功');
      }
    } catch (err) {
      // 不是致命錯誤，僅記錄警告
      console.warn('⚠️ Wake Lock 啟用失敗（將在頁面可見時重試）:', err.message);
    }
  }

  /**
   * 釋放螢幕常亮
   */
  async function disable() {
    isActive = false;

    try {
      if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
        console.log('🔓 Wake Lock 已釋放');
      }
      if (noSleep) {
        noSleep.disable();
        console.log('🔓 NoSleep 已停用');
      }
    } catch (err) {
      console.error('Wake Lock 釋放錯誤:', err);
    }

    updateUI(false);
  }

  /**
   * 頁面重新可見時嘗試重新取得 Wake Lock
   */
  async function reacquire() {
    if (!isActive) return;
    await doRequest();
  }

  /**
   * 更新 UI 指示器
   */
  function updateUI(active) {
    const el = indicator();
    const hint = mobileHint();
    if (el) {
      el.classList.toggle('hidden', !active);
    }
    if (hint) {
      hint.classList.toggle('visible', active);
    }
  }

  /**
   * 動態載入外部腳本
   */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // 監聽頁面可見性變化，重新取得 wake lock
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isActive) {
      reacquire();
    }
  });

  return { init, enable, disable, isActive: () => isActive };
})();
