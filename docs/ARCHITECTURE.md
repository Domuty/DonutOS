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

Files marked ✅ exist now (phases 1–3). The rest are created in the phase shown.

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
│   ├── build-wallpapers.js      ✅ renders the original wallpapers to JPEG
│   ├── build-app-icons.js       ✅ generates the app and file-type icons (SVG)
│   ├── build-emoji.js           ✅ builds the emoji list from emojibase-data (MIT)
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
    ├── boot.js                  ✅ entry point: platform → kernel → shell
    ├── kernel-console.js        ✅ live core read-out (developer tool, opened from Start)
    ├── manifest.webmanifest     ✅ PWA install
    ├── sw.js                    ✅ service worker
    ├── precache-manifest.js     ✅ generated
    ├── vendor/jszip.min.js      ✅
    ├── assets/
    │   ├── brand/               ✅ logo.svg + PNG icons
    │   ├── wallpapers/          ✅ 6 original wallpapers + thumbnails
    │   ├── icons/               ✅ app and file-type icons (SVG); system glyphs live in ui/icons.js

    ├── styles/
    │   ├── base.css             ✅ design tokens
    │   ├── kernel-console.css   ✅
    │   ├── shell.css            ✅ boot, lock, sign-in, setup, power, session frame
    │   ├── controls.css         ✅ buttons, inputs, toggles, menus, dialogs, spinner
    │   ├── window.css           ✅ windows (Mica, title bars, resize handles)
    │   ├── taskbar.css          ✅ taskbar, Start, Search, Quick Settings, notifications, widgets, emoji
    │   ├── desktop.css          ✅ desktop icons
    │   └── apps.css             ✅ built-in apps
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
    │   ├── accounts.js          ✅ accounts, guest, lockout, admin rules
    │   ├── crypto.js            ✅ PBKDF2-SHA-256 password/PIN hashing (WebCrypto)
    │   ├── clipboard.js         ✅ clipboard history
    │   └── shortcuts.js         ✅ keyboard shortcut registry (Win-key + Ctrl+Alt alternatives)
    ├── shell/
    │   ├── shell.js             ✅ screen state machine, sessions, shortcuts, auto-lock
    │   ├── boot-screen.js, lock-screen.js, sign-in.js, oobe.js  ✅
    │   ├── power.js             ✅ sleep, shut down, restart, sign out (with screens)
    │   ├── session-view.js      ✅ one user's screen: wallpaper, desktop, windows, taskbar, flyouts
    │   ├── accounts-panel.js    ✅ (embedded in Settings › Accounts)
    │   ├── permission-prompt.js ✅
    │   ├── theme.js, wallpaper.js, sounds.js, format.js, status-icons.js, prefs.js  ✅
    │   ├── desktop.js, file-ops.js, file-icons.js                ✅
    │   ├── taskbar.js, start-menu.js, search.js, flyout.js, apps.js  ✅
    │   ├── quick-settings.js, notification-center.js (+ calendar), toasts.js  ✅
    │   ├── widgets.js, weather.js (Open-Meteo), run-dialog.js, focus.js  ✅
    │   ├── clipboard-panel.js, emoji-data.js, snip.js            ✅
    │   └── display-filters.js   ✅ brightness, night light (high contrast & magnifier: 8)
    ├── wm/
    │   ├── window-manager.js, window.js  ✅ windows, focus, z-order, previews, remembered bounds
    │   ├── snap.js                       ✅ edge/corner snapping, layouts, Snap Assist, groups, shake, Win+Arrow
    │   ├── virtual-desktops.js, task-view.js, alt-tab.js  ✅
    ├── ui/                      ✅ h.js (DOM helper), icons.js, avatar.js, dialog.js, menu.js
    ├── apps/
    │   ├── index.js             ✅ built-in manifest list (filled as apps arrive)
    │   ├── settings/ recyclebin/ snipping/ console/                           ✅
    │   ├── explorer/ terminal/ taskmanager/                                   5
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

| `capture` | `screen` — the web build uses `getDisplayMedia` (the browser asks each time); the desktop build uses `webContents.capturePage` (no prompt) |

`power.onCloseRequest` lets the desktop build turn Alt+F4 / the host close button into
"close the active app window, or offer to shut down", like a desktop OS. One more group lands
with the app that needs it: `browser` (phase 6) — a sandboxed `<iframe>` on the web, a
`WebContentsView` on the desktop so sites that refuse iframes still load.

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

## Accounts and sessions

- **Accounts** (`core/accounts.js`) are stored in the key-value store. Passwords and PINs are
  hashed with PBKDF2-SHA-256 (310,000 iterations, random salt) and compared in constant time; the
  secret itself is never stored. Five wrong attempts lock an account for 30 s (survives restarts).
  The first account is an administrator and the last administrator can't be demoted or removed.
