// Kernel Console: the live core read-out in a window.

import { mountKernelConsole } from '../../kernel-console.js';

export default function main(ctx) {
  const win = ctx.windows.create({ title: 'Kernel Console' });
  win.body.classList.add('console-app');
  const stop = mountKernelConsole(win.body, ctx.privileged);
  ctx.onExit(stop);
}
