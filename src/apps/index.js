// Built-in app manifests. Each app lives in src/apps/<id>/ with a main.js entry.

const icon = (id) => `assets/icons/apps/${id}.svg`;

export const BUILTIN_APPS = [
  {
    id: 'settings', name: 'Settings', version: '1.0.0', icon: icon('settings'), entry: 'apps/settings/main.js',
    description: 'Personalize and manage DonutOS', category: 'System', singleInstance: true, privileged: true,
    permissions: ['files.read', 'files.write', 'system.settings', 'system.users', 'system.apps', 'notifications', 'location', 'network'],
    window: { width: 1040, height: 720, minWidth: 560, minHeight: 420 },
  },
  {
    id: 'recyclebin', name: 'Recycle Bin', version: '1.0.0', icon: icon('recyclebin'), entry: 'apps/recyclebin/main.js',
    description: 'Restore or permanently delete removed items', category: 'System', singleInstance: true, privileged: true,
    permissions: ['files.read', 'files.write'], window: { width: 820, height: 520, minWidth: 460, minHeight: 300 },
  },
  {
    id: 'snipping', name: 'Snipping Tool', version: '1.0.0', icon: icon('snipping'), entry: 'apps/snipping/main.js',
    description: 'Capture, mark up and share screenshots', category: 'Utilities', privileged: true,
    permissions: ['files.read', 'files.write', 'screen', 'clipboard', 'notifications'], fileTypes: [],
    window: { width: 900, height: 620, minWidth: 480, minHeight: 360 },
    jumpList: [{ label: 'New snip', args: { snip: 'rect' }, icon: 'scissors' }],
  },
  {
    id: 'console', name: 'Kernel Console', version: '1.0.0', icon: icon('console'), entry: 'apps/console/main.js',
    description: 'Live view of the DonutOS core: processes, stats, file system, log', category: 'Developer', privileged: true,
    permissions: ['system.processes'], window: { width: 1180, height: 760, minWidth: 600, minHeight: 400 },
  },
];
