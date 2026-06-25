import { now } from './clock.js';

function formatLabel(code) {
  if (!code || code === 'Unidentified') return 'IME';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return '␣';
  if (code === 'Enter') return '↵';
  if (code === 'Backspace') return '⌫';
  if (code === 'ShiftLeft') return '⇧L';
  if (code === 'ShiftRight') return '⇧R';
  if (code === 'ControlLeft') return '⌃L';
  if (code === 'ControlRight') return '⌃R';
  if (code === 'AltLeft') return '⎇L';
  if (code === 'AltRight') return '⎇R';
  if (code === 'Tab') return '⇥';
  if (code === 'Escape') return 'Esc';
  if (code === 'CapsLock') return 'Caps';
  if (code === 'ArrowLeft') return '←';
  if (code === 'ArrowRight') return '→';
  if (code === 'ArrowUp') return '↑';
  if (code === 'ArrowDown') return '↓';
  return code;
}

function detectIME(e) {
  return !e.code || e.code === 'Unidentified' || e.keyCode === 229 || e.key === 'Process' || e.isComposing;
}

export function createRecorder(textarea, settings) {
  // セグメントは「id」で一意に識別する（配列位置ではなく安定 ID）。
  // 上限キャップで先頭を捨てても id は不変なので、タイムライン⇔ログの
  // インデックス整合（data-index / bar.index）が崩れない。
  let segments = [];
  let nextId = 0;
  const idMap = new Map();      // id → seg
  let activeKeys = new Map();   // code → id
  let timeoutIds = new Map();   // id → timeoutId
  const listeners = { keydown: [], keyup: [], trim: [] };

  function emit(event, seg, id) {
    for (const fn of listeners[event]) fn(seg, id);
  }

  function closeSeg(seg, closedBy) {
    if (seg.upTime !== null) return;
    seg.upTime = now();
    seg.closedBy = closedBy;
    const tid = timeoutIds.get(seg.id);
    if (tid !== undefined) { clearTimeout(tid); timeoutIds.delete(seg.id); }
    if (activeKeys.get(seg.code) === seg.id) activeKeys.delete(seg.code);
    emit('keyup', seg, seg.id);
  }

  function forceClose(id, closedBy) {
    const seg = idMap.get(id);
    if (seg) closeSeg(seg, closedBy);
  }

  function scheduleTimeout(id) {
    const tid = setTimeout(() => forceClose(id, 'timeout'), settings.maxHoldMs);
    timeoutIds.set(id, tid);
  }

  // 先頭（最古）セグメントを 1 件破棄し、購読側に通知する。
  function dropOldest() {
    const seg = segments.shift();
    if (!seg) return;
    idMap.delete(seg.id);
    const tid = timeoutIds.get(seg.id);
    if (tid !== undefined) { clearTimeout(tid); timeoutIds.delete(seg.id); }
    if (activeKeys.get(seg.code) === seg.id) activeKeys.delete(seg.code);
    emit('trim', seg, seg.id);
  }

  function onKeyDown(e) {
    if (e.repeat) return;
    const code = (e.code && e.code !== '') ? e.code : 'Unidentified';
    const isIME = detectIME(e);

    // 同一 code が keyup されないまま再 keydown された場合（主に IME の
    // Unidentified 連続）、直前セグメントをこの時点で打ち切ってから新規化する。
    const prevId = activeKeys.get(code);
    if (prevId !== undefined) forceClose(prevId, 'replaced');

    const id = nextId++;
    const seg = { id, code, label: formatLabel(code), downTime: now(), upTime: null, lane: null, closedBy: null, isIME };
    segments.push(seg);
    idMap.set(id, seg);
    activeKeys.set(code, id);
    scheduleTimeout(id);
    emit('keydown', seg, id);

    // 記録上限キャップ（古い順に破棄）
    const cap = settings.maxLogEntries;
    if (cap && cap > 0) {
      while (segments.length > cap) dropOldest();
    }
  }

  function onKeyUp(e) {
    const code = (e.code && e.code !== '') ? e.code : 'Unidentified';
    const id = activeKeys.get(code);
    if (id === undefined) return;
    const seg = idMap.get(id);
    if (seg) closeSeg(seg, 'keyup');
  }

  function onBlur() {
    const ids = [...activeKeys.values()];
    for (const id of ids) forceClose(id, 'blur');
  }

  textarea.addEventListener('keydown', onKeyDown);
  textarea.addEventListener('keyup', onKeyUp);
  textarea.addEventListener('blur', onBlur);

  function reset() {
    for (const id of timeoutIds.values()) clearTimeout(id);
    segments = [];
    nextId = 0;
    idMap.clear();
    activeKeys = new Map();
    timeoutIds = new Map();
  }

  return {
    get segments() { return segments; },
    get activeKeys() { return activeKeys; },
    on(event, fn) { listeners[event].push(fn); },
    reset,
    forceClose,
  };
}