- **Guest** has no password and its home (`/Users/Guest`) and settings are wiped on sign-out
  and again on sign-in.
- **Sessions** (`kernel.signIn / signOut`): several users can be signed in at once. One is active
  (on screen); the others keep running. Every process belongs to the user who started it, so a
  background user's apps keep reading/writing *their* home, storage and permissions.
  The settings store keeps every signed-in user's settings loaded (`settings.forUser(uid)`).
- **Shell flow**: boot → first-run setup (no accounts) or lock screen → sign-in → session.
  Lock (Ctrl+Alt+L, Win+L where the host OS allows, auto-lock after idle), switch user and
  sign out return to the lock/sign-in screens; sleep, shut down and restart have their own screens.
- **Forgotten password**: hint; another administrator can reset it; otherwise "Reset DonutOS"
  erases everything (typed confirmation) and restarts into setup.

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
| `accounts.current/list` | who the app runs as, and the device's accounts (no secrets) | — |
| `host.importFiles/exportFile/openExternal` | the real computer | `openExternal`: `network` |
| `power.shutdown/restart` | power | `system.power` |
| `windows.create(opts)` → `{ body, titlebar, setTitle, setIcon, focus, minimize, maximize, restore, close, setBounds, getBounds, center, on, onBeforeClose, flash, setProgress }` | a window (closing the last one ends the app unless `keepAlive`) | — |
| `net.fetch(url, opts)`, `net.online()` | internet access that obeys Wi-Fi/airplane mode | `network` |
| `clipboard.writeText / readText` | system clipboard (+ clipboard history) | read: `clipboard` |
| `onNotification(fn)` | clicks on the app's notifications (if not running, the app is started with `args.notification`) | — |
| `privileged` | the kernel itself — only for built-in apps marked `privileged` (Settings, Recycle Bin, Snipping Tool, Kernel Console) | — |

## Shell (phase 3)

Each signed-in user's `SessionView` owns a `WindowManager`, a `FlyoutHost` (Start, Search,
Quick Settings, Notification Center + calendar, Widgets — one open at a time), the clipboard/emoji
panel, toasts, the taskbar and the desktop. Keyboard shortcuts are registered once in
`shell.js` with `kernel.shortcuts`; each has the Win-key combination and a Ctrl+Alt alternative
(Settings › System › Keyboard shortcuts lists them all).

Quick Settings maps to real behaviour: Wi-Fi off / airplane mode take DonutOS offline (the
`network` permission becomes *blocked*, the weather stops refreshing); Bluetooth gates Bluetooth
for apps; brightness and night light are screen-wide filters; volume drives every DonutOS sound;
focus is a timed do-not-disturb.

## Window management (phase 4)

- **Snapping** (`wm/snap.js`): positions are stored as fractions of the work area
  (`win.snap.frac`), so snapped windows follow screen and taskbar changes. Dragging a window to an
  edge, corner or the top shows a preview; dropping snaps it and offers **Snap Assist** for the
  remaining area. Hovering the maximize button (or Win+Z) shows six **snap layouts**.
- **Snap groups**: windows snapped together share a group; dragging the shared edge resizes the
  neighbours too (never below their minimum size); the taskbar preview offers the whole group.
  Moving, maximizing or closing a member takes it out of the group.
- **Shake** a title bar to minimize the other windows on this desktop; shake again to bring them back.
- **Win+Arrow** moves between halves, quarters, maximized, restored and minimized.
- **Virtual desktops** (`wm/virtual-desktops.js`): per-user list (names, optional per-desktop
  background) and current desktop are saved; each window has `desktop` or `allDesktops`.
  Focusing a window on another desktop switches there.
- **Task View** (`wm/task-view.js`) and **Alt+Tab** (`wm/alt-tab.js`) list windows in
  most-recently-used order; both can include all desktops (Settings › System › Multitasking).
- **Full-screen keys**: in full screen, Chromium's Keyboard Lock gives DonutOS the Win key,
  Alt+Tab and similar system shortcuts (desktop build: always when launched full screen; web: after
  turning on Full screen in Settings › Display). Holding Esc for two seconds hands them back.

## Security notes (desktop)

- `contextIsolation`, `sandbox`, no `nodeIntegration`; the preload exposes a fixed list of channels.
- IPC handlers only answer frames from `donut://app/`.
- The fs sandbox normalises every path, rejects drive letters/reserved characters, and refuses
  anything (including symlinks) that resolves outside the DonutOS folder. Tests in `tests/node`.
- The page can't navigate away from `donut://app/`; `window.open` of web links goes to the real browser.
- Electron grants camera/mic/notifications only to DonutOS itself; DonutOS's permission system
  then decides per app.
