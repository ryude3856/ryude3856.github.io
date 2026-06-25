import { loadSettings, saveSettings } from './settings.js';
import { initSplitter } from './splitter.js';
import { createRecorder } from './recorder.js';
import { initLog } from './log.js';
import { initStats } from './stats.js';
import { initTimeline } from './timeline.js';
import { initSync } from './sync.js';

window.__tt = window.__tt || {};

document.addEventListener('DOMContentLoaded', () => {
  const settings = loadSettings();
  window.__tt.settings = settings;

  const paneLeft = document.querySelector('[data-testid="pane-left"]');
  const divider = document.querySelector('[data-testid="divider"]');
  const paneRight = document.querySelector('[data-testid="pane-right"]');
  const textarea = document.querySelector('[data-testid="input"]');
  const logEl = document.querySelector('[data-testid="log"]');
  const canvas = document.querySelector('[data-testid="timeline-canvas"]');

  initSplitter(paneLeft, divider, paneRight, settings);

  const recorder = createRecorder(textarea, settings);
  window.__tt.recorder = recorder;

  const log = initLog(logEl, recorder, settings);
  window.__tt.log = log;

  const stats = initStats(
    document.querySelector('[data-testid="stat-speed"]'),
    document.querySelector('[data-testid="stat-interval"]'),
    document.querySelector('[data-testid="stat-release"]'),
    recorder,
    settings,
  );
  window.__tt.stats = stats;

  const timeline = initTimeline(canvas, recorder, settings);
  window.__tt.timelineLayout = () => timeline.getLayout();
  window.__tt.timelineScroll = () => timeline.getScroll();
  window.__tt.render = () => timeline.render();

  const sync = initSync(timeline, log);
  window.__tt.sync = sync;
  window.__tt.highlight = {
    getRefIndex: () => sync.getRefIndex(),
    getHoverIndex: () => sync.getHoverIndex(),
    setHover: (i) => sync.setHover(i),
  };

  // 新規打鍵のたびに終端ハイライトを更新
  recorder.on('keydown', () => sync.refreshRef());
  recorder.on('keyup', () => sync.refreshRef());

  // ---- リセットボタン ----
  const resetBtn = document.querySelector('[data-testid="reset-btn"]');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      recorder.reset();
      log.reset();
      stats.reset();
      timeline.reset();
      sync.reset();
      textarea.value = '';
      textarea.focus();
    });
  }

  // ---- 設定 UI の初期化と変更ハンドリング ----
  const settingsDefs = [
    { testid: 'settings-updateMode', key: 'updateMode', type: 'string' },
    { testid: 'settings-idleThresholdMs', key: 'idleThresholdMs', type: 'number' },
    { testid: 'settings-pxPerMs', key: 'pxPerMs', type: 'number' },
    { testid: 'settings-maxHoldMs', key: 'maxHoldMs', type: 'number' },
    { testid: 'settings-maxLogEntries', key: 'maxLogEntries', type: 'number' },
  ];

  for (const { testid, key, type } of settingsDefs) {
    const el = document.querySelector(`[data-testid="${testid}"]`);
    if (!el) continue;

    // 現在の設定値で UI を初期化
    el.value = settings[key];

    el.addEventListener('input', () => {
      const raw = el.value;
      const val = type === 'number' ? parseFloat(raw) : raw;
      if (type === 'number') {
        // 空・非数・0以下・min/max 範囲外は不正値として無視（直前の有効値を保持）
        if (raw.trim() === '' || isNaN(val) || val <= 0) return;
        const min = el.min !== '' ? parseFloat(el.min) : null;
        const max = el.max !== '' ? parseFloat(el.max) : null;
        if (min !== null && val < min) return;
        if (max !== null && val > max) return;
      }
      settings[key] = val;
      saveSettings(settings);
      if (key === 'updateMode') {
        timeline.setUpdateMode(val);
      } else {
        timeline.render(); // 設定変更を即時反映
      }
    });
  }
});
