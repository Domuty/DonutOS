// Account pictures: either an uploaded image or initials on a coloured circle.

import { h } from './h.js';

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const chars = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
  return chars.toUpperCase();
}

export function avatar(account, size = 48) {
  const a = account?.avatar || {};
  const el = h('span.avatar', { style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` }, 'aria-hidden': 'true' });
  if (a.type === 'image' && a.data) {
    el.append(h('img', { src: a.data, alt: '', draggable: 'false' }));
  } else if (account?.isGuest) {
    el.style.background = a.color || '#6b6475';
    el.innerHTML = `<svg viewBox="0 0 24 24" width="${size * 0.55}" height="${size * 0.55}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></svg>`;
  } else {
    el.style.background = a.color || '#e8618c';
    el.textContent = initials(account?.name);
  }
  return el;
}

/** Shrinks an image file to a square JPEG data URL suitable for an account picture. */
export async function imageToAvatar(bytes, mime = 'image/png', size = 256) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is not an image DonutOS can read'));
      i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
