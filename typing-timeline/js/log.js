import { END_EPS } from './constants.js';

export function initLog(logEl, recorder, settings) {
  let prevDownTime = null;
  let autoScroll = true;
  let onHoverCallback = null;

  logEl.addEventListener('scroll', () => {
    // 末尾（END_EPS 以内）に居るときだけオートスクロール。終端から少しでも
    // 離れたら即 manual 扱いにし、上方向スクロールでの脱出を妨げない。
    const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - END_EPS;
    autoScroll = atBottom;
  });

  // イベント委譲でホバー検出
  logEl.addEventListener('mouseover', (e) => {
    if (!onHoverCallback) return;
    const row = e.target.closest('[data-index]');
    onHoverCallback(row ? parseInt(row.dataset.index, 10) : -1);
  });

  logEl.addEventListener('mouseout', (e) => {
    if (!onHoverCallback) return;
    // ログ要素内の別行へ移動した場合はクリアしない
    const toInLog = e.relatedTarget?.closest('[data-testid="log"]');
    if (!toInLog) onHoverCallback(-1);
  });

  recorder.on('keydown', (seg, index) => {
    const interval = prevDownTime !== null ? seg.downTime - prevDownTime : null;
    const isIdle = interval !== null && interval > settings.idleThresholdMs;
    prevDownTime = seg.downTime;

    const row = document.createElement('div');
    row.className = 'log-row';
    row.setAttribute('data-testid', 'log-row');
    row.setAttribute('data-index', String(index));
    row.setAttribute('data-idle', isIdle ? 'true' : 'false');

    const labelEl = document.createElement('span');
    labelEl.className = 'log-col log-col-label';
    labelEl.textContent = seg.label;

    const intervalEl = document.createElement('span');
    intervalEl.className = 'log-col log-col-interval';
    if (interval === null) {
      intervalEl.textContent = '—';
    } else {
      intervalEl.textContent = Math.round(interval) + 'ms';
      if (isIdle) intervalEl.classList.add('log-col-interval--idle');
    }

    const releaseEl = document.createElement('span');
    releaseEl.className = 'log-col log-col-release';

    row.append(labelEl, intervalEl, releaseEl);
    logEl.appendChild(row);

    if (autoScroll) logEl.scrollTop = logEl.scrollHeight;
  });

  // 記録上限キャップで破棄された最古セグメントに対応する行を取り除く
  recorder.on('trim', (seg, id) => {
    const row = logEl.querySelector(`[data-index="${id}"]`);
    if (row) row.remove();
  });

  recorder.on('keyup', (seg, index) => {
    const row = logEl.querySelector(`[data-index="${index}"]`);
    if (!row) return;
    const releaseEl = row.querySelector('.log-col-release');
    if (seg.closedBy === 'keyup') {
      releaseEl.textContent = Math.round(seg.upTime - seg.downTime) + 'ms';
    } else {
      releaseEl.textContent = '—';
    }
    if (autoScroll) logEl.scrollTop = logEl.scrollHeight;
  });

  function reset() {
    logEl.innerHTML = '';
    prevDownTime = null;
    autoScroll = true;
  }

  function setHighlight(refIdx, hoverIdx) {
    // 既存ハイライトをクリア
    const prevRef = logEl.querySelector('.log-row--ref');
    const prevHover = logEl.querySelector('.log-row--hover');
    if (prevRef) prevRef.classList.remove('log-row--ref');
    if (prevHover) prevHover.classList.remove('log-row--hover');

    // ホバー優先。同じインデックスならホバー色のみ
    if (hoverIdx !== -1) {
      const hRow = logEl.querySelector(`[data-index="${hoverIdx}"]`);
      if (hRow) hRow.classList.add('log-row--hover');
    }
    if (refIdx !== -1 && refIdx !== hoverIdx) {
      const rRow = logEl.querySelector(`[data-index="${refIdx}"]`);
      if (rRow) rRow.classList.add('log-row--ref');
    }
  }

  function onHover(cb) {
    onHoverCallback = cb;
  }

  return {
    reset,
    getEl: () => logEl,
    getScrollMode: () => autoScroll ? 'follow' : 'manual',
    setScrollMode: (mode) => { autoScroll = mode === 'follow'; },
    setHighlight,
    onHover,
  };
}
