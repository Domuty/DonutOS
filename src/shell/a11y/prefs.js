// Accessibility preferences: the signed-in user's a11y.* settings, or — on the lock and
// sign-in screens before anyone has signed in — the device-wide "a11y.signin" set, so people
// who need Narrator, Magnifier or the on-screen keyboard can use them to sign in.

import { SCHEMA } from '../../core/settings-schema.js';

/** Features the sign-in screen offers (everything else only exists inside a session). */
export const SIGNIN_FEATURES = ['narrator', 'magnifier', 'magnifierZoom', 'highContrast', 'contrastTheme', 'osk', 'stickyKeys', 'cursorSize'];

export function a11yGet(settings, name) {
  if (settings?.currentUser) return settings.get(`a11y.${name}`);
  // (Theme previews pass a stand-in settings object that only knows appearance keys.)
  const signin = settings?.get?.('a11y.signin');
  return signin && typeof signin === 'object' && name in signin ? signin[name] : SCHEMA[`a11y.${name}`].default;
}

export function a11ySet(settings, name, value) {
  if (settings.currentUser) { settings.set(`a11y.${name}`, value); return; }
  settings.set('a11y.signin', { ...settings.get('a11y.signin'), [name]: value });
}

/** The on/off features offered in Quick Settings and on the sign-in screen. */
export const QUICK_FEATURES = [
  ['magnifier', 'Magnifier', 'search'],
  ['colorFilter', 'Colour filters', 'palette', { session: true }],
  ['narrator', 'Narrator', 'volume'],
  ['highContrast', 'Contrast theme', 'sun'],
  ['stickyKeys', 'Sticky Keys', 'keypad'],
  ['osk', 'On-screen keyboard', 'keypad'],
];
