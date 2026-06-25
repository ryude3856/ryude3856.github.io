const STORAGE_KEY = 'typing-timeline.settings';

const DEFAULTS = {
  updateMode: 'raf',
  idleThresholdMs: 3000,
  pxPerMs: 0.5,
  maxHoldMs: 10000,
  paneRatio: 0.7,
  maxLogEntries: 10000,
};

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
