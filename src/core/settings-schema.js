// The single source of truth for every DonutOS setting: its scope, type, default and limits.
//
// scope "system": shared by the whole device (stored once).
// scope "user":   stored separately for every user account.
//
// Keys ending in ".*" are families: any key with that prefix is accepted with the given type.
// Apps get their own free-form family, "app.<appId>.*", through ctx.storage.

const HEX = /^#[0-9a-fA-F]{6}$/;

export const SCHEMA = {
  // ── System (device-wide) ──────────────────────────────────────────────
  'system.deviceName':        { scope: 'system', type: 'string', default: 'DONUT-PC', maxLength: 32 },
  'system.lastUser':          { scope: 'system', type: 'string', default: '' },
  'system.guestEnabled':      { scope: 'system', type: 'boolean', default: true },
  'system.lockWallpaper':     { scope: 'system', type: 'string', default: 'builtin:glaze' },
  'system.bootAnimation':     { scope: 'system', type: 'boolean', default: true },
  'system.firstRunDone':      { scope: 'system', type: 'boolean', default: false },
  'system.updates.auto':      { scope: 'system', type: 'boolean', default: true },
  'system.startupApps':       { scope: 'system', type: 'array', default: [] },

  // ── Personalization ──────────────────────────────────────────────────
  'appearance.theme':         { scope: 'user', type: 'string', default: 'dark', enum: ['light', 'dark', 'auto'] },
  'appearance.accent':        { scope: 'user', type: 'string', default: '#e8618c', pattern: HEX },
  'appearance.accentAuto':    { scope: 'user', type: 'boolean', default: false },
  'appearance.transparency':  { scope: 'user', type: 'boolean', default: true },
  'appearance.animations':    { scope: 'user', type: 'boolean', default: true },
  'appearance.wallpaper':     { scope: 'user', type: 'string', default: 'builtin:glaze' },
  'appearance.wallpaperFit':  { scope: 'user', type: 'string', default: 'fill', enum: ['fill', 'fit', 'stretch', 'center', 'tile'] },
  'appearance.wallpaperSlideshow': { scope: 'user', type: 'object', default: { enabled: false, folder: '', intervalMin: 30 } },
  'appearance.font':          { scope: 'user', type: 'string', default: 'system', enum: ['system', 'rounded', 'serif', 'mono', 'humanist'] },
  'appearance.textScale':     { scope: 'user', type: 'number', default: 100, min: 100, max: 225 },
  'appearance.lockWallpaper': { scope: 'user', type: 'string', default: 'builtin:glaze' },

  // ── Taskbar / Start ──────────────────────────────────────────────────
  'taskbar.alignment':        { scope: 'user', type: 'string', default: 'center', enum: ['center', 'left'] },
  'taskbar.autoHide':         { scope: 'user', type: 'boolean', default: false },
  'taskbar.showSearch':       { scope: 'user', type: 'string', default: 'box', enum: ['hidden', 'icon', 'box'] },
  'taskbar.showTaskView':     { scope: 'user', type: 'boolean', default: true },
  'taskbar.showWidgets':      { scope: 'user', type: 'boolean', default: true },
  'taskbar.combine':          { scope: 'user', type: 'boolean', default: true },
  'taskbar.pinned':           { scope: 'user', type: 'array', default: ['explorer', 'browser', 'store', 'terminal', 'settings'] },
  'taskbar.showSeconds':      { scope: 'user', type: 'boolean', default: false },
  'start.pinned':             { scope: 'user', type: 'array', default: [
    'explorer', 'browser', 'settings', 'store', 'notepad', 'terminal', 'calculator', 'photos',
    'mediaplayer', 'paint', 'calendar', 'clock', 'mail', 'writer', 'stickynotes', 'taskmanager',
    'camera', 'solitaire', 'minesweeper', 'recorder' ] },
  'start.showRecent':         { scope: 'user', type: 'boolean', default: true },
  'start.showRecentApps':     { scope: 'user', type: 'boolean', default: true },
  'start.recentFiles':        { scope: 'user', type: 'array', default: [] },
  'start.recentApps':         { scope: 'user', type: 'array', default: [] },

  // ── Desktop ──────────────────────────────────────────────────────────
  'desktop.iconSize':         { scope: 'user', type: 'string', default: 'medium', enum: ['small', 'medium', 'large'] },
  'desktop.showIcons':        { scope: 'user', type: 'boolean', default: true },
  'desktop.sortBy':           { scope: 'user', type: 'string', default: 'none', enum: ['none', 'name', 'size', 'type', 'date'] },
  'desktop.autoArrange':      { scope: 'user', type: 'boolean', default: false },
  'desktop.iconPositions':    { scope: 'user', type: 'object', default: {} },

  // ── Window manager ───────────────────────────────────────────────────
  'wm.snapEnabled':           { scope: 'user', type: 'boolean', default: true },
  'wm.snapLayouts':           { scope: 'user', type: 'boolean', default: true },
  'wm.shakeToMinimize':       { scope: 'user', type: 'boolean', default: true },
  'wm.desktops':              { scope: 'user', type: 'array', default: [{ id: 'd1', name: 'Desktop 1' }] },
  'wm.bounds.*':              { scope: 'user', type: 'object', default: null },

  // ── Quick settings / system state ────────────────────────────────────
  'qs.wifi':                  { scope: 'user', type: 'boolean', default: true },
  'qs.bluetooth':             { scope: 'user', type: 'boolean', default: false },
  'qs.airplane':              { scope: 'user', type: 'boolean', default: false },
  'qs.volume':                { scope: 'user', type: 'number', default: 70, min: 0, max: 100 },
  'qs.muted':                 { scope: 'user', type: 'boolean', default: false },
  'qs.brightness':            { scope: 'user', type: 'number', default: 100, min: 20, max: 100 },
  'qs.nightLight':            { scope: 'user', type: 'boolean', default: false },
  'qs.nightLightStrength':    { scope: 'user', type: 'number', default: 45, min: 5, max: 100 },
  'qs.focus':                 { scope: 'user', type: 'boolean', default: false },
  'qs.focusMinutes':          { scope: 'user', type: 'number', default: 30, min: 5, max: 240 },

  // ── Notifications ────────────────────────────────────────────────────
  'notifications.enabled':    { scope: 'user', type: 'boolean', default: true },
  'notifications.dnd':        { scope: 'user', type: 'boolean', default: false },
  'notifications.sounds':     { scope: 'user', type: 'boolean', default: true },
  'notifications.perApp':     { scope: 'user', type: 'object', default: {} },
  'notifications.history':    { scope: 'user', type: 'array', default: [] },

  // ── Time & language ──────────────────────────────────────────────────
  'time.format24h':           { scope: 'user', type: 'boolean', default: false },
  'time.timezone':            { scope: 'user', type: 'string', default: 'auto' },
  'time.worldClocks':         { scope: 'user', type: 'array', default: ['Europe/London', 'Asia/Tokyo'] },
  'time.dateFormat':          { scope: 'user', type: 'string', default: 'short', enum: ['short', 'medium', 'long', 'iso'] },
  'time.firstDayOfWeek':      { scope: 'user', type: 'number', default: 0, min: 0, max: 6 },
  'language.locale':          { scope: 'user', type: 'string', default: 'auto' },
  'weather.location':         { scope: 'user', type: 'object', default: null },
  'weather.units':            { scope: 'user', type: 'string', default: 'auto', enum: ['auto', 'metric', 'imperial'] },

  // ── Accessibility ────────────────────────────────────────────────────
  'a11y.highContrast':        { scope: 'user', type: 'boolean', default: false },
  'a11y.magnifier':           { scope: 'user', type: 'boolean', default: false },
  'a11y.magnifierZoom':       { scope: 'user', type: 'number', default: 200, min: 125, max: 800 },
  'a11y.narrator':            { scope: 'user', type: 'boolean', default: false },
  'a11y.narratorRate':        { scope: 'user', type: 'number', default: 1, min: 0.5, max: 2 },
  'a11y.narratorVoice':       { scope: 'user', type: 'string', default: '' },
  'a11y.reduceMotion':        { scope: 'user', type: 'boolean', default: false },
  'a11y.cursorSize':          { scope: 'user', type: 'number', default: 1, min: 1, max: 3 },
  'a11y.stickyKeys':          { scope: 'user', type: 'boolean', default: false },

  // ── Apps & privacy ───────────────────────────────────────────────────
  'apps.defaults':            { scope: 'user', type: 'object', default: {} },
  'apps.hidden':              { scope: 'user', type: 'array', default: [] },
  'privacy.grants':           { scope: 'user', type: 'object', default: {} },
  'privacy.camera':           { scope: 'user', type: 'boolean', default: true },
  'privacy.microphone':       { scope: 'user', type: 'boolean', default: true },
  'privacy.location':         { scope: 'user', type: 'boolean', default: true },
  'privacy.notifications':    { scope: 'user', type: 'boolean', default: true },
  'privacy.clipboardHistory': { scope: 'user', type: 'boolean', default: true },
  'privacy.searchHistory':    { scope: 'user', type: 'boolean', default: true },
  'search.history':           { scope: 'user', type: 'array', default: [] },
  'clipboard.history':        { scope: 'user', type: 'array', default: [] },

  // ── Per-app free-form storage ────────────────────────────────────────
  'app.*':                    { scope: 'user', type: 'any', default: null },
};

/** Finds the schema entry for a key, including ".*" families (longest prefix wins). */
export function lookup(key) {
  if (Object.prototype.hasOwnProperty.call(SCHEMA, key)) return SCHEMA[key];
  let best = null, bestLen = -1;
  for (const pattern in SCHEMA) {
    if (!pattern.endsWith('.*')) continue;
    const prefix = pattern.slice(0, -1); // keep the trailing dot
    if (key.startsWith(prefix) && key.length > prefix.length && prefix.length > bestLen) {
      best = SCHEMA[pattern]; bestLen = prefix.length;
    }
  }
  return best;
}
