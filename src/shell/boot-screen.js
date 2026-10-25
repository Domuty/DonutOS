// Boot screen: the donut and a ring of dots while the kernel starts.

import { h, settle } from '../ui/h.js';

export const spinner = (cls = '') => h(`div.spinner${cls}`, { role: 'progressbar', 'aria-label': 'Loading' }, h('i'), h('i'), h('i'), h('i'), h('i'));

/** Boots the kernel behind the boot screen. Resolves with a function that fades the screen out. */
export async function runBoot(root, kernel) {
  const el = h('div.screen.boot-screen', { 'aria-label': 'DonutOS is starting' },
    h('img.boot-logo', { src: 'assets/brand/logo.svg', alt: 'DonutOS' }),
    spinner('.boot-spinner'));
  root.append(el);
  const t0 = performance.now();
  try {
    await kernel.boot();
  } catch (err) {
    el.querySelector('.boot-spinner').remove();
    el.append(h('div.boot-error',
      h('strong', 'DonutOS couldn’t start'),
      h('p', err.message),
      h('button.btn', { onclick: () => location.reload() }, 'Try again')));
    throw err;
  }
  // Give the animation a moment so the boot doesn't flash (skippable in Settings).
  const min = kernel.settings.get('system.bootAnimation') ? 1500 : 0;
  const wait = min - (performance.now() - t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return async () => { el.classList.add('out'); await settle(el, 600); el.remove(); };
}
