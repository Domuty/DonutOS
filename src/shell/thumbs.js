// Image thumbnails for files (desktop icons, File Explorer), cached by path and time.

const cache = new Map();
const THUMB_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg']);

export const canThumb = (e) => e.type === 'file' && THUMB_EXT.has(e.ext) && e.size < 12 * 1024 * 1024;

/** Resolves to a data URL of a small preview, or null if the image can't be read. */
export function thumbnail(fs, e, size = 96) {
  const key = `${e.path}|${e.mtime}|${size}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      try {
        // An <img> decodes every format the engine knows, including SVG.
        const url = URL.createObjectURL(await fs.readBlob(e.path));
        try {
          const img = new Image();
          img.src = url;
          await img.decode();
          const w = img.naturalWidth || size, hh = img.naturalHeight || size;
          const c = document.createElement('canvas');
          const s = Math.min(1, size / Math.max(w, hh));
          c.width = Math.max(1, Math.round(w * s));
          c.height = Math.max(1, Math.round(hh * s));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          return c.toDataURL('image/png');
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch { return null; }
    })());
    if (cache.size > 500) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}
