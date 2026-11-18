'use strict';
function uiAnimationFrame(time, fps, count) {
  if (!Number.isFinite(count) || count < 1) return 0;
  const elapsed = Number.isFinite(time) ? Math.max(0, time) : 0;
  return Math.floor(elapsed / 1000 * fps) % count;
}
// Render the supplied PNG sheets using source rectangles. Original files stay intact.
const VillageUI = (() => {
  const sheets = new Map(), rendered = new Map(), cursors = {};
  let atlas = null;
  function renderIcon(context, key, x, y, width, height) {
    const icon = atlas?.icons[key], image = icon && sheets.get(icon.sheet);
    if (!image) return false;
    const [sx, sy, sw, sh] = icon.rect;
    const scale = Math.min(width / sw, height / sh);
    const dw = Math.max(1, Math.round(sw * scale)), dh = Math.max(1, Math.round(sh * scale));
    context.imageSmoothingEnabled = false;
    context.drawImage(image, sx, sy, sw, sh, Math.round(x + (width - dw) / 2), Math.round(y + (height - dh) / 2), dw, dh);
    return true;
  }
  function paintAll(root = document) {
    root.querySelectorAll('canvas[data-ui-icon]').forEach(element => {
      const key = element.dataset.uiIcon, cacheKey = key + ':' + element.width + ':' + element.height;
      let bitmap = rendered.get(cacheKey);
      if (!bitmap) {
        bitmap = document.createElement('canvas');
        bitmap.width = element.width; bitmap.height = element.height;
        if (!renderIcon(bitmap.getContext('2d'), key, 0, 0, bitmap.width, bitmap.height)) return;
        rendered.set(cacheKey, bitmap);
      }
      const context = element.getContext('2d');
      context.clearRect(0, 0, element.width, element.height);
      context.drawImage(bitmap, 0, 0);
      element.dataset.artReady = 'true';
    });
  }
  function icon(key, size = 24, className = '') {
    if (!/^[a-z-]+$/.test(key)) return '';
    return `<canvas class="ui-icon ${className}" data-ui-icon="${key}" width="${size}" height="${size}" aria-hidden="true"></canvas>`;
  }
  function effect(context, key, time, x, y, width, height) {
    const effect = atlas?.effects[key], image = effect && sheets.get(effect.sheet);
    if (!image || !effect.frames?.length) return false;
    // requestAnimationFrame's timestamp can precede a just-created effect's
    // performance.now() start time within the same display frame.
    const frame = uiAnimationFrame(time, effect.fps, effect.frames.length);
    context.imageSmoothingEnabled = false;
    context.drawImage(image, ...effect.frames[frame], Math.round(x - width / 2), Math.round(y - height), width, height);
    return true;
  }
  function makeCursors() {
    for (const [key, iconName, hotspot] of [['default', 'cursor-arrow', [8,2]], ['hand', 'cursor-hand', [13,2]], ['target', 'cursor-target', [18,18]]]) {
      const bitmap = document.createElement('canvas'); bitmap.width = 36; bitmap.height = 36;
      if (renderIcon(bitmap.getContext('2d'), iconName, 0, 0, 36, 36)) {
        cursors[key] = `url("${bitmap.toDataURL('image/png')}") ${hotspot[0]} ${hotspot[1]}, ${key === 'hand' ? 'pointer' : key === 'target' ? 'crosshair' : 'default'}`;
        document.documentElement.style.setProperty('--village-cursor-' + key, cursors[key]);
      }
    }
  }
  const ready = fetch('assets/ui-atlas.json').then(response => {
    if (!response.ok) throw new Error('UI atlas unavailable');
    return response.json();
  }).then(async data => {
    atlas = data;
    const results = await Promise.allSettled(Object.entries(data.sheets).map(([key, spec]) => new Promise((resolve,reject) => {
      const image = new Image();
      image.onload = () => {
        if (image.naturalWidth !== spec.size[0] || image.naturalHeight !== spec.size[1]) return reject(new Error('Unexpected sheet dimensions: ' + key));
        sheets.set(key, image); resolve(key);
      };
      image.onerror = () => reject(new Error('Failed UI asset: ' + key));
      image.src = 'assets/' + spec.file;
    })));
    document.documentElement.dataset.uiSheetsLoaded = String(sheets.size);
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) console.warn('Some supplied UI sheets could not be loaded.');
    paintAll(); makeCursors(); document.dispatchEvent(new Event('village-art-ready'));
  }).catch(() => { document.documentElement.dataset.uiSheetsLoaded = '0'; });
  return {icon, paintAll, renderIcon, effect, ready, cursor: key => cursors[key] || (key === 'hand' ? 'pointer' : key === 'target' ? 'crosshair' : 'default')};
})();
