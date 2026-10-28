// ブラウザの「戻る」を、カスパ画面内の戻る操作に置き換える
//
// カスパは読み込み時にダミーの履歴を積み、戻るが押されると積み直すことで、
// ブラウザの戻るを「何も起きない」ようにしている(core.js)。
// ここではその戻る操作(popstate)を拾い、画面内の戻り先をクリックする。
//   1. 開いているダイアログがあれば閉じる
//   2. パンくずに一つ前の画面へのリンクがあればそれ
//   3. 「戻る」ボタンがあればそれ
//   4. クラスプロファイルの各機能 → クラスプロファイル TOP
//   5. それ以外 → ホーム(ロゴ)
(() => {
  const K = globalThis.KASPA;
  if (!K || K.backLoaded) return;
  K.backLoaded = true;

  const visible = (el) => !!el && el.offsetParent !== null;

  // 一番手前に開いているダイアログ(メッセージ用の小さいものも含む)
  const topOpenDialog = () => {
    const dialogs = [...document.querySelectorAll('.ui-dialog[aria-hidden="false"]')].filter(visible);
    if (!dialogs.length) return null;
    return dialogs.sort((a, b) => (Number(b.style.zIndex) || 0) - (Number(a.style.zIndex) || 0))[0];
  };

  const breadcrumbBack = () => {
    const links = [
      ...document.querySelectorAll('.ui-breadcrumb a.ui-menuitem-link:not(.ui-state-disabled)')
    ].filter(visible);
    return links[links.length - 1] || null;
  };

  const backButton = () =>
    [...document.querySelectorAll('button, a')].find(
      (b) => visible(b) && /^(戻る|前画面へ戻る|一覧へ戻る|一覧に戻る)$/.test(b.innerText.trim())
    ) || null;

  // クラスプロファイル TOP にいるか(機能パネルが並んでいる)
  const isClassProfileTop = () => !!document.querySelector('#funcForm .cpFuncPanel');

  const classProfileTopButton = () =>
    [...document.querySelectorAll('#functionHeaderForm button')].find(
      (b) => visible(b) && b.title === 'クラスプロファイルトップ画面を表示します。'
    ) || null;

  const homeLink = () => document.querySelector('#headerForm a[onclick*="headerForm:logo"]');

  // ホーム画面か(お知らせ等のボタンが並ぶ／機能名の欄が空でパンくずもない)
  const isHome = () => {
    if (document.querySelector('#funcForm .infoBtn')) return true;
    const fh = document.getElementById('functionHeaderForm');
    return (!fh || fh.innerText.trim() === '') && !document.querySelector('.ui-breadcrumb');
  };

  K.findBackTarget = () => {
    const dlg = topOpenDialog();
    if (dlg) {
      const close = dlg.querySelector('.ui-dialog-titlebar-close');
      if (visible(close)) return { kind: 'ダイアログを閉じる', el: close };
    }
    const bc = breadcrumbBack();
    if (bc) return { kind: `パンくず「${bc.innerText.trim()}」`, el: bc };
    const bb = backButton();
    if (bb) return { kind: `「${bb.innerText.trim()}」ボタン`, el: bb };
    if (document.getElementById('functionHeaderForm') && !isClassProfileTop()) {
      const top = classProfileTopButton();
      if (top) return { kind: 'クラスプロファイルTOP', el: top };
    }
    if (!isHome()) {
      const home = homeLink();
      if (home) return { kind: 'ホーム', el: home };
    }
    return null;
  };

  K.goBack = () => {
    if (K.isJobRunning()) {
      K.toast('一括ダウンロード中のため、戻る操作は無効です');
      return false;
    }
    if (K.isAjaxBusy()) return false; // 通信中は二重操作を避ける
    const t = K.findBackTarget();
    if (!t) {
      K.toast('これ以上戻れません');
      return false;
    }
    t.el.click();
    return true;
  };

  const setup = async () => {
    const { backReplace } = await K.getSettings();
    if (!backReplace) return;

    // Chrome は「ユーザー操作なしに積まれた履歴」を戻るで飛ばすことがある。
    // 最初のクリック/キー入力のタイミングで履歴を1つ積み、確実に popstate を受け取れるようにする。
    let armed = false;
    const arm = () => {
      if (armed) return;
      armed = true;
      history.pushState({ kaspaBack: true }, '');
    };
    const armOnActivation = () => {
      armed = false;
      window.addEventListener('pointerdown', arm, { once: true, capture: true });
      window.addEventListener('keydown', arm, { once: true, capture: true });
    };
    armOnActivation();

    let last = 0;
    window.addEventListener('popstate', () => {
      const now = Date.now();
      if (now - last < 800) return; // 連打対策
      last = now;
      // カスパ側の popstate 処理(履歴の積み直し)が終わってから動く
      setTimeout(() => {
        const navigated = K.goBack();
        if (!navigated) armOnActivation();
        else if (!armed) arm();
      }, 0);
    });
  };

  setup();
})();
