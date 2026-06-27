import { now } from './clock.js';
import { END_EPS } from './constants.js';

const LANE_H = 26;
const PAD_Y = 4;

// ハイライト色は CSS 変数（:root の --hl-ref-bar / --hl-hover-bar）を正本とし、
// Canvas からも同じ値を読む。フォールバックは CSS 未読込時の保険。
function cssVar(name, fallback) {
  if (typeof getComputedStyle !== 'function') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function hlRefColor() { return cssVar('--hl-ref-bar', '#f0a500'); }
function hlHoverColor() { return cssVar('--hl-hover-bar', '#0099a8'); }

// ---- レイアウト算出（純粋関数） ----

export function computeLayout(segments, nowMs, settings) {
  const { pxPerMs, idleThresholdMs } = settings;

  if (segments.length === 0) {
    return { bars: [], laneCount: 0, dividers: [] };
  }

  // 1. 各セグメントの論理開始時刻を算出
  //    アイドル超過ギャップは idleThresholdMs に丸めて詰める
  const logStarts = [];
  let logicalNow = 0;
  let prevDownTime = null;
  const dividerXList = [];

  for (const seg of segments) {
    if (prevDownTime !== null) {
      const gap = seg.downTime - prevDownTime;
      if (gap > idleThresholdMs) {
        // 区切り線は次バーストの開始位置（＝次バーの xStart）に置く。
        // 先に logicalNow を進めてから divider 位置を記録することで、
        // 区切り線と次のバーが同じ x に揃い、区切り線の直後にバーが始まる。
        logicalNow += idleThresholdMs;            // 圧縮後は閾値分だけ進む
        dividerXList.push(logicalNow * pxPerMs);
      } else {
        logicalNow += gap;
      }
    }
    logStarts.push(logicalNow);
    prevDownTime = seg.downTime;
  }

  // 2. レーン割り当て（時刻順にイベントを処理）
  const events = [];
  for (let i = 0; i < segments.length; i++) {
    events.push({ type: 'down', time: segments[i].downTime, i });
    if (segments[i].upTime !== null) {
      events.push({ type: 'up', time: segments[i].upTime, i });
    }
  }
  // 同一時刻は keyup を先に処理してレーンを開放してから割り当て
  events.sort((a, b) =>
    a.time !== b.time ? a.time - b.time : (a.type === 'up' ? -1 : 1)
  );

  const lanes = new Array(segments.length).fill(0);
  const usedLanes = new Set();

  for (const ev of events) {
    if (ev.type === 'down') {
      let lane = 0;
      while (usedLanes.has(lane)) lane++;
      lanes[ev.i] = lane;
      usedLanes.add(lane);
    } else {
      usedLanes.delete(lanes[ev.i]);
    }
  }

  // 3. バー情報を構築
  let maxLane = 0;
  const bars = segments.map((seg, i) => {
    const upT = seg.upTime ?? nowMs;
    const durationMs = Math.max(0, upT - seg.downTime);
    const xStart = logStarts[i] * pxPerMs;
    const xEnd = xStart + durationMs * pxPerMs;
    if (lanes[i] > maxLane) maxLane = lanes[i];
    // index は安定 ID（配列位置ではない）。ログ行 data-index と対応する。
    return { index: seg.id, lane: lanes[i], xStart, xEnd, label: seg.label, durationMs, closedBy: seg.closedBy };
  });

  // 仮想カーソル位置と末尾アイドル破線:
  // 最後の keydown からの経過時間を canvas X 座標に変換し、
  // RAF ループ中に canvas を緩やかに伸ばしてジャンプを防ぐ。
  // アイドル閾値を超えた瞬間に破線を追加し、記録停止を即時視覚化する。
  let virtualCursorX = 0;
  if (segments.length > 0) {
    const lastLogStart = logStarts[logStarts.length - 1];
    const lastSeg = segments[segments.length - 1];
    const gapToNow = Math.max(0, nowMs - lastSeg.downTime);
    virtualCursorX = (lastLogStart + Math.min(gapToNow, idleThresholdMs)) * pxPerMs;
    if (gapToNow > idleThresholdMs) {
      dividerXList.push((lastLogStart + idleThresholdMs) * pxPerMs);
    }
  }

  return {
    bars,
    laneCount: maxLane + 1,
    dividers: dividerXList,
    virtualCursorX,
  };
}

// ---- Canvas 描画 ----

function draw(canvas, layout, hl = { refIndex: -1, hoverIndex: -1 }) {
  const ctx = canvas.getContext('2d');
  const wrapper = canvas.parentElement;

  const laneCount = Math.max(1, layout.laneCount);
  const h = PAD_Y * 2 + laneCount * LANE_H;
  const maxX = layout.bars.reduce((m, b) => Math.max(m, b.xEnd), 0);
  const w = Math.max(wrapper ? wrapper.clientWidth : 300, Math.max(maxX, layout.virtualCursorX ?? 0) + 60);

  canvas.width = w;
  canvas.height = h;

  ctx.clearRect(0, 0, w, h);

  // 区切り線
  ctx.strokeStyle = '#bbb';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const x of layout.dividers) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // バー
  for (const bar of layout.bars) {
    const y = PAD_Y + bar.lane * LANE_H;
    const bh = LANE_H - 4;
    const bw = Math.max(2, bar.xEnd - bar.xStart);

    // keyup 以外の異常終了（blur/timeout/replaced）は「打ち切り」表示にする
    const isCutoff = !!bar.closedBy && bar.closedBy !== 'keyup';
    let fill = bar.durationMs === 0 ? '#aaa' : (isCutoff ? '#c0392b' : '#4a90e2');
    if (bar.index === hl.hoverIndex) fill = hlHoverColor();
    else if (bar.index === hl.refIndex) fill = hlRefColor();
    ctx.fillStyle = fill;
    ctx.fillRect(bar.xStart, y, bw, bh);

    // 打ち切りバーの右端にハッチ模様を重ねる
    if (isCutoff && bw > 4 && bar.index !== hl.hoverIndex && bar.index !== hl.refIndex) {
      ctx.save();
      ctx.beginPath();
      const hatchX = Math.max(bar.xStart, bar.xEnd - Math.min(10, bw / 3));
      ctx.rect(hatchX, y, bar.xEnd - hatchX, bh);
      ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(hatchX, y, bar.xEnd - hatchX, bh);
      ctx.restore();
    }

    if (bw > 16) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(bar.xStart, y, bw, bh);
      ctx.clip();
      ctx.fillStyle = '#fff';
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${bar.label} ${Math.round(bar.durationMs)}ms`, bar.xStart + 3, y + bh / 2);
      ctx.restore();
    }
  }
}

// ---- 初期化 ----

export function initTimeline(canvas, recorder, settings) {
  const wrapper = canvas.parentElement;

  let scrollMode = 'follow';
  let scrollLeft = 0;
  // プログラムがセットした scrollLeft 値。scroll イベントがこの値と一致かつ follow なら echo とみなす
  let scrollTarget = 0;
  let rafPending = false;

  // ハイライト状態
  let hlRef = -1;
  let hlHover = -1;
  let onHoverCallback = null;

  function getLayout() {
    return computeLayout(recorder.segments, now(), settings);
  }

  function applyFollow() {
    if (!wrapper || scrollMode !== 'follow') return;
    const maxScroll = Math.max(0, canvas.width - wrapper.clientWidth);
    scrollTarget = maxScroll;
    wrapper.scrollLeft = maxScroll;
    scrollLeft = maxScroll;
  }

  function render() {
    draw(canvas, getLayout(), { refIndex: hlRef, hoverIndex: hlHover });
    applyFollow();
  }

  function scheduleRender() {
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        render();
      });
    }
  }

  if (wrapper) {
    wrapper.addEventListener('scroll', () => {
      const newLeft = wrapper.scrollLeft;
      // プログラム由来の scroll イベントを無視（echo 抑制）
      if (newLeft === scrollTarget && scrollMode === 'follow') return;
      scrollLeft = newLeft;
      const maxScroll = Math.max(0, wrapper.scrollWidth - wrapper.clientWidth);
      if (maxScroll <= 0 || maxScroll - newLeft <= END_EPS) {
        scrollMode = 'follow';
        scrollTarget = newLeft; // follow 復帰時に次の echo を防ぐため更新
      } else {
        scrollMode = 'manual';
      }
    });

    // マウスホイールの縦入力を横スクロールに変換（Shift 不要）
    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      // deltaX が非ゼロ（タッチパッド横スワイプ等）はそのまま、縦ホイールは deltaY を使用
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      wrapper.scrollLeft += delta;
    }, { passive: false });
  }

  // ---- rAF ループ（updateMode: 'raf' 用）----
  let rafLoopId = null;

  function startRafLoop() {
    if (rafLoopId !== null) return;
    function loop() {
      render();
      rafLoopId = requestAnimationFrame(loop);
    }
    rafLoopId = requestAnimationFrame(loop);
  }

  function stopRafLoop() {
    if (rafLoopId !== null) {
      cancelAnimationFrame(rafLoopId);
      rafLoopId = null;
    }
  }

  // keyup モード: keyup のみでレンダリング
  recorder.on('keyup', () => {
    if (settings.updateMode !== 'raf') scheduleRender();
  });

  // 初期モードを適用
  if (settings.updateMode === 'raf') startRafLoop();

  function setUpdateMode(mode) {
    if (mode === 'raf') {
      startRafLoop();
    } else {
      stopRafLoop();
      render(); // keyup モード切替直後に即時描画
    }
  }

  function getScroll() {
    return { scrollLeft, mode: scrollMode };
  }

  function setHighlight(refIdx, hoverIdx) {
    const hoverChanged = hoverIdx !== hlHover;
    hlRef = refIdx;
    hlHover = hoverIdx;
    // keyup モードでは hover 変化時のみ即時描画（keydown 由来の余剰 render を防ぐ）。
    // keyup イベント自体のレンダリングは recorder.on('keyup') が担う。
    // RAF モードはループが毎フレーム render するため scheduleRender は冗長だが無害。
    if (hoverChanged || settings.updateMode === 'raf') {
      scheduleRender();
    }
  }

  function onHover(cb) {
    onHoverCallback = cb;
  }

  // Canvas 上のバーのヒットテスト（マウス座標 → バーインデックス）
  if (canvas) {
    canvas.addEventListener('mousemove', (e) => {
      if (!onHoverCallback) return;
      const layout = getLayout();
      const rect = canvas.getBoundingClientRect();
      // getBoundingClientRect はスクロールを反映した viewport 座標を返すため
      // scrollLeft の加算は不要（二重計上になる）
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let hit = -1;
      for (const bar of layout.bars) {
        const by = PAD_Y + bar.lane * LANE_H;
        if (x >= bar.xStart && x <= bar.xEnd && y >= by && y < by + LANE_H) {
          hit = bar.index;
        }
      }
      onHoverCallback(hit);
    });
    canvas.addEventListener('mouseleave', () => {
      if (onHoverCallback) onHoverCallback(-1);
    });
  }

  function reset() {
    stopRafLoop();
    scrollMode = 'follow';
    scrollLeft = 0;
    scrollTarget = 0;
    hlRef = -1;
    hlHover = -1;
    draw(canvas, { bars: [], laneCount: 0, dividers: [] }, { refIndex: -1, hoverIndex: -1 });
    if (wrapper) wrapper.scrollLeft = 0;
    if (settings.updateMode === 'raf') startRafLoop();
  }

  function getBarBounds(i) {
    const layout = getLayout();
    const bar = layout.bars.find(b => b.index === i);
    if (!bar) return null;
    return { xStart: bar.xStart, xEnd: bar.xEnd, lane: bar.lane, LANE_H, PAD_Y };
  }

  return {
    render,
    reset,
    getLayout,
    getScroll,
    setUpdateMode,
    getWrapper: () => wrapper,
    setHighlight,
    onHover,
    getBarBounds,
  };
}
