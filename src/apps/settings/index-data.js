// The Settings app's pages and every searchable setting. Search uses this to find
// settings; Settings uses it for its navigation.

export const SECTIONS = [
  { id: 'system', title: 'System', icon: 'monitor' },
  { id: 'personalization', title: 'Personalization', icon: 'palette' },
  { id: 'apps', title: 'Apps', icon: 'apps' },
  { id: 'accounts', title: 'Accounts', icon: 'user' },
  { id: 'time', title: 'Time & language', icon: 'globe' },
  { id: 'privacy', title: 'Privacy & security', icon: 'shield' },
  { id: 'update', title: 'DonutOS Update', icon: 'restart' },
];

// page id -> { section, title, description }
export const PAGES = {
  system: { section: 'system', title: 'System', description: 'Display, sound, notifications, power' },
  display: { section: 'system', title: 'Display', description: 'Brightness, night light, scale, full screen' },
  sound: { section: 'system', title: 'Sound', description: 'Volume, system sounds' },
  notifications: { section: 'system', title: 'Notifications', description: 'Alerts from apps and system, do not disturb' },
  focus: { section: 'system', title: 'Focus', description: 'Focus sessions' },
  power: { section: 'system', title: 'Power & lock', description: 'Screen lock, startup' },
  storage: { section: 'system', title: 'Storage', description: 'Storage space, what is using it' },
  multitasking: { section: 'system', title: 'Multitasking', description: 'Snap windows, desktops, task switching' },
  clipboard: { section: 'system', title: 'Clipboard', description: 'Clipboard history' },
  shortcuts: { section: 'system', title: 'Keyboard shortcuts', description: 'Every DonutOS shortcut and its alternatives' },
  about: { section: 'system', title: 'About', description: 'Device specifications, rename this device' },
  personalization: { section: 'personalization', title: 'Personalization', description: 'Background, colours, themes' },
  background: { section: 'personalization', title: 'Background', description: 'Wallpaper, solid colour, picture fit' },
  colors: { section: 'personalization', title: 'Colours', description: 'Mode, accent colour, transparency' },
  lockscreen: { section: 'personalization', title: 'Lock screen', description: 'Lock screen picture, status' },
  taskbar: { section: 'personalization', title: 'Taskbar', description: 'Taskbar items, alignment, behaviours' },
  start: { section: 'personalization', title: 'Start', description: 'Recent apps and items' },
  fonts: { section: 'personalization', title: 'Fonts & text', description: 'Font family and text size' },
  desktop: { section: 'personalization', title: 'Desktop icons', description: 'Icon size, arrangement' },
  apps: { section: 'apps', title: 'Installed apps', description: 'Uninstall, app details' },
  defaultapps: { section: 'apps', title: 'Default apps', description: 'Defaults for file types' },
  startup: { section: 'apps', title: 'Startup', description: 'Apps that start when you sign in' },
  accounts: { section: 'accounts', title: 'Your info', description: 'Your picture, name, sign-in options, other people' },
  datetime: { section: 'time', title: 'Date & time', description: 'Time zone, 24-hour clock, formats' },
  language: { section: 'time', title: 'Language & region', description: 'Regional format' },
  privacy: { section: 'privacy', title: 'App permissions', description: 'Camera, microphone, location, notifications' },
  history: { section: 'privacy', title: 'Activity history', description: 'Search and clipboard history' },
  update: { section: 'update', title: 'DonutOS Update', description: 'Check for updates' },
};

// Searchable entries: [title, page, extra keywords]
const ENTRIES = [
  ['Brightness', 'display', 'screen dim light'], ['Night light', 'display', 'blue light warm filter eyes'], ['Full screen', 'display', 'kiosk'],
  ['Volume', 'sound', 'audio speaker loud mute'], ['System sounds', 'sound', 'startup chime notification sound'],
  ['Do not disturb', 'notifications', 'dnd quiet silence'], ['Notifications from apps', 'notifications', 'alerts banners toast'],
  ['Focus session', 'focus', 'timer concentrate'], ['Lock screen timeout', 'power', 'auto lock idle sleep screen'],
  ['Startup sound', 'sound', 'chime'], ['Boot animation', 'power', 'startup splash'],
  ['Storage usage', 'storage', 'disk space free'], ['Snap windows', 'multitasking', 'snap layouts assist arrange side by side'],
  ['Title bar window shake', 'multitasking', 'aero shake minimize'], ['Virtual desktops', 'multitasking', 'task view workspaces'], ['Alt+Tab', 'multitasking', 'switch windows'], ['Clipboard history', 'clipboard', 'copy paste'],
  ['Rename this device', 'about', 'device name pc name computer'], ['Device specifications', 'about', 'processor ram memory version about'],
  ['Wallpaper', 'background', 'background picture desktop image'], ['Solid colour background', 'background', 'color'],
  ['Dark mode', 'colors', 'light theme mode night'], ['Accent colour', 'colors', 'color highlight'], ['Transparency effects', 'colors', 'mica acrylic blur'],
  ['Animation effects', 'colors', 'motion'], ['Lock screen picture', 'lockscreen', 'wallpaper'],
  ['Taskbar alignment', 'taskbar', 'center left'], ['Automatically hide the taskbar', 'taskbar', 'autohide'], ['Show seconds in clock', 'taskbar', 'time'],
  ['Search on taskbar', 'taskbar', 'search box icon'], ['Widgets button', 'taskbar', 'weather'], ['Combine taskbar buttons', 'taskbar', 'group labels'],
  ['Show recently opened items', 'start', 'recent files'], ['Font', 'fonts', 'typeface'], ['Text size', 'fonts', 'bigger larger zoom scale'],
  ['Desktop icon size', 'desktop', 'icons arrange sort'],
  ['Uninstall apps', 'apps', 'remove programs'], ['Default apps', 'defaultapps', 'open with file type association'], ['Startup apps', 'startup', 'launch sign in'],
  ['Change password', 'accounts', 'sign-in options security'], ['PIN', 'accounts', 'sign-in options'], ['Account picture', 'accounts', 'avatar photo'],
  ['Add account', 'accounts', 'other users family user'], ['Guest account', 'accounts', 'visitor'],
  ['Time zone', 'datetime', 'clock'], ['24-hour clock', 'datetime', 'time format'], ['Date format', 'datetime', ''], ['World clocks', 'datetime', 'additional clocks'],
  ['Region format', 'language', 'locale language'], ['First day of week', 'datetime', 'calendar'],
  ['Camera access', 'privacy', 'webcam privacy permission'], ['Microphone access', 'privacy', 'mic privacy permission'],
  ['Location access', 'privacy', 'gps privacy permission'], ['App permissions', 'privacy', 'privacy'], ['Search history', 'history', 'clear'],
  ['Check for updates', 'update', 'upgrade version'], ['Keyboard shortcuts', 'shortcuts', 'hotkeys keys win key'], ['Weather units', 'language', 'celsius fahrenheit'],
];

export const SETTINGS_INDEX = [
  ...Object.entries(PAGES).map(([page, p]) => ({ title: p.title, page, keywords: p.description.toLowerCase(), section: p.section })),
  ...ENTRIES.map(([title, page, kw]) => ({ title, page, keywords: kw, section: PAGES[page].section })),
];
