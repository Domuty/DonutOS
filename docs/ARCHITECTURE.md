# DonutOS architecture

DonutOS is one codebase (`/src`) that runs in two hosts:

| | Web (Vercel / any static host) | Desktop (Electron) |
|---|---|---|
| Loads `/src` from | `https://your-site/` | `donut://app/` (custom scheme, served from the app bundle) |
| Files | IndexedDB (`nodes` + `blobs` stores) | Real files in `Documents/DonutOS` (sandboxed) |
| Settings, accounts, app registry | IndexedDB (`kv` store) | JSON files in the app's data folder |
| CPU / RAM / disk | Estimated (UI-thread load, JS heap, browser storage quota) | Real, from Node's `os` module and `statfs` |
| Battery | Battery Status API (Chromium) | Same API inside Electron's renderer |
| Network | `navigator.onLine` + Network Information API | Same, plus real interfaces from `os.networkInterfaces()` |
| Offline | Service worker precaches every file | Always offline-capable |
| Updates | Service worker update → "Restart to update" | `electron-updater` from GitHub Releases |
| Power off | Closes the tab/PWA window if the browser allows, otherwise shows a "safe to close" screen | Quits the app |

## The rule

**Apps never check the platform.** Only `src/platform/index.js` decides which adapter to create.
Everything above it talks to the adapter interface (`src/platform/adapter.js`), and apps only see the
`ctx` object the kernel builds for them.

```
 ┌───────────────────────── apps (src/apps/*) ─────────────────────────┐
 │  Notepad · Explorer · Terminal · Settings · Store apps · your apps  │
 └───────────────▲───────────────────────────────────────▲─────────────┘
                 │ ctx (per-process API, permission-checked)
 ┌───────────────┴──────── shell (src/shell, src/wm) ────┴─────────────┐
 │ lock/sign-in · desktop · taskbar · start · window manager · ...     │
 └───────────────▲─────────────────────────────────────────────────────┘
                 │
 ┌───────────────┴──────────────── kernel (src/core) ──────────────────┐
 │ event bus · process manager · settings · permissions · registry     │
 │ VFS (+ recycle bin, search) · file associations · notifications     │
 └───────────────▲─────────────────────────────────────────────────────┘
                 │ platform adapter interface (src/platform/adapter.js)
 ┌───────────────┴──────────────┐        ┌──────────────────────────────┐
 │ web-adapter.js               │        │ desktop-adapter.js           │
 │ IndexedDB, browser APIs, SW  │        │ window.donutNative (preload) │
 └──────────────────────────────┘        └──────────────▲───────────────┘
                                                        │ IPC (fixed channel list)
                                         ┌──────────────┴───────────────┐
                                         │ electron/main.js + native/*  │
                                         │ fs sandbox, kv, os stats,    │
                                         │ dialogs, updater             │
                                         └──────────────────────────────┘
```

## Folder tree

Files marked ✅ exist now (phase 1). The rest are created in the phase shown.

