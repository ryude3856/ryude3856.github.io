export function now() {
  return typeof window.__ttClock === 'number' ? window.__ttClock : performance.now();
}
