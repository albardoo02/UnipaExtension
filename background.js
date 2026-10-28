// ダウンロードの待ち受けと保存先の振り分け
//
// content script は、ダウンロードボタンを押す直前に kaspa:arm で「次に来るカスパからの
// ダウンロード」を予約し、押した後 kaspa:wait で開始を待つ。
// 予約に一致したダウンロードは「<保存フォルダ>/<授業名>/<資料名>/<元のファイル名>」に保存する。

const KASPA_HOST = 'ichipol.g.hiroshima-cu.ac.jp';
const DEFAULT_SETTINGS = { backReplace: true, rootFolder: 'カスパ' };

/** @type {{token:string, tabId:number|undefined, courseFolder:string, itemFolder:string, result:any, waiter:Function|null, timer:any}[]} */
const armed = [];
let seq = 0;

// Windows / macOS で使えない文字を置き換え、長すぎる名前を切り詰める
function sanitize(name, maxLen = 80) {
  let s = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
  return s || '_';
}

// 拡張子を残したままファイル名を切り詰める
function sanitizeFileName(name) {
  const clean = sanitize(name, 200);
  const m = clean.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
  const base = m[1].slice(0, 120 - (m[2] || '').length);
  return (base || '_') + (m[2] || '');
}

function isKaspaDownload(item) {
  try {
    const u = new URL(item.finalUrl || item.url);
    return u.hostname === KASPA_HOST;
  } catch (e) {
    return false;
  }
}

function removeEntry(entry) {
  const i = armed.indexOf(entry);
  if (i >= 0) armed.splice(i, 1);
  if (entry.timer) clearTimeout(entry.timer);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('kaspa:')) return false;

  if (msg.type === 'kaspa:arm') {
    const entry = {
      token: `t${Date.now()}_${++seq}`,
      tabId: sender.tab && sender.tab.id,
      courseFolder: msg.courseFolder,
      itemFolder: msg.itemFolder,
      result: null,
      waiter: null,
      timer: null
    };
    armed.push(entry);
    // 待ち受けが放置された場合の掃除
    entry.timer = setTimeout(() => {
      if (entry.waiter) entry.waiter({ ok: false, reason: 'timeout' });
      removeEntry(entry);
    }, 120000);
    sendResponse({ token: entry.token });
    return false;
  }

  if (msg.type === 'kaspa:wait') {
    const entry = armed.find((e) => e.token === msg.token);
    if (!entry) {
      sendResponse({ ok: false, reason: 'unknown token' });
      return false;
    }
    if (entry.result) {
      sendResponse(entry.result);
      removeEntry(entry);
      return false;
    }
    entry.waiter = sendResponse;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      sendResponse({ ok: false, reason: 'timeout' });
      removeEntry(entry);
    }, msg.timeoutMs || 45000);
    return true; // 非同期で応答する
  }

  if (msg.type === 'kaspa:disarm') {
    const tabId = sender.tab && sender.tab.id;
    for (const e of armed.slice()) {
      if (e.tabId === tabId) {
        if (e.waiter) e.waiter({ ok: false, reason: 'disarmed' });
        removeEntry(e);
      }
    }
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!isKaspaDownload(item)) {
    suggest();
    return;
  }
  const entry = armed.find((e) => !e.result);
  if (!entry) {
    suggest(); // 一括ダウンロード以外(手動ダウンロード)はそのまま
    return;
  }
  chrome.storage.sync.get(DEFAULT_SETTINGS).then(
    (settings) => {
      const original = (item.filename || 'download').split(/[\\/]/).pop();
      const path = [
        sanitize(settings.rootFolder || DEFAULT_SETTINGS.rootFolder),
        sanitize(entry.courseFolder),
        sanitize(entry.itemFolder),
        sanitizeFileName(original)
      ].join('/');
      suggest({ filename: path, conflictAction: 'uniquify' });
      entry.result = { ok: true, downloadId: item.id, filename: path };
      if (entry.waiter) {
        entry.waiter(entry.result);
        removeEntry(entry);
      }
    },
    () => suggest()
  );
  return true; // suggest を非同期で呼ぶ
});
