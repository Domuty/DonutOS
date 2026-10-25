// Entry point. Boots the kernel, then shows the kernel console.
// Phase 2 replaces the console with the boot animation, lock screen and sign-in.

import { createPlatform } from './platform/index.js';
import { createKernel } from './core/kernel.js';
import { mountKernelConsole } from './kernel-console.js';

const root = document.getElementById('root');
root.innerHTML = `
  <div class="kc-boot">
    <img class="kc-logo" src="assets/brand/logo.svg" alt="DonutOS">
    <div class="kc-bar"><i></i></div>
    <div class="kc-step"></div>
  </div>`;
const bar = root.querySelector('.kc-bar > i');
const step = root.querySelector('.kc-step');

const kernel = createKernel({ platform: createPlatform() });
globalThis.DonutOS = kernel; // handy for exploring from DevTools

kernel.boot({ onProgress: (f, label) => { bar.style.width = `${f * 100}%`; step.textContent = label; } })
  .then(() => mountKernelConsole(root, kernel))
  .catch((err) => {
    step.className = 'kc-error';
    step.textContent = `DonutOS could not start: ${err.message}`;
  });
