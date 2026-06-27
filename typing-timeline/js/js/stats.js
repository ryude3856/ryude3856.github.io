export function initStats(speedEl, intervalEl, releaseEl, recorder, settings) {
  let totalKeydowns = 0;
  let effectiveMs = 0;
  let prevDownTime = null;

  let intervalSum = 0;
  let intervalCount = 0;

  let releaseSum = 0;
  let releaseCount = 0;

  function render() {
    const speedVal = speedEl.querySelector('.stat-value');
    const intervalVal = intervalEl.querySelector('.stat-value');
    const releaseVal = releaseEl.querySelector('.stat-value');

    // 速度 = 集計対象の打鍵間隔の本数 ÷ それら間隔の合計時間。
    // 分子・分母とも「打鍵間隔」集合から取るため誤差が出ない（= 1000 / 間隔平均）。
    if (intervalCount === 0 || effectiveMs === 0) {
      speedVal.textContent = '—';
    } else {
      const kps = intervalCount / (effectiveMs / 1000);
      speedVal.textContent = `${kps.toFixed(1)} keys/s`;
    }

    intervalVal.textContent = intervalCount === 0
      ? '—'
      : `${Math.round(intervalSum / intervalCount)} ms`;

    releaseVal.textContent = releaseCount === 0
      ? '—'
      : `${Math.round(releaseSum / releaseCount)} ms`;
  }

  recorder.on('keydown', (seg) => {
    totalKeydowns++;
    if (prevDownTime !== null) {
      const gap = seg.downTime - prevDownTime;
      if (gap <= settings.idleThresholdMs) {
        effectiveMs += gap;
        intervalSum += gap;
        intervalCount++;
      }
    }
    prevDownTime = seg.downTime;
    render();
  });

  recorder.on('keyup', (seg) => {
    if (seg.closedBy === 'keyup') {
      releaseSum += seg.upTime - seg.downTime;
      releaseCount++;
      render();
    }
  });

  function reset() {
    totalKeydowns = 0;
    effectiveMs = 0;
    prevDownTime = null;
    intervalSum = 0;
    intervalCount = 0;
    releaseSum = 0;
    releaseCount = 0;
    render();
  }

  function getStats() {
    return {
      totalKeydowns,
      effectiveMs,
      speedKeysPerSec: (intervalCount > 0 && effectiveMs > 0)
        ? intervalCount / (effectiveMs / 1000)
        : null,
      intervalAvgMs: intervalCount > 0 ? intervalSum / intervalCount : null,
      releaseAvgMs: releaseCount > 0 ? releaseSum / releaseCount : null,
    };
  }

  render();
  return { reset, getStats };
}