```
donutos/
├── package.json                 ✅ scripts, Electron + electron-builder config, GitHub publish
├── vercel.json                  ✅ static deploy of /src, SW headers, precache build step
├── README.md                    ✅ (rewritten for beginners in phase 9)
├── docs/
│   ├── ARCHITECTURE.md          ✅ this file
│   ├── SDK.md                   7  app API reference
│   └── BUILD-AN-APP.md          7  step-by-step guide with an example app
├── build/
│   └── icon.png                 ✅ installer/app icon (electron-builder makes .ico/.icns from it)
├── scripts/
│   ├── serve.js                 ✅ local static server for the web version
│   ├── build-precache.js        ✅ writes src/precache-manifest.js (offline file list + version)
│   ├── build-icons.js           ✅ renders the logo to PNG icons
│   └── vendor.js                ✅ copies JSZip into src/vendor
├── .github/workflows/
│   └── release.yml              9  builds Windows/macOS/Linux installers and publishes a Release
├── electron/
│   ├── main.js                  ✅ window, donut:// scheme, IPC, permissions, single instance
│   ├── preload.js               ✅ the only bridge to the page (allow-listed channels)
│   ├── updater.js               ✅ electron-updater wiring
│   └── native/
│       ├── fs-sandbox.js        ✅ real files, confined to Documents/DonutOS
│       ├── kv-store.js          ✅ settings/accounts storage (atomic JSON files)
│       └── system-stats.js      ✅ CPU/RAM/disk/network/OS info
├── tests/node/
│   └── fs-sandbox.test.js       ✅ sandbox escape + parity tests (node --test)
└── src/
    ├── index.html               ✅
    ├── boot.js                  ✅ entry point (phase 2: boot animation → lock → sign-in)
    ├── kernel-console.js        ✅ live core read-out (kept as a developer tool)
    ├── manifest.webmanifest     ✅ PWA install
    ├── sw.js                    ✅ service worker
    ├── precache-manifest.js     ✅ generated
    ├── vendor/jszip.min.js      ✅
    ├── assets/
    │   ├── brand/               ✅ logo.svg + PNG icons
    │   ├── wallpapers/          2  original generated wallpapers
    │   ├── icons/               3  app, file-type and system icons (SVG)
    │   └── sounds/              3  notification/startup sounds (generated with WebAudio, no files)
    ├── styles/
    │   ├── base.css             ✅ design tokens
    │   ├── kernel-console.css   ✅
    │   ├── shell.css            2–3
    │   ├── window.css           4
    │   └── controls.css         3  shared buttons, inputs, menus, toggles, sliders
    ├── platform/
    │   ├── adapter.js           ✅ THE interface + assertAdapter()
    │   ├── index.js             ✅ picks the adapter (the only platform check in /src)
    │   ├── web-adapter.js       ✅
    │   ├── desktop-adapter.js   ✅
    │   ├── common/browser-apis.js ✅ battery, network, load monitor, fullscreen
    │   └── web/idb.js, idb-fs.js  ✅ IndexedDB file system
    ├── core/                    (the kernel)
    │   ├── kernel.js            ✅ boot sequence, session, launch/open, ctx providers
    │   ├── event-bus.js         ✅
    │   ├── process-manager.js   ✅ PIDs, ctx, tracked resources, CPU/memory sampling, kill
    │   ├── settings.js          ✅ central store (system + per-user scopes)
    │   ├── settings-schema.js   ✅ every setting: scope, type, default, limits
    │   ├── permissions.js       ✅
    │   ├── registry.js          ✅ app manifests, install/uninstall
    │   ├── file-associations.js ✅
    │   ├── notifications.js     ✅
    │   ├── vfs.js               ✅ file API, recycle bin, search, per-app access control
    │   ├── path.js, mime.js, errors.js, log.js, util.js ✅
    │   ├── users.js             2  accounts, hashed passwords/PINs (PBKDF2 via WebCrypto), guest
    │   ├── clipboard.js         3  clipboard history
    │   └── shortcuts.js         3  global keyboard shortcut registry
    ├── shell/                   2–3
    │   ├── boot-screen.js, lock-screen.js, sign-in.js            2
    │   ├── desktop.js, taskbar.js, start-menu.js, search.js      3
    │   ├── quick-settings.js, notification-center.js, toasts.js  3
    │   ├── widgets.js, calendar-flyout.js, run-dialog.js         3
    │   ├── emoji-panel.js, clipboard-panel.js, snipping.js       3
    │   ├── context-menu.js, dialogs.js, permission-prompt.js     3
    │   └── display-filters.js   3  brightness, night light, high contrast, magnifier
    ├── wm/                      4
    │   ├── window-manager.js, window.js, snap.js, snap-layouts.js
    │   ├── virtual-desktops.js, task-view.js, alt-tab.js
    ├── ui/                      3  tiny component helpers shared by shell and apps (h(), menus, lists)
    ├── apps/
    │   ├── index.js             ✅ built-in manifest list (filled as apps arrive)
    │   ├── explorer/ terminal/ settings/ taskmanager/                         5
    │   ├── notepad/ writer/ calculator/ paint/ photos/ mediaplayer/           6
    │   ├── camera/ recorder/ clock/ calendar/ stickynotes/ browser/ mail/     6
    │   ├── solitaire/ minesweeper/                                            6
    │   └── store/               7  catalog in store/catalog/*.dapp
    ├── sdk/                     7  donut-sdk.js (typed helpers over ctx), example app
    └── tests/                   ✅ core test suite (runs on whichever platform is active)
```

## Platform adapter interface

Defined (with exact return shapes) in [`src/platform/adapter.js`](../src/platform/adapter.js).
`assertAdapter()` rejects an incomplete adapter at boot.

| Group | Members |
|---|---|
| lifecycle | `name`, `init()`, `info()` |
| `fs` | `stat`, `readdir`, `readFile`, `writeFile`, `mkdir`, `remove`, `rename`, `copy`, `usage` |
| `kv` | `get`, `set`, `delete`, `keys` |
| `system` | `stats`, `battery`, `onBatteryChange`, `network`, `onNetworkChange` |
| `power` | `shutdown`, `restart` |
| `display` | `setFullscreen`, `isFullscreen`, `onFullscreenChange` |
| `host` | `importFiles`, `exportFile`, `openExternal` |
| `updates` | `status`, `check`, `install`, `onStatus` |

Two more groups land with the apps that need them, each implemented for both hosts:
- `browser` (phase 6): creates a page view (sandboxed `<iframe>` on the web, a separate
  `WebContentsView` on the desktop so sites that refuse iframes still load).
- `capture` (phase 3): screenshots for the snipping tool (`getDisplayMedia` on the web,
  `webContents.capturePage` on the desktop, which needs no screen-share prompt).

The fs primitives are deliberately small; `core/vfs.js` builds everything else (recursive
mkdir, overwrite-aware move, unique names, search, the Recycle Bin) once, for both platforms.
Error codes (`ENOENT`, `EEXIST`, `ENOTDIR`, `EISDIR`, `ENOTEMPTY`, `EACCES`, `EINVAL`,
`ENOSPC`, `EIO`) are identical on both, and the same test suite checks both.

## Kernel services

