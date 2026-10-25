// Reads a user's preferences for the lock/sign-in screens, whether or not they're signed in.

const KEYS = ['time.format24h', 'language.locale', 'time.timezone', 'time.dateFormat', 'appearance.lockWallpaper',
  'appearance.wallpaper', 'appearance.wallpaperFit', 'lock.showStatus', 'lock.signInWith', 'appearance.accent'];

export async function prefsFor(kernel, uid) {
  if (uid && kernel.settings.isLoaded(uid)) return kernel.settings.forUser(uid);
  const values = {};
  if (uid) for (const k of KEYS) values[k] = await kernel.settings.peekUser(uid, k);
  return {
    get: (k) => (k in values ? values[k] : kernel.settings.get(k, null)),
  };
}

/** The lock-screen wallpaper spec for a user ("same" follows their desktop wallpaper). */
export function lockWallpaperOf(prefs, kernel) {
  const spec = prefs.get('appearance.lockWallpaper');
  if (spec === 'same') return prefs.get('appearance.wallpaper');
  return spec || kernel.settings.get('system.lockWallpaper');
}
