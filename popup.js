const DEFAULTS = { backReplace: true, rootFolder: 'カスパ' };
const $ = (id) => document.getElementById(id);

function flash() {
  $('saved').textContent = '保存しました';
  setTimeout(() => ($('saved').textContent = ''), 1200);
}

chrome.storage.sync.get(DEFAULTS).then((s) => {
  $('backReplace').checked = !!s.backReplace;
  $('rootFolder').value = s.rootFolder;
});

$('backReplace').addEventListener('change', (e) => {
  chrome.storage.sync.set({ backReplace: e.target.checked }).then(flash);
});

$('rootFolder').addEventListener('change', (e) => {
  const v = e.target.value.trim() || DEFAULTS.rootFolder;
  e.target.value = v;
  chrome.storage.sync.set({ rootFolder: v }).then(flash);
});
