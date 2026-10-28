// 各機能で共通に使うユーティリティ
(() => {
  const K = (globalThis.KASPA = globalThis.KASPA || {});

  K.DEFAULT_SETTINGS = {
    backReplace: true, // ブラウザの戻る → カスパの戻る
    rootFolder: 'カスパ' // ダウンロード先(既定のダウンロードフォルダ配下)
  };

  K.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 拡張の API(テスト時は globalThis.__kaspaShim で差し替え可能)
  K.send = (msg) =>
    globalThis.__kaspaShim ? globalThis.__kaspaShim.send(msg) : chrome.runtime.sendMessage(msg);

  K.getSettings = async () => {
    if (globalThis.__kaspaShim) return { ...K.DEFAULT_SETTINGS, ...globalThis.__kaspaShim.settings };
    try {
      return { ...K.DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(K.DEFAULT_SETTINGS)) };
    } catch (e) {
      return { ...K.DEFAULT_SETTINGS };
    }
  };

  K.isAjaxBusy = () => {
    const v = document.documentElement.dataset.kaspaAjax;
    return v !== undefined && v !== '0';
  };

  // Ajax が落ち着く(連続 3 回アイドル)まで待つ
  K.waitAjaxIdle = async (timeout = 30000) => {
    await K.sleep(300);
    const end = Date.now() + timeout;
    let stable = 0;
    while (Date.now() < end) {
      if (!K.isAjaxBusy()) {
        if (++stable >= 3) return;
      } else {
        stable = 0;
      }
      await K.sleep(100);
    }
    throw new Error('カスパの応答待ちがタイムアウトしました');
  };

  K.waitFor = async (fn, timeout = 15000, interval = 100) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await K.sleep(interval);
    }
    return null;
  };

  K.byId = (id) => document.getElementById(id);

  // ダイアログ(PrimeFaces)が開いているか
  K.isDialogOpen = (el) => !!el && el.getAttribute('aria-hidden') === 'false';

  // 現在表示中の授業("<授業コード><授業名>")。クラスプロファイル外では null
  K.getCourse = () => {
    const f = K.byId('functionHeaderForm');
    if (!f) return null;
    const line = f.innerText
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean);
    return line || null;
  };

  K.isErrorPage = () => document.title === 'Error Page';

  // カスパのエラー/警告メッセージダイアログの中身
  K.getMessages = () =>
    [...document.querySelectorAll('#errorMessageDialog li, #warningMessageDialog li')]
      .map((e) => e.innerText.trim())
      .filter(Boolean);

  // バルク処理中か(戻るボタンなど他機能の抑止用)
  K.JOB_KEY = 'kaspaBulkJob';
  K.isJobRunning = () => {
    try {
      return !!sessionStorage.getItem(K.JOB_KEY);
    } catch (e) {
      return false;
    }
  };

  // 画面右下に一時的な通知を出す
  K.toast = (text, ms = 3000) => {
    const el = document.createElement('div');
    el.className = 'kaspa-toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  };
})();
