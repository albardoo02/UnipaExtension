// 授業資料の一括ダウンロード
//
// カスパは画面の操作順をサーバー側で追跡しているため、通信を直接再現せず、
// 画面上のボタンを人と同じ順番でクリックして進める(UI駆動方式)。
//   一覧 → 資料を開く → 添付資料を確認 → ファイルを1件ずつダウンロード
//   → パンくず「授業資料一覧」で戻る(ページ再読み込み) → 次の資料
// ページ再読み込みをまたぐので、進行状況は sessionStorage に保存して続きから再開する。
(() => {
  const K = globalThis.KASPA;
  if (!K || K.bulkLoaded) return;
  K.bulkLoaded = true;

  const SEL = {
    table: '[id="funcForm:jgdocList"]',
    rows: '[id="funcForm:jgdocList"] tbody tr[data-ri]',
    paginatorCurrent: '[id="funcForm:jgdocList"] .ui-paginator-current',
    rpp: '[id="funcForm:jgdocList"] select[id$="_rppDD"]',
    attachBtn: 'button[title="登録されている添付資料を表示します。"]',
    dialog: '[id="jga02303:dialog"]',
    fileRow: '.tableDownloadRow',
    fileName: '.downLoadCellFilNm',
    breadcrumbLink: '[id="functionHeaderForm:breadCrumb"] a.ui-menuitem-link:not(.ui-state-disabled)'
  };

  // ---------- 進行状況の保存 ----------
  const loadJob = () => {
    try {
      return JSON.parse(sessionStorage.getItem(K.JOB_KEY));
    } catch (e) {
      return null;
    }
  };
  const saveJob = (job) => sessionStorage.setItem(K.JOB_KEY, JSON.stringify(job));
  const clearJob = () => sessionStorage.removeItem(K.JOB_KEY);

  // ---------- 一覧画面の読み取り ----------
  const isListPage = () => !!document.querySelector(SEL.rows);

  // 見出しの文字から列番号を探す(見つからなければ既定の位置)
  const columnIndex = (label, fallback) => {
    const ths = [...document.querySelectorAll(`${SEL.table} thead th`)];
    const i = ths.findIndex((th) => th.innerText.trim() === label);
    return i >= 0 ? i : fallback;
  };

  // 行の中の「授業資料名」リンク
  const titleLink = (tr) => {
    const cell = tr.cells[columnIndex('授業資料名', 1)];
    return cell ? cell.querySelector('a.ui-commandlink') : null;
  };

  const readRows = () => {
    const cGroup = columnIndex('授業資料グループ', 0);
    const cUnread = columnIndex('未確認', 4);
    return [...document.querySelectorAll(SEL.rows)]
      .map((tr) => {
        const link = titleLink(tr);
        if (!link) return null;
        const text = (i) => (tr.cells[i] ? tr.cells[i].innerText.trim() : '');
        return {
          ri: Number(tr.dataset.ri),
          group: text(cGroup),
          title: link.innerText.trim(),
          unread: text(cUnread) !== ''
        };
      })
      .filter(Boolean);
  };

  // "7件 (1 / 1)" → { total: 7, page: 1, pages: 1 }
  const readPaginator = () => {
    const el = document.querySelector(SEL.paginatorCurrent);
    const m = el && el.innerText.match(/(\d+)\s*件.*?\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
    return m ? { total: +m[1], page: +m[2], pages: +m[3] } : null;
  };

  // 全件が1ページに収まるよう表示件数を最大にする
  const ensureAllRowsShown = async () => {
    const p = readPaginator();
    if (!p || p.pages <= 1) return;
    const sel = document.querySelector(SEL.rpp);
    if (!sel) return;
    const max = Math.max(...[...sel.options].map((o) => Number(o.value) || 0));
    if (Number(sel.value) >= max) return;
    sel.value = String(max);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await K.waitAjaxIdle();
    await K.sleep(500);
  };

  // ---------- 保存先の名前 ----------
  const courseFolderName = (course) => (course || '授業').replace(/^\d+\s*/, '').trim() || course;
  const itemFolderName = (item) => {
    if (item.group && item.group !== item.title) return `${item.group}_${item.title}`;
    return item.title;
  };

  // ---------- UI ----------
  let panel = null;
  let stopRequested = false;

  const ensurePanel = () => {
    if (panel && document.body.contains(panel)) return panel;
    panel = document.createElement('div');
    panel.className = 'kaspa-panel';
    panel.innerHTML = `
      <div class="kaspa-panel-title">授業資料の一括ダウンロード</div>
      <div class="kaspa-panel-body"></div>
      <div class="kaspa-panel-actions"></div>`;
    document.body.appendChild(panel);
    return panel;
  };

  const setPanel = (text, buttons = []) => {
    const p = ensurePanel();
    p.querySelector('.kaspa-panel-body').textContent = text;
    const actions = p.querySelector('.kaspa-panel-actions');
    actions.textContent = '';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      btn.className = b.primary ? 'kaspa-btn kaspa-btn-primary' : 'kaspa-btn';
      btn.addEventListener('click', b.onClick);
      actions.appendChild(btn);
    }
  };

  const removePanel = () => {
    if (panel) panel.remove();
    panel = null;
  };

  const stopButton = {
    label: '中止',
    onClick: () => {
      stopRequested = true;
      const job = loadJob();
      if (job) {
        job.stopRequested = true;
        saveJob(job);
      }
      setPanel('現在の処理が終わり次第、中止します…');
    }
  };

  // 一覧の上にツールバーを差し込む
  const injectToolbar = () => {
    const table = document.querySelector(SEL.table);
    if (!table || document.querySelector('.kaspa-toolbar')) return;
    const bar = document.createElement('div');
    bar.className = 'kaspa-toolbar';
    bar.innerHTML = `
      <button type="button" class="kaspa-btn kaspa-btn-primary" data-act="start">授業資料を一括ダウンロード</button>
      <label class="kaspa-check"><input type="checkbox" data-act="unread"> 未確認(○)の資料だけ</label>`;
    bar.querySelector('[data-act="start"]').addEventListener('click', () => {
      const unreadOnly = bar.querySelector('[data-act="unread"]').checked;
      start({ unreadOnly }).catch((e) => fail(e));
    });
    table.parentElement.insertBefore(bar, table);
  };

  // ---------- 開始 ----------
  const start = async ({ unreadOnly }) => {
    if (loadJob()) {
      alert('すでに一括ダウンロードを実行中です。');
      return;
    }
    const course = K.getCourse();
    if (!course) throw new Error('授業名を読み取れませんでした');

    await ensureAllRowsShown();
    const p = readPaginator();
    let items = readRows();
    if (unreadOnly) items = items.filter((i) => i.unread);
    if (items.length === 0) {
      alert(unreadOnly ? '未確認の資料はありません。' : '資料がありません。');
      return;
    }

    let msg =
      `「${course}」の授業資料 ${items.length} 件の添付ファイルをダウンロードします。\n\n` +
      `・保存先: ダウンロードフォルダ/${(await K.getSettings()).rootFolder}/${courseFolderName(course)}/\n` +
      '・開いた資料は既読(未確認が消える)になります。\n' +
      '・終わるまで、このタブや別のタブでカスパを操作しないでください。';
    if (p && p.pages > 1) {
      msg += `\n\n※ 資料が ${p.total} 件あり1ページに収まらないため、表示中のページの分だけ処理します。`;
    }
    if (!confirm(msg)) return;

    stopRequested = false;
    const job = {
      course,
      courseFolder: courseFolderName(course),
      items,
      idx: 0,
      stats: { items: 0, files: 0, noAttach: 0, skipped: 0 },
      startedAt: Date.now()
    };
    saveJob(job);
    await runStep(job);
  };

  // ---------- 1資料分の処理 ----------
  const findRow = (item) => {
    const rows = [...document.querySelectorAll(SEL.rows)];
    const titleOf = (tr) => {
      const a = titleLink(tr);
      return a ? a.innerText.trim() : null;
    };
    const exact = rows.find((tr) => Number(tr.dataset.ri) === item.ri && titleOf(tr) === item.title);
    return exact || rows.find((tr) => titleOf(tr) === item.title) || null;
  };

  const checkAlive = (job) => {
    if (K.isErrorPage()) throw new Error('カスパがエラー画面になりました');
    const course = K.getCourse();
    if (course !== job.course) {
      throw new Error(`表示中の授業が変わりました(「${course || '不明'}」)。別の画面でカスパを操作しませんでしたか？`);
    }
    if (stopRequested || (loadJob() || {}).stopRequested) {
      const e = new Error('ユーザーが中止しました');
      e.userStop = true;
      throw e;
    }
  };

  const downloadFile = async (job, item, fileIdx, label) => {
    const dlg = document.querySelector(SEL.dialog);
    const btn = dlg && dlg.querySelector(`[id="jga02303:ch:appendList:${fileIdx}:j_idt506"]`);
    // ID が変わっていた場合に備え、行の中の「表示されているボタン」でも探す
    const row = dlg && dlg.querySelectorAll(SEL.fileRow)[fileIdx];
    const target = btn || (row && [...row.querySelectorAll('button')].find((b) => !b.classList.contains('dispNone')));
    if (!target) throw new Error(`ダウンロードボタンが見つかりません: ${label}`);

    // ダウンロードを待ち受けてもらってからクリックする
    const { token } = await K.send({
      type: 'kaspa:arm',
      courseFolder: job.courseFolder,
      itemFolder: itemFolderName(item)
    });
    target.click();
    const res = await K.send({ type: 'kaspa:wait', token, timeoutMs: 45000 });
    if (!res || !res.ok) {
      const msgs = K.getMessages();
      throw new Error(
        `「${label}」のダウンロードが始まりませんでした` +
          (msgs.length ? `(カスパ: ${msgs.join(' / ')})` : '') +
          '。Chrome が「複数ファイルのダウンロード」をブロックしていないか確認してください。'
      );
    }
    await K.waitAjaxIdle();
    await K.sleep(800);
  };

  const processItem = async (job, item) => {
    const row = findRow(item);
    if (!row) {
      job.stats.skipped++;
      return false; // 一覧のまま次へ
    }
    titleLink(row).click();
    await K.waitAjaxIdle();
    // 詳細表示になる(一覧が消える)のを待つ
    await K.waitFor(() => !isListPage() || document.querySelector(SEL.attachBtn), 15000);
    await K.sleep(300);
    checkAlive(job);

    const attach = document.querySelector(SEL.attachBtn);
    if (!attach) {
      job.stats.noAttach++;
    } else {
      attach.click();
      await K.waitAjaxIdle();
      const dlg = await K.waitFor(() => {
        const d = document.querySelector(SEL.dialog);
        return K.isDialogOpen(d) ? d : null;
      }, 15000);
      if (!dlg) throw new Error(`添付ファイル一覧が開きませんでした: ${item.title}`);
      await K.sleep(500);

      const files = [...dlg.querySelectorAll(SEL.fileRow)].map((r) =>
        (r.querySelector(SEL.fileName) || r).innerText.trim().replace(/\s+/g, ' ')
      );
      for (let f = 0; f < files.length; f++) {
        checkAlive(job);
        setPanel(
          `${job.idx + 1} / ${job.items.length} 件目: ${item.title}\n` +
            `ファイル ${f + 1} / ${files.length}: ${files[f]}`,
          [stopButton]
        );
        await downloadFile(job, item, f, files[f]);
        job.stats.files++;
        saveJob(job);
      }
      const close = dlg.querySelector('.ui-dialog-titlebar-close');
      if (close) close.click();
      await K.sleep(300);
    }
    job.stats.items++;
    return true; // 詳細を開いたので一覧へ戻る必要あり
  };

  const backToList = async () => {
    const link = await K.waitFor(() => {
      const links = [...document.querySelectorAll(SEL.breadcrumbLink)];
      return links.find((a) => a.innerText.trim() === '授業資料一覧') || links[links.length - 1];
    }, 10000);
    if (!link) throw new Error('「授業資料一覧」へ戻るリンクが見つかりません');
    link.click(); // ページ全体が再読み込みされ、読み込み後に resume() から続きを行う
  };

  // 一覧画面で、job.idx の資料を処理して一覧へ戻る(戻ったページで次を処理)
  const runStep = async (job) => {
    try {
      while (job.idx < job.items.length) {
        checkAlive(job);
        const item = job.items[job.idx];
        setPanel(`${job.idx + 1} / ${job.items.length} 件目: ${item.title}`, [stopButton]);
        const opened = await processItem(job, item);
        job.idx++;
        saveJob(job);
        if (opened) {
          await backToList();
          return;
        }
      }
      finish(job);
    } catch (e) {
      fail(e, job);
    }
  };

  const summary = (job) =>
    `資料 ${job.stats.items} 件 / ファイル ${job.stats.files} 件をダウンロードしました。` +
    (job.stats.noAttach ? `\n添付なし: ${job.stats.noAttach} 件` : '') +
    (job.stats.skipped ? `\n一覧で見つからずスキップ: ${job.stats.skipped} 件` : '') +
    `\n保存先: ダウンロードフォルダ内「${job.courseFolder}」`;

  const finish = (job) => {
    clearJob();
    setPanel(`完了しました。\n${summary(job)}`, [{ label: '閉じる', onClick: removePanel }]);
  };

  const fail = (e, job) => {
    clearJob();
    K.send({ type: 'kaspa:disarm' }).catch(() => {});
    const head = e && e.userStop ? '中止しました。' : `中断しました: ${e && e.message ? e.message : e}`;
    setPanel(job ? `${head}\n${summary(job)}` : head, [{ label: '閉じる', onClick: removePanel }]);
  };

  // ---------- ページ読み込み時 ----------
  const resume = async () => {
    const job = loadJob();
    if (!job) return;
    if (K.isErrorPage()) {
      clearJob();
      alert('カスパがエラー画面になったため、授業資料の一括ダウンロードを中断しました。');
      return;
    }
    if (job.stopRequested) {
      fail({ userStop: true }, job);
      return;
    }
    // ページの描画と初期化が落ち着くのを待つ
    await K.waitFor(isListPage, 15000);
    await K.waitAjaxIdle().catch(() => {});
    await K.sleep(800);
    if (!isListPage()) {
      fail(new Error('授業資料一覧に戻れませんでした'), job);
      return;
    }
    await runStep(job);
  };

  const init = () => {
    if (isListPage()) injectToolbar();
    // 一覧は Ajax で描き直されることがあるので監視して差し込み直す
    let timer = null;
    new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (isListPage() && !loadJob()) injectToolbar();
      }, 300);
    }).observe(document.body, { childList: true, subtree: true });
    resume();
  };

  K.bulk = { start, resume, readRows, readPaginator, loadJob, clearJob };
  init();
})();
