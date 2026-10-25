// Entry point: create the platform adapter and kernel, then hand over to the shell.

import { createPlatform } from './platform/index.js';
import { createKernel } from './core/kernel.js';
import { Shell } from './shell/shell.js';

const kernel = createKernel({ platform: createPlatform() });
globalThis.DonutOS = kernel; // handy for exploring from DevTools

new Shell(kernel, document.getElementById('root')).start().catch((err) => {
  kernel.log.error('shell', `Startup failed: ${err.message}`, { stack: err.stack });
});
