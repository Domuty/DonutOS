// Built-in app manifests. Each app lives in src/apps/<id>/ with a main.js entry.

const icon = (id) => `assets/icons/apps/${id}.svg`;

export const BUILTIN_APPS = [
  {
    id: 'explorer', name: 'File Explorer', version: '1.0.0', icon: icon('explorer'), entry: 'apps/explorer/main.js',
    description: 'Browse and organise your files', category: 'System', privileged: true,
    permissions: ['files.read', 'files.write', 'system.fs', 'clipboard'], fileTypes: ['.zip'],
    window: { width: 1080, height: 680, minWidth: 520, minHeight: 360 },
    jumpList: [{ label: 'Documents', args: { path: '~/Documents' }, icon: 'folder' }, { label: 'Downloads', args: { path: '~/Downloads' }, icon: 'download' }, { label: 'Pictures', args: { path: '~/Pictures' }, icon: 'image' }],
  },
  {
    id: 'terminal', name: 'Terminal', version: '1.0.0', icon: icon('terminal'), entry: 'apps/terminal/main.js',
    description: 'Command line and JavaScript prompt for DonutOS', category: 'Developer', privileged: true,
    permissions: ['files.read', 'files.write', 'system.fs', 'system.processes', 'network', 'notifications', 'clipboard'],
    fileTypes: ['.dsh'], newFiles: [{ label: 'DonutOS script', ext: '.dsh', template: '# DonutOS script\necho "Hello from $0"\n' }],
    window: { width: 880, height: 540, minWidth: 380, minHeight: 220 },
    jumpList: [{ label: 'New window', args: {}, icon: 'plus' }],
  },
  {
    id: 'taskmanager', name: 'Task Manager', version: '1.0.0', icon: icon('taskmanager'), entry: 'apps/taskmanager/main.js',
    description: 'See and end running apps, watch performance, manage startup apps', category: 'System', singleInstance: true, privileged: true,
    permissions: ['system.processes', 'system.users', 'clipboard', 'notifications'],
    window: { width: 1000, height: 680, minWidth: 560, minHeight: 400 },
  },
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
