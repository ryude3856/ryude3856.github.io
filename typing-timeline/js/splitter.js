import { saveSettings } from './settings.js';

const MIN_PX = 200;

export function initSplitter(paneLeft, divider, paneRight, settings) {
  // persist=false のときは幅の再適用のみ行い、settings.paneRatio は書き換えない。
  // （リサイズで一時的に幅が狭まってもユーザー指定の比率を失わないため）
  function applyRatio(ratio, persist = true) {
    const container = paneLeft.parentElement;
    const avail = container.offsetWidth - divider.offsetWidth;
    const minR = MIN_PX / avail;
    const maxR = (avail - MIN_PX) / avail;
    const clamped = Math.max(minR, Math.min(maxR, ratio));
    paneLeft.style.width = clamped * avail + 'px';
    if (persist) {
      settings.paneRatio = clamped;
      saveSettings(settings);
    }
  }

  applyRatio(settings.paneRatio);

  // ウィンドウリサイズ時は保存済み比率を維持して幅を再計算する
  window.addEventListener('resize', () => applyRatio(settings.paneRatio, false));

  // Pointer Events でマウス／タッチ／ペンを一括対応する
  let dragging = false;
  let startX = 0;
  let startW = 0;
  let activePointer = null;

  divider.addEventListener('pointerdown', (e) => {
    dragging = true;
    activePointer = e.pointerId;
    startX = e.clientX;
    startW = paneLeft.offsetWidth;
    divider.classList.add('dragging');
    // ポインタをキャプチャしてドラッグ中の move/up を確実に受け取る
    try { divider.setPointerCapture(e.pointerId); } catch { /* 合成イベント等は無視 */ }
    e.preventDefault();
  });

  divider.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== activePointer) return;
    const container = paneLeft.parentElement;
    const avail = container.offsetWidth - divider.offsetWidth;
    applyRatio((startW + e.clientX - startX) / avail);
  });

  function endDrag(e) {
    if (!dragging || (e && e.pointerId !== activePointer)) return;
    dragging = false;
    activePointer = null;
    divider.classList.remove('dragging');
    try { if (e && divider.hasPointerCapture(e.pointerId)) divider.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }

  divider.addEventListener('pointerup', endDrag);
  divider.addEventListener('pointercancel', endDrag);
}