**Event bus** (`core/event-bus.js`) — synchronous pub/sub. Names are `namespace:event`;
subscribe to `fs:*` or `*`. Subscriptions carry an owner PID so a killed process's listeners
are removed in one call. A throwing handler is logged and never breaks the others. Apps
cannot emit `process:`, `kernel:`, `settings:`, `fs:`, `session:`, `permissions:` or `apps:`
events.

Events the core emits: `kernel:ready`, `kernel:log`, `kernel:openWith`, `kernel:powerOff`,
`process:start|running|activate|exiting|exit|crash|sample`, `fs:changed`, `trash:changed`,
`settings:changed|userLoaded|userUnloaded`, `session:changed`, `permissions:changed`,
`apps:registered|unregistered|installed|uninstalled`, `associations:changed`,
`notification:posted|changed|dismissed|cleared|activated`.

**Process manager** (`core/process-manager.js`) — every app is a `Process` with a PID.
An app module exports `default async function main(ctx)`. Timers, listeners, bus
subscriptions, DOM elements and devices obtained through `ctx` are tracked, so
`kill(pid)` always frees everything. Crashes during start are caught, reported
(`process:crash`) and cleaned up. Single-instance apps receive `ctx.onActivate(args)`
instead of a second copy. Critical system processes refuse `kill` without `force`.
- *CPU %* = time spent in that app's tracked callbacks ÷ wall time (its share of the
  DonutOS UI thread).
- *Memory* = base cost + DOM nodes in its windows + bytes it reports with
  `ctx.trackMemory()`. Browsers don't expose per-script heap size, so this is an
  estimate on both platforms; the totals in Task Manager (system CPU/RAM) are real on desktop.

**Settings** (`core/settings.js`, `core/settings-schema.js`) — every key is declared once with
scope (`system` or `user`), type, default and limits; writes are validated, applied in memory,
broadcast, and persisted (debounced, flushed on page hide and power off). Reads are synchronous.
Each user has a separate settings document; apps get private storage under `app.<id>.*`.

**Permissions** (`core/permissions.js`) — apps declare permissions in their manifest.
Undeclared = always denied. Built-in apps get what they declare; Store apps are asked once
(Allow / Allow once / Deny). Camera, microphone, location and notifications also obey a
per-user master switch. Decisions live in `privacy.grants` and are editable in Settings.

**Registry** (`core/registry.js`) — validated manifests; built-in apps from `src/apps/index.js`;
Store/sideloaded apps persisted with their code and loaded from Blob URLs.

**File associations** (`core/file-associations.js`) — handlers from manifests' `fileTypes`;
the user's default per extension; `kernel.open(path)` launches it or asks the shell to show
"Open with".

**VFS** (`core/vfs.js`) — `/System`, `/Users/<name>/{Desktop,Documents,Downloads,Pictures,
Music,Videos,.Trash}`, `/Users/Public`. Per-app views (`ctx.fs`) resolve relative paths
against the user's home and require `files.read`/`files.write` inside the home and
`system.fs` anywhere else.

**Notifications** (`core/notifications.js`) — per-user history, Do Not Disturb/Focus mark
notifications silent (stored, no toast), per-app mute.

## The app context (`ctx`)

| Member | What it does | Permission |
|---|---|---|
| `pid`, `app`, `args` | identity and launch arguments | — |
| `bus.on/once/emit` | event bus (owned by the process) | — |
| `setTimeout/setInterval/requestAnimationFrame` (+ clear) | tracked timers | — |
| `listen(target, type, fn)` | tracked DOM listener | — |
| `onExit(fn)`, `onActivate(fn)`, `own(dispose)`, `ownElement(el)`, `trackMemory(n)`, `exit()` | lifecycle | — |
| `fs.*` | files (see VFS) | `files.read`/`files.write`/`system.fs` |
| `storage.get/set/remove/keys/watch` | private per-user app storage | — |
| `settings.get/watch` · `settings.set/reset` | system settings | read: — · write: `system.settings` |
| `permissions.check/request/status/list` | the app's own permissions | — |
| `notify({ title, body, actions })` | post a notification | `notifications` |
| `launch(appId, args)`, `open(path)` | start apps / open files | — |
| `processes.list/kill/self` | other processes | `system.processes` |
| `system.info/stats/battery/network/on…Change/user/log` | device information | — |
| `host.importFiles/exportFile/openExternal` | the real computer | `openExternal`: `network` |
| `power.shutdown/restart` | power | `system.power` |
| `windows.*` (phase 4), `ui.*` (phase 3) | windows, dialogs, menus | — |

## Security notes (desktop)

- `contextIsolation`, `sandbox`, no `nodeIntegration`; the preload exposes a fixed list of channels.
- IPC handlers only answer frames from `donut://app/`.
- The fs sandbox normalises every path, rejects drive letters/reserved characters, and refuses
  anything (including symlinks) that resolves outside the DonutOS folder. Tests in `tests/node`.
- The page can't navigate away from `donut://app/`; `window.open` of web links goes to the real browser.
- Electron grants camera/mic/notifications only to DonutOS itself; DonutOS's permission system
  then decides per app.
