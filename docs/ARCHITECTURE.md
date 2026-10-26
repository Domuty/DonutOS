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

Files marked ✅ exist now (phases 1–7). The rest are created in the phase shown.

```
donutos/
├── package.json                 ✅ scripts, Electron + electron-builder config, GitHub publish
├── vercel.json                  ✅ static deploy of /src, SW headers, precache build step
├── api/frame-check.js           ✅ Vercel function: can the Browser show a site in a frame? (logic in api/_lib/)
├── api/relay.js                 ✅ Vercel function: the Browser's relay for sites that refuse frames (api/_lib/relay.js)
├── README.md                    ✅ (rewritten for beginners in phase 9)
├── docs/
│   ├── ARCHITECTURE.md          ✅ this file
│   └── SDK.md                   ✅ Store app tutorial, API reference, .dapp and catalog formats
├── build/
│   └── icon.png                 ✅ installer/app icon (electron-builder makes .ico/.icns from it)
├── scripts/
│   ├── serve.js                 ✅ local static server for the web version
│   ├── build-precache.js        ✅ writes src/precache-manifest.js (offline file list + version)
│   ├── build-icons.js           ✅ renders the logo to PNG icons
│   ├── build-wallpapers.js      ✅ renders the original wallpapers to JPEG
│   ├── build-app-icons.js       ✅ generates the app and file-type icons (SVG)
│   ├── build-emoji.js           ✅ builds the emoji list from emojibase-data (MIT)
│   ├── vendor.js                ✅ copies JSZip into src/vendor
│   ├── build-catalog.js         ✅ src/store/apps/* → src/store/catalog/*.dapp + index.json
│   └── pack-dapp.js             ✅ packs an app folder into a .dapp (developer CLI)
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
    │   ├── shortcuts.js         ✅ keyboard shortcut registry (Win-key + Ctrl+Alt alternatives)
    │   └── dapp.js              ✅ .dapp parse/validate/build, version compare
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
    ├── lib/zip.js               ✅ zip/unzip over the DonutOS file API (vendored JSZip, zip-slip safe)
    ├── ui/                      ✅ h.js (DOM helper), icons.js, avatar.js, dialog.js, menu.js, menubar.js, file-dialog.js
    ├── apps/
    │   ├── index.js             ✅ built-in manifest list (filled as apps arrive)
    │   ├── settings/ recyclebin/ snipping/ console/                           ✅
    │   ├── explorer/            ✅ main.js (tabs, nav, address bar, search), view.js (5 views), actions.js (zip, import/export)
    │   ├── terminal/            ✅ shell.js (parser/interpreter), commands.js, js-worker.js, main.js
    │   ├── taskmanager/         ✅ main.js (processes, performance, startup, users, details), graph.js
    │   ├── common/              ✅ document.js (open/save/unsaved changes), print.js
    │   ├── notepad/ writer/ calculator/ paint/ photos/ mediaplayer/           ✅
    │   ├── camera/ recorder/ clock/ calendar/ stickynotes/ browser/ mail/     ✅
    │   ├── solitaire/ minesweeper/                                            ✅
    │   └── store/               ✅ the Store: browse, install, update, uninstall, sources
    ├── sandbox/host.js          ✅ runs a Store app in a sandboxed frame; answers its SDK calls through ctx
    ├── sdk/                     ✅ donut-sdk.js (the `@donut/sdk` module inside the frame), sdk.css
    ├── store/
    │   ├── apps/                ✅ sources of the 8 catalog apps (not precached; built into catalog/)
    │   └── catalog/             ✅ generated: index.json + <id>.dapp
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

| `browser` | `kind`, `createView`, `setDownloadDir`, `onDownload`, `cancelDownload`, `onOpenRequest`, `clearData` |
| `capture` | `screen` — the web build uses `getDisplayMedia` (the browser asks each time); the desktop build uses `webContents.capturePage` (no prompt) |

`power.onCloseRequest` lets the desktop build turn Alt+F4 / the host close button into
"close the active app window, or offer to shut down", like a desktop OS. The `browser` group gives the Browser app its
web pages: a sandboxed `<iframe>` on the web, an Electron `<webview>` on the desktop (a separate,
locked-down browser process, so sites that refuse iframes still load).

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

## Built-in system apps (phase 5)

- **File Explorer** works only through the file API, so the same code browses IndexedDB on the
  web and the real `Documents/DonutOS` folder on the desktop. Users can open their own home and
  `Public`; administrators can open everything. Zip/unzip uses JSZip (`src/vendor`), and
  extraction refuses entries that would land outside the target folder. Export/Import use the
  host's file picker and downloads (web) or save dialog (desktop).
- **Terminal**: `apps/terminal/shell.js` is a small POSIX-like interpreter (quotes, `$VARS`, `~`,
  globs, pipes, redirects, `&& || ;`); every command in `commands.js` uses the permission-checked
  `ctx.fs`. `.dsh` files are shell scripts (`sh file.dsh args`). `js` runs JavaScript in a Web
  Worker with storage, network and nested workers removed; it reaches DonutOS only through the
  `donut` RPC object, so it obeys the same permissions. Ctrl+C terminates the worker, which stops
  even an endless loop.
- **Task Manager** reads `kernel.processes` (CPU = time spent in each app's callbacks; memory =
  base + DOM + reported bytes) and the adapter's `system.stats()` (estimated on the web, real OS
  numbers on the desktop, including per-core CPU). Disk activity is DonutOS file operations per
  second; network is what DonutOS downloaded over http(s) (Resource Timing) while it's open.
  Critical processes can't be ended; other users' apps need an administrator. Signing a user out
  goes through `shell:signOutRequest`, so their screen is torn down by the shell.
- **Settings**: Personalization › Themes (8 presets + saved custom themes in
  `appearance.customThemes`); Apps › Installed apps › Advanced options (`appinfo` page:
  permissions, startup, file types, terminate, reset data and permission choices, uninstall).

## Everyday apps (phase 6)

- **Shared pieces**: `ui/file-dialog.js` (Open / Save As inside the app's window, through the
  app's permission-checked `ctx.fs`), `ui/menubar.js`, `apps/common/document.js` (current file,
  unsaved-changes prompt, Save/Save As, titles) and `apps/common/print.js` (host print dialog,
  which also saves PDFs). New ctx APIs: `ctx.media.getUserMedia` (camera/microphone permissions;
  streams stop when the app exits), `ctx.addRecent`, `ctx.browser`.
- **Background scheduler** (`shell/scheduler.js`, one per signed-in user): rings Clock alarms and
  timers and shows Calendar reminders even when those apps are closed; Snooze/Dismiss are handled
  there (notifications with `data.service` aren't routed to the app). Alarm times follow the
  user's time-zone setting.
- **File types**: `preferredTypes` in a manifest picks the default handler among built-in apps
  (Photos for pictures, Media Player for audio/video, Browser for .html/.pdf, Notepad for .txt).
  Writer's own format is `.ddoc` (HTML inside).
- **Writer / Sticky Notes / Mail** sanitise HTML with an allow-list (`apps/writer/convert.js`): no
  scripts, event handlers or remote code. Mail shows messages in a script-less sandboxed frame with
  a strict CSP and blocks remote pictures until asked.
- **Browser**: `platform/common/web-view.js` (iframe) and `platform/desktop/web-view.js`
  (`<webview>`) share one interface. On the desktop, `electron/main.js` forces every webview to
  have no preload, no Node, `sandbox` and `contextIsolation`, its own partition
  (`persist:donut-browser`, or in-memory for private windows), blocks camera/mic/location for
  websites, turns pop-ups into tabs and saves downloads into the user's Downloads folder. Local
  HTML/SVG files open with an opaque origin so they can never reach DonutOS.
  The web build can't read cross-origin frames: titles show the site name, Back/Forward cover
  pages opened from DonutOS, and Find/Print use the host browser.
  - **Relay (web).** When the host has `api/relay` (Vercel, `scripts/serve.js`) and Browser › Settings allows it, every page goes through the relay (`api/_lib/relay.js`).
    - The relay fetches the page server-side, drops X-Frame-Options/CSP/cookies and follows redirects.
    - For HTML it adds `<base href>` (subresources load from the site directly) and a script that routes link clicks and form submissions back through the relay and posts `{donutRelay:'loaded'|'open'}` to the Browser.
    - The Browser's relay view (`platform/common/web-view.js › relayView`) keeps the real URLs for the address bar, title and Back/Forward.
    - Safety: responses carry `Content-Security-Policy: sandbox` without allow-same-origin, and the frame has no allow-same-origin, so relayed pages can't reach DonutOS's storage.
    - Requests without `Sec-Fetch-Dest: iframe` are refused, so it isn't an open proxy in a browser tab, and private network addresses are refused.
    - It can't help with logins (no cookies), JavaScript-driven navigation (`location = …`) or sites that block servers.
  - **Sites that forbid framing (no relay).** Most big sites (X-Frame-Options / CSP `frame-ancestors`) would leave an empty frame. Before loading a page, the Browser calls `ctx.browser.canEmbed(url)`.
    - On the web this asks `api/frame-check` (a Vercel function; `scripts/serve.js` answers locally). It requests the page server-side, reads only its headers, and replies true/false/null.
    - The check refuses private and loopback addresses, follows at most 5 redirects, and never passes page content back.
    - `false` shows a "*site* opens in its own tab" page with **Open in a new tab**. `null` (static hosts without the function, or offline) just tries the frame.
    - Links clicked inside a framed page can't be checked, so a notice covers those.
    - Google search uses its embeddable mode (`igu=1`); with the relay, DuckDuckGo (the default) uses its plain-HTML results page.
    - The desktop build's `<webview>` is a top-level page, so `canEmbed` is always true there.
- **Mail** (`core/mail.js`): real delivery between this device's accounts (`name@device.local`),
  stored per user in the key-value store so it reaches people who are signed out. Outside
  addresses are handed to the computer's email app (`mailto:`) — a web page can't log in to
  IMAP/SMTP servers. `.eml` import/export (`apps/mail/eml.js`, MIME + base64/quoted-printable).

## Store and SDK (phase 7)

- **Two kinds of apps.** Built-in apps (`apps/index.js`) are trusted modules that run in
  DonutOS's page with a `ctx`. Store apps are a manifest plus a `source` string; the registry marks
  them `sandboxed`, never `privileged`, and `validateManifest` only lets them declare
  `SANDBOX_PERMISSIONS` (files, system.fs, network, notifications, clipboard, location).
- **Sandbox** (`sandbox/host.js`). The process manager runs a sandboxed app through
  `sandboxModule(app)`. This makes a normal window whose body is an
  `<iframe sandbox="allow-scripts allow-forms allow-pointer-lock" srcdoc>`, so the frame has an
  opaque origin, with a CSP that blocks every network fetch (`default-src 'none'`, only inline/data:/blob:).
  - An import map points `@donut/sdk` at a data: URL of `sdk/donut-sdk.js`, and the app's source is imported as a data: URL.
  - The SDK talks to the host with `postMessage`: `ready → init` (manifest, args, storage snapshot,
    user, theme), `call → result` (one table of methods, each forwarding to the app's own `ctx`, so
    permission checks, prompts, master switches and airplane mode behave exactly as for built-in
    apps), and `event` (resize, focus, blur, activate, notification, theme).
  - The host forwards `beforeClose`, system shortcuts and crash reports between the frame and DonutOS.
  - The host only accepts messages whose `source` is its own frame.
- **Packages** (`core/dapp.js`). A `.dapp` file is JSON
  `{format:'donutos-app', formatVersion:1, manifest, icon, source}`.
  - `parseDapp` checks size (6 MB), validates the manifest, clamps window sizes, keeps only https homepages, and turns SVG icons into data URLs after stripping scripts and handlers.
  - Install = `registry.install(manifest)`, which persists in the key-value store, so installed apps survive restarts on both platforms.
- **Catalogs.** A catalog is `index.json` with entries pointing at `.dapp` files.
  - The DonutOS catalog ships in `src/store/catalog/` and is precached, so the Store works offline.
  - Extra catalogs and direct links go through the Store's `ctx.net.fetch` (network permission).
  - Updates are offered when a catalog version is higher (`compareVersions`).
  - Uninstall (`shell/apps.js › uninstallApp`) ends the app, unregisters it, and clears its `app.<id>.*` settings, permission grants and pins.
- **Developer tools.** Terminal `dapp new|pack|install|list|uninstall`, `scripts/pack-dapp.js`,
  and `npm start -- --devtools`. The full guide is [SDK.md](SDK.md).

## Security notes (desktop)

- `contextIsolation`, `sandbox`, no `nodeIntegration`; the preload exposes a fixed list of channels.
- IPC handlers only answer frames from `donut://app/`.
- The fs sandbox normalises every path, rejects drive letters/reserved characters, and refuses
  anything (including symlinks) that resolves outside the DonutOS folder. Tests in `tests/node`.
- The page can't navigate away from `donut://app/`; `window.open` of web links goes to the real browser.
- Electron grants camera/mic/notifications only to DonutOS itself; DonutOS's permission system
  then decides per app.
