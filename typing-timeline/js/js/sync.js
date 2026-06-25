import { END_EPS } from './constants.js';

export function initSync(timelineApi, logApi) {
  const wrapper = timelineApi.getWrapper();
  const logEl = logApi.getEl();

  if (!wrapper || !logEl) return {
    getTimelineRefIndex: () => -1,
    getLogRefIndex: () => -1,
    refreshRef: () => {},
    reset: () => {},
    setHover: () => {},
    getRefIndex: () => -1,
    getHoverIndex: () => -1,
  };

  // null = 抑制なし。値が一致したら sync 由来の echo とみなして無視する。
  // 注意: scrollLeft/scrollTop に代入した値はブラウザが整数（デバイスピクセル）へ
  // 丸める/クランプするため、代入した fractional 値と後続 scroll イベントで読める
  // 実値は一致しない。echo 判定は「代入後に読み戻した実値」と「1px 未満の許容差」で行う。
  let timelineSyncTarget = null;
  let logSyncTarget = null;

  // echo 抑制の許容差（サブピクセル丸めを吸収。これ未満の手動スクロールは知覚されない）
  const ECHO_EPS = 1;
  const isEcho = (current, target) => target !== null && Math.abs(current - target) < ECHO_EPS;

  let rafPending = false;
  let pendingMaster = null; // 'timeline' | 'log'

  // ハイライト状態
  let currentRefIndex = -1;
  let currentHoverIndex = -1;

  // ---- 画面外インジケータ ----

  function createIndicator(text) {
    const el = document.createElement('div');
    el.className = 'hl-indicator';
    el.textContent = text;
    document.body.appendChild(el);
    return el;
  }

  const tlLeftInd  = createIndicator('←');
  const tlRightInd = createIndicator('→');
  const logUpInd   = createIndicator('↑');
  const logDownInd = createIndicator('↓');

  function placeFixed(el, container, side) {
    const r = container.getBoundingClientRect();
    el.style.position = 'fixed';
    if (side === 'left') {
      el.style.left = (r.left + 4) + 'px';
      el.style.top  = (r.top + r.height / 2) + 'px';
      el.style.right = '';
      el.style.bottom = '';
      el.style.transform = 'translateY(-50%)';
    } else if (side === 'right') {
      el.style.left = '';
      el.style.right = (window.innerWidth - r.right + 4) + 'px';
      el.style.top  = (r.top + r.height / 2) + 'px';
      el.style.bottom = '';
      el.style.transform = 'translateY(-50%)';
    } else if (side === 'up') {
      el.style.left = (r.left + r.width / 2) + 'px';
      el.style.top  = (r.top + 4) + 'px';
      el.style.right = '';
      el.style.bottom = '';
      el.style.transform = 'translateX(-50%)';
    } else if (side === 'down') {
      el.style.left = (r.left + r.width / 2) + 'px';
      el.style.bottom = (window.innerHeight - r.bottom + 4) + 'px';
      el.style.top = '';
      el.style.right = '';
      el.style.transform = 'translateX(-50%)';
    }
    el.classList.add('visible');
  }

  function hideIndicators() {
    tlLeftInd.classList.remove('visible');
    tlRightInd.classList.remove('visible');
    logUpInd.classList.remove('visible');
    logDownInd.classList.remove('visible');
  }

  function updateOffscreenIndicators(hoverIdx) {
    hideIndicators();
    if (hoverIdx < 0) return;

    // タイムラインバーが画面外かチェック（ログ行をホバー中の場合に関係）
    const layout = timelineApi.getLayout();
    const bar = layout.bars.find(b => b.index === hoverIdx);
    if (bar) {
      const sl = wrapper.scrollLeft;
      const viewRight = sl + wrapper.clientWidth;
      if (bar.xEnd <= sl) placeFixed(tlLeftInd, wrapper, 'left');
      else if (bar.xStart >= viewRight) placeFixed(tlRightInd, wrapper, 'right');
    }

    // ログ行が画面外かチェック（canvas バーをホバー中の場合に関係）
    const row = logEl.querySelector(`[data-index="${hoverIdx}"]`);
    if (row) {
      const rowRect = row.getBoundingClientRect();
      const logRect = logEl.getBoundingClientRect();
      if (rowRect.bottom <= logRect.top) placeFixed(logUpInd, logEl, 'up');
      else if (rowRect.top >= logRect.bottom) placeFixed(logDownInd, logEl, 'down');
    }
  }

  // ---- ハイライト更新 ----

  function updateHighlights(refIdx, hoverIdx) {
    currentRefIndex = refIdx;
    currentHoverIndex = hoverIdx;
    timelineApi.setHighlight(refIdx, hoverIdx);
    logApi.setHighlight(refIdx, hoverIdx);
    updateOffscreenIndicators(hoverIdx);
  }

  // ---- インデックス算出 ----

  function getTimelineRefIndex() {
    const layout = timelineApi.getLayout();
    if (layout.bars.length === 0) return -1;
    // 右端時刻（論理 x 座標）以下の xStart を持つ最後のバー
    const rightEdgeX = wrapper.scrollLeft + wrapper.clientWidth;
    let ref = 0;
    for (const bar of layout.bars) {
      if (bar.xStart <= rightEdgeX) ref = bar.index;
    }
    return ref;
  }

  function getLogRefIndex() {
    const rows = logEl.querySelectorAll('[data-index]');
    if (!rows.length) return -1;
    const logBottom = logEl.getBoundingClientRect().bottom;
    // 行は DOM 順に offsetTop（= viewport top）が単調増加するため、
    // 述語「top < logBottom」は先頭からの連続区間で真になる。
    // それを満たす最後の行（= 基準打鍵）を二分探索で求める（O(log n)）。
    // 各行の高さが不揃いでも単調性は保たれるので等高仮定は不要。
    const visible = (p) => rows[p].getBoundingClientRect().top < logBottom;
    let lo = 0, hi = rows.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (visible(mid)) { ans = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    if (ans === -1) ans = 0; // どの行も可視でない退行ケースは先頭行を基準にする
    return parseInt(rows[ans].getAttribute('data-index'), 10);
  }

  // ---- スクロール操作（echo 抑制付き） ----

  function scrollTimelineToBar(i) {
    const layout = timelineApi.getLayout();
    // i は安定 ID（配列位置ではない）。bar.index で照合する。
    const bar = layout.bars.find(b => b.index === i);
    if (!bar) return;
    const maxScroll = Math.max(0, wrapper.scrollWidth - wrapper.clientWidth);
    // バー i の右端が右辺に来る位置（0 と maxScroll でクランプ）
    const desired = Math.max(0, Math.min(bar.xEnd - wrapper.clientWidth, maxScroll));
    wrapper.scrollLeft = desired;
    // ブラウザが丸めた実値を抑制対象にする（fractional desired のままだと echo を取りこぼす）
    const applied = wrapper.scrollLeft;
    timelineSyncTarget = applied;
    // 1 フレーム後に抑制を解除（scroll が発火しなかった場合の保険）
    requestAnimationFrame(() => { if (timelineSyncTarget === applied) timelineSyncTarget = null; });
  }

  function scrollLogToRow(i) {
    const row = logEl.querySelector(`[data-index="${i}"]`);
    if (!row) return;
    const rowRect = row.getBoundingClientRect();
    const logRect = logEl.getBoundingClientRect();
    // コンテンツ内での行の上端位置
    const rowTopInContent = rowRect.top - logRect.top + logEl.scrollTop;
    // 行の下端をログ下端に合わせる scrollTop
    const target = Math.max(0, rowTopInContent + row.offsetHeight - logEl.clientHeight);
    // ブラウザが scrollTop をクランプして scroll イベントが発火しない場合も
    // autoScroll を確実に false にするため明示的に manual モードを設定する
    logApi.setScrollMode('manual');
    logEl.scrollTop = target;
    const applied = logEl.scrollTop; // ブラウザが丸めた実値を抑制対象にする
    logSyncTarget = applied;
    requestAnimationFrame(() => { if (logSyncTarget === applied) logSyncTarget = null; });
  }

  // ---- 終端判定 ----

  function isTimelineAtEnd() {
    const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
    return maxScroll <= 0 || maxScroll - wrapper.scrollLeft <= END_EPS;
  }

  function isLogAtEnd() {
    const maxScroll = logEl.scrollHeight - logEl.clientHeight;
    return maxScroll <= 0 || maxScroll - logEl.scrollTop <= END_EPS;
  }

  // ---- 両終端スナップ ----

  function snapBothToEnd() {
    const maxTl = Math.max(0, wrapper.scrollWidth - wrapper.clientWidth);
    wrapper.scrollLeft = maxTl;
    const appliedTl = wrapper.scrollLeft; // ブラウザが丸めた実値を抑制対象にする
    timelineSyncTarget = appliedTl;
    requestAnimationFrame(() => { if (timelineSyncTarget === appliedTl) timelineSyncTarget = null; });

    const maxLog = Math.max(0, logEl.scrollHeight - logEl.clientHeight);
    logEl.scrollTop = maxLog;
    const appliedLog = logEl.scrollTop;
    logSyncTarget = appliedLog;
    requestAnimationFrame(() => { if (logSyncTarget === appliedLog) logSyncTarget = null; });
  }

  // ---- rAF で間引いた同期処理 ----

  function performSync() {
    rafPending = false;
    const master = pendingMaster;
    pendingMaster = null;

    if (master === 'timeline') {
      const i = getTimelineRefIndex();
      if (i >= 0) scrollLogToRow(i);
      // master が終端付近に戻ったら両者をスナップ（slave の小さい maxScroll による誤検知を防ぐため master のみ判定）
      if (isTimelineAtEnd()) snapBothToEnd();
      updateHighlights(getTimelineRefIndex(), currentHoverIndex);
    } else if (master === 'log') {
      const i = getLogRefIndex();
      if (i >= 0) scrollTimelineToBar(i);
      if (isLogAtEnd()) snapBothToEnd();
      updateHighlights(getLogRefIndex(), currentHoverIndex);
    }
  }

  function scheduleSync(master) {
    pendingMaster = master; // 直近の操作側が勝つ
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(performSync);
    }
  }

  // ---- scroll イベント購読（echo 抑制込み） ----

  wrapper.addEventListener('scroll', () => {
    // sync.js 自身がセットした値なら echo とみなす（丸め差は ECHO_EPS で吸収）
    if (isEcho(wrapper.scrollLeft, timelineSyncTarget)) return;
    // タイムラインが終端から離れたら即座にログの自動スクロールも無効化する
    // （performSync の rAF を待つとキーダウン処理と競合するため同期的に行う）
    if (!isTimelineAtEnd()) logApi.setScrollMode('manual');
    scheduleSync('timeline');
  });

  logEl.addEventListener('scroll', () => {
    if (isEcho(logEl.scrollTop, logSyncTarget)) return;
    scheduleSync('log');
  });

  // ---- ホバーコールバック配線 ----

  timelineApi.onHover((i) => {
    updateHighlights(currentRefIndex, i);
  });

  logApi.onHover((i) => {
    updateHighlights(currentRefIndex, i);
  });

  // ---- リセット ----

  function reset() {
    currentRefIndex = -1;
    currentHoverIndex = -1;
    hideIndicators();
    timelineApi.setHighlight(-1, -1);
    logApi.setHighlight(-1, -1);
  }

  // ---- 公開 API ----

  function refreshRef() {
    const refIdx = getTimelineRefIndex();
    updateHighlights(refIdx, currentHoverIndex);
  }

  function setHover(i) {
    updateHighlights(currentRefIndex, i);
  }

  return {
    getTimelineRefIndex,
    getLogRefIndex,
    refreshRef,
    reset,
    setHover,
    getRefIndex: () => currentRefIndex,
    getHoverIndex: () => currentHoverIndex,
  };
}
