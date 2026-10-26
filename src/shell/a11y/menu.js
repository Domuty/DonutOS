// The accessibility menu on the sign-in and setup screens.

import { showMenu } from '../../ui/menu.js';
import { QUICK_FEATURES, a11yGet, a11ySet } from './prefs.js';

export function openAccessibilityMenu(kernel, anchor) {
  const s = kernel.settings;
  showMenu([
    { header: 'Accessibility' },
    ...QUICK_FEATURES.filter(([, , , o]) => !o?.session).map(([key, label]) => ({ label, checked: !!a11yGet(s, key), onSelect: () => a11ySet(s, key, !a11yGet(s, key)) })),
  ], { anchor, placement: 'above' });
}
