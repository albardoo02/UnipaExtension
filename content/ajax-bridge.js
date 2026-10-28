// ページ本体(MAIN world)で動き、カスパ(PrimeFaces/jQuery)の Ajax 通信中かどうかを
// <html data-kaspa-ajax="N"> に書き出す。拡張側(隔離 world)はこの属性を見て完了を待つ。
(() => {
  const root = document.documentElement;
  const tick = () => {
    try {
      const jq = window.jQuery;
      let busy = jq ? jq.active : 0;
      const q = window.PrimeFaces && window.PrimeFaces.ajax && window.PrimeFaces.ajax.Queue;
      if (q && typeof q.isEmpty === 'function' && !q.isEmpty()) busy += 1;
      root.dataset.kaspaAjax = String(busy);
    } catch (e) {
      // 取得できないときは何もしない
    }
  };
  tick();
  setInterval(tick, 100);
})();
