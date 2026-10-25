// Chooses the platform adapter. This is the ONLY place in /src that knows which
// platform DonutOS is running on; everything else talks to the adapter interface.

import { assertAdapter } from './adapter.js';
import { createWebAdapter } from './web-adapter.js';
import { createDesktopAdapter } from './desktop-adapter.js';

export function createPlatform(options = {}) {
  const adapter = globalThis.donutNative ? createDesktopAdapter(globalThis.donutNative) : createWebAdapter(options);
  return assertAdapter(adapter);
}
