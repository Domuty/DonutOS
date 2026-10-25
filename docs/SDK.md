# DonutOS App SDK

This guide shows how to build an app for DonutOS, package it as a `.dapp` file, and publish it in a Store catalog.

Store apps work the same on the web version and the desktop (Electron) version. You write one JavaScript module, and DonutOS gives it a window, a theme, private storage, and access to files, the internet and notifications. Every one of those goes through the permission system.

- [1. Your first app in five minutes](#1-your-first-app-in-five-minutes)
- [2. How Store apps run](#2-how-store-apps-run)
- [3. The manifest](#3-the-manifest)
- [4. Permissions](#4-permissions)
- [5. API reference](#5-api-reference)
- [6. Styling](#6-styling)
- [7. The .dapp package format](#7-the-dapp-package-format)
- [8. Publishing: catalogs](#8-publishing-catalogs)
- [9. Developer tools](#9-developer-tools)
- [10. Limits and tips](#10-limits-and-tips)

---

## 1. Your first app in five minutes

1. Open **Terminal** in DonutOS and run:
   ```
   dapp new Hello
   cd ~/Documents/Apps/Hello
   ```
   This creates three files:

   | File | What it is |
   |---|---|
   | `manifest.json` | name, id, version, permissions, window size |
   | `main.js` | your code |
   | `icon.svg` | the app icon (edit it, or replace it with your own SVG) |

2. Edit `main.js` in **Notepad** (or type `edit main.js` in Terminal, which opens it there).
   ```js
   import { h, mount, css, ui } from '@donut/sdk';

   css(`.hello { padding: 24px; display: grid; gap: 12px; justify-items: start; }`);

   export default function main(app) {
     let clicks = app.storage.get('clicks', 0);
     const label = h('p');
     const paint = () => { label.textContent = `You clicked ${clicks} times.`; };
     mount(app.root, h('div.hello',
       h('h1', 'Hello, ', app.user.name, '!'),
       label,
       h('button.btn.primary', { onclick: () => { clicks++; app.storage.set('clicks', clicks); paint(); } }, 'Click me')));
     paint();
   }
   ```
3. Run `dapp install`. The **Store** opens with your package. Click **Install**, then **Open**.

   After each change to `main.js`, run `dapp install` again. The Store shows **Update**, closes the running copy, and installs the new version. Your app's saved storage is kept.

You can also build packages outside DonutOS:

```
node scripts/pack-dapp.js path/to/my-app-folder
```

Then open the `.dapp` file in DonutOS: double-click it in File Explorer, or use **Store › Sources › From a .dapp file…**.

---

## 2. How Store apps run

Built-in apps run inside DonutOS's own page. Store apps never do. Each Store app window contains a **sandboxed frame**:

- **No origin.** The frame has an opaque origin. It can't read DonutOS's page, cookies, localStorage, IndexedDB or any other app, and it can't navigate the top window.
- **Strict Content-Security-Policy.** The frame can't load anything from the network: no `<script src=https://…>`, no remote images, no `fetch()` or WebSocket of its own. Code, styles, images and fonts must be inline or `data:`/`blob:` URLs. All internet access goes through `app.net.fetch`, which needs the `network` permission.
- **Message channel.** Every SDK call (`app.fs.readText`, `app.notify`, `ui.confirm`, …) becomes a message to DonutOS. DonutOS checks the app's permissions, does the work, and replies. The app gets a Promise.
- **Same look.** DonutOS passes its theme (colours, fonts, radius, light or dark) into the frame as CSS variables and updates them live when the user changes the theme. The SDK stylesheet styles buttons, inputs and cards to match the built-in apps.
- **System shortcuts still work.** The Win key, Alt+Tab, Alt+F4, Ctrl+Alt+… and Ctrl+Shift+Esc are passed back to DonutOS while your app has focus.
- **Crashes stay contained.** If `main()` throws, the window shows "*App* stopped working" with **Restart** and **Close**. The rest of DonutOS is unaffected. Errors after start are written to the system log (**Kernel Console › Log**).

Your module is loaded as an ES module. `import … from '@donut/sdk'` is the only import that resolves. Put everything else in your one `main.js` file (bundle it if you use libraries).

---

## 3. The manifest

`manifest.json`:

```json
{
  "id": "com.example.hello",
  "name": "Hello",
  "version": "1.0.0",
  "author": "Your Name",
  "category": "Utilities",
  "summary": "Says hello",
  "description": "A friendly app that counts your clicks.",
  "features": ["Remembers your clicks", "Follows your theme"],
  "permissions": ["notifications"],
  "fileTypes": [".hello"],
  "singleInstance": false,
  "homepage": "https://example.com/hello",
  "window": { "width": 640, "height": 480, "minWidth": 320, "minHeight": 240 }
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique id: 2–64 lowercase letters, digits, dots or dashes. Use reverse-domain style (`com.you.app`). |
| `name` | yes | Shown in Start, the taskbar and the title bar (max 60 characters). |
| `version` | yes | `MAJOR.MINOR.PATCH`, optionally with a `-beta.1`-style suffix. The Store offers an update when a catalog has a higher version. |
| `author` | | Shown in the Store (max 80 characters). |
| `category` | | Store category, e.g. Games, Productivity, Utilities, Developer, Education, Lifestyle. |
| `summary` | | One line for Store cards. Defaults to the first sentence of `description`. |
| `description` | | Store page text (max 600 characters). |
| `features` | | Bullet list on the Store page. |
| `permissions` | | See [Permissions](#4-permissions). Any permission you don't list is always denied. |
| `fileTypes` | | Extensions your app can open, e.g. `[".md"]`. Your app appears in File Explorer's **Open with**, and the file path arrives in `app.args.path`. |
| `singleInstance` | | `true` means launching again focuses the existing window and calls `app.onActivate(args)`. |
| `homepage` | | An `https://` link shown on the Store page. |
| `window` | | Starting and minimum size in pixels. Values are clamped to sensible limits. |

---

## 4. Permissions

Store apps may declare only these permissions:

| Permission | Lets the app… |
|---|---|
| `files.read` | read files in the user's home folder |
| `files.write` | create, change and delete files in the user's home folder |
| `system.fs` | read and write outside the home folder (must be combined with `files.read`/`files.write`) |
| `network` | use `app.net.fetch` and `app.openExternal` |
| `notifications` | show notifications |
| `clipboard` | read the clipboard (copying text with `app.clipboard.writeText` needs no permission) |
| `location` | get the approximate location |

Camera, microphone, screen capture and the `system.*` powers (installing apps, managing users, changing device settings, ending processes) are only available to built-in apps. The Store refuses a package that asks for them.

How permissions work:

- **The user is asked the first time** your app uses a permission, not at install time. The answer (Allow or Don't allow) is remembered per user and can be changed in **Settings › Privacy › App permissions**.
- **Master switches win.** If the user turns off Location or Notifications for all apps, or turns on airplane mode or turns off Wi-Fi (which blocks `network`), your call fails with `EPERM`.
- **Denied calls reject** with an error where `err.code === 'EPERM'` (and `err.name === 'PermissionError'`). Always handle them:
  ```js
  try { await app.fs.writeText(path, text); }
  catch (err) { if (err.code === 'EPERM') ui.alert('Can’t save', 'Allow “Change your files” in Settings › Privacy.'); else throw err; }
  ```
- `app.permissions.status('network')` returns one of `'granted' | 'denied' | 'prompt' | 'blocked' | 'undeclared'` without asking. `app.permissions.request('network')` asks if needed and resolves `true`/`false`.

---

## 5. API reference

```js
import { h, mount, css, ui, DonutError } from '@donut/sdk';
export default async function main(app) { … }
```

`main` may be async. If it throws or its Promise rejects, the window shows the crash screen.

### `app`

| Property | Type | |
|---|---|---|
| `app.id`, `app.name`, `app.version` | string | from your manifest |
| `app.manifest` | object | the installed manifest, plus `permissionInfo` (labels for each permission) |
| `app.args` | object | launch arguments, e.g. `{ path: '/Users/ana/Documents/notes.md' }` when opened from File Explorer |
| `app.user` | `{ name, home }` | the signed-in user's display name and home folder |
| `app.root` | HTMLElement | the element that fills your window, so draw into it |
| `app.theme` | `{ mode: 'light' \| 'dark', tokens }` | current theme; see `onThemeChange` |

### `app.window`

| Method | |
|---|---|
| `setTitle(text)` | change the title bar and taskbar text |
| `setSize(width, height)` | resize the window |
| `minimize()`, `maximize()`, `restore()`, `focus()`, `close()` | |
| `onBeforeClose(fn)` | `fn()` may return `false` (or a Promise of `false`) to keep the window open, for example after asking "Save changes?". If you don't answer within 3 seconds, the window closes anyway. |
| `onResize(fn)` | `fn({ width, height })` |
| `onFocus(fn)`, `onBlur(fn)` | the window gained or lost focus |

All methods return Promises. Each `on…` function returns an unsubscribe function, except `onBeforeClose`.

### `app.storage`

Private, per-user storage for your app. It persists across restarts and survives updates, and is removed when the app is uninstalled. Values must be JSON-compatible.

| Method | |
|---|---|
| `get(key, fallback)` | **synchronous**; returns a copy of the value or `fallback`. Keys are 1–100 letters, digits, `_`, `-` or `.`. |
| `set(key, value)` | saves (returns a Promise you don't have to await) |
| `remove(key)` | |
| `keys()` | synchronous list of keys |

### `app.fs`

Paths are absolute DonutOS paths like `/Users/ana/Documents/file.txt`. `app.fs.home()` returns the user's home folder. Reading needs `files.read`; writing needs `files.write`; paths outside the home folder also need `system.fs`.

| Method | Returns |
|---|---|
| `readText(path)` | string |
| `readFile(path)` | Uint8Array |
| `readJSON(path, fallback?)` | parsed value (or `fallback` if missing) |
| `writeText(path, text)`, `writeFile(path, bytes)`, `writeJSON(path, value)`, `appendText(path, text)` | |
| `readdir(path)` | `[{ name, path, type: 'file' \| 'dir', size, mtime, ext, mime }]` |
| `stat(path)` | `{ name, path, type, size, mtime, ctime, ext, mime }` |
| `exists(path)` | boolean |
| `mkdir(path, { recursive })` | |
| `remove(path, { recursive })` | deletes permanently |
| `trash(path)` | moves to the Recycle Bin (preferred) |
| `rename(path, newName)`, `move(from, to)`, `copy(from, to)` | |

Errors have codes such as `ENOENT` (not found), `EEXIST`, `EISDIR`, `ENOTDIR`, `ENOSPC` and `EPERM`.

On the desktop version the home folder is real files on disk (see the README). On the web version it is stored in the browser.

### `app.net`

| Method | |
|---|---|
| `fetch(url, { method, headers, body })` | Needs `network`. Returns a standard `Response` (`await res.json()`, `res.ok`, …). Requests are sent without cookies. In both versions the server must allow cross-origin requests (CORS), as most public APIs do. |
| `online()` | `true` when DonutOS is online and Wi-Fi/airplane mode allow it |

### Notifications

```js
await app.notify({ title: 'Timer done', body: 'Tea is ready', actions: [{ id: 'again', label: 'Again' }], data: { minutes: 3 } });
app.onNotification(({ actionId, data }) => { if (actionId === 'again') start(data.minutes); });
```

This needs `notifications`. Notifications appear as toasts and in the notification centre, and they follow Do Not Disturb. At most 3 actions are shown. `notify` resolves `true` if the notification was shown.

### Other methods

| | |
|---|---|
| `app.clipboard.writeText(text)` / `readText()` | copy text (no permission needed) / read it (needs `clipboard`) |
| `app.location.get()` | `{ latitude, longitude, accuracy }`; needs `location` |
| `app.launch(appId, args)` | open another app, e.g. `app.launch('notepad', { path })` |
| `app.open(path)` | open a file with its default app |
| `app.openExternal(url)` | open an `https:` or `mailto:` link outside DonutOS: a new tab on the web version, the computer's default browser on the desktop version (needs `network`) |
| `app.exportFile(name, data, mime)` | save a copy to the real computer (a download on the web, a Save dialog on the desktop) |
| `app.permissions.status(p)` / `request(p)` | see [Permissions](#4-permissions) |
| `app.onThemeChange(fn)` | `fn(theme)` after the user changes light/dark mode or the accent colour (CSS variables are already updated) |
| `app.onActivate(fn)` | `fn(args)` when a `singleInstance` app is launched again |
| `app.exit()` | quit the app |

### `ui`: DonutOS dialogs

These are drawn by DonutOS over your window, so they look exactly like the system dialogs.

| | Resolves |
|---|---|
| `ui.alert(title, message)` | `true` |
| `ui.confirm(title, message, { ok, cancel, danger })` | `true` / `false` |
| `ui.prompt(title, { label, value, placeholder, ok })` | string, or `null` if cancelled |
| `ui.openFile({ title, filters, multiple })` | path (or array of paths), or `null` |
| `ui.saveFile({ title, filters, suggestedName })` | path, or `null` |
| `ui.menu(items, at)` | the chosen item's `id` (or `label`), or `null` |

`filters` look like `[{ label: 'Markdown', exts: ['.md', '.markdown'] }, { label: 'All files', exts: ['*'] }]` (`{ name, extensions: ['md'] }` also works). Picking a file doesn't grant file access by itself: you still need `files.read`/`files.write` to read or write it.

For `ui.menu`, `items` is `[{ id, label, checked?, disabled?, danger?, hint? } | { separator: true } | { header: 'Text' }]`. `at` is a mouse event (the menu opens at the pointer), an element (it opens below it), or `{ x, y }` in your frame's coordinates.

```js
button.onclick = async (e) => {
  const choice = await ui.menu([{ id: 'new', label: 'New list' }, { separator: true }, { id: 'del', label: 'Delete', danger: true }], e.currentTarget);
  if (choice === 'del' && await ui.confirm('Delete list?', 'This can’t be undone.', { ok: 'Delete', danger: true })) remove();
};
```

### `h`, `mount`, `css`

These are the same small helpers the built-in apps use.

```js
h('div.card#main', { onclick, style: { gap: '8px' }, dataset: { id: 7 }, class: ['a', on && 'b'] }, 'text', child, [more, children])
mount(element, ...children)   // replace an element's contents
css(`.card { … }`)            // add a stylesheet, returns the <style>
```

`h` sets DOM properties when they exist (`value`, `checked`, `disabled`, …), adds listeners for `on…` functions, and sets attributes otherwise. `null`, `undefined` and `false` children are skipped. You can also use plain DOM APIs or bundle any framework into `main.js`.

---

## 6. Styling

The SDK stylesheet already styles `body` with the system font, the window background and text colour, plus these classes:

| Class | |
|---|---|
| `.btn`, `.btn.primary`, `.btn.danger`, `.btn.subtle`, `.btn.icon` | buttons |
| `.input` (on `input`, `select`, `textarea`) | text fields |
| `.toggle` | `<label class="toggle"><input type="checkbox"><span></span> Label</label>` |
| `.card`, `.row`, `.stack`, `.grow`, `.page`, `.list`, `.list-item`, `.toolbar`, `.empty` | layout |
| `.muted`, `.hint` | secondary text |

Theme variables you can use in your own CSS (they update live): `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--surface-raised`, `--surface-solid`, `--text`, `--text-2`, `--text-3`, `--border`, `--border-strong`, `--hover`, `--press`, `--input-bg`, `--input-border`, `--accent`, `--accent-hover`, `--accent-soft`, `--accent-text`, `--accent-contrast`, `--ok`, `--warn`, `--danger`, `--radius`, `--radius-s`, `--radius-l`, `--shadow`, `--shadow-s`, `--font`, `--font-display`, `--font-mono`, `--ease-out`, `--ease-in`, `--dur`.

`document.documentElement.dataset.theme` is `'light'` or `'dark'`.

---

## 7. The .dapp package format

A `.dapp` file is one UTF-8 JSON document:

```json
{
  "format": "donutos-app",
  "formatVersion": 1,
  "manifest": { "id": "com.example.hello", "name": "Hello", "version": "1.0.0", "…": "…" },
  "icon": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 48 48\">…</svg>",
  "source": "import { h } from '@donut/sdk';\nexport default function main(app) { … }"
}
```

| Rule | |
|---|---|
| `icon` | SVG markup, or a `data:image/png\|jpeg\|webp;base64,…` URL. `<script>` elements and `on…` attributes are removed from SVGs. A 48×48 viewBox works well. |
| Size | The whole package can be up to 6 MB, and `source` up to 4 MB. |
| Validation | The id, version and permissions are checked when the package is opened. The Store shows the exact problem if anything is wrong. |

When DonutOS installs a package, it shows the name, author, version and the permissions it will ask for, with a warning if the package didn't come from a catalog. Installing a higher version of an installed id updates it (storage is kept). Installing the same version reinstalls it, and installing a lower version asks first.

---

## 8. Publishing: catalogs

A catalog is a static `index.json` file with `.dapp` files next to it. Any HTTPS host that sends CORS headers works, for example GitHub Pages, Vercel, Netlify or an S3 bucket.

```json
{
  "name": "Ana’s Apps",
  "apps": [
    {
      "id": "com.ana.timer",
      "name": "Tea Timer",
      "version": "1.2.0",
      "author": "Ana",
      "summary": "Never over-steep again",
      "description": "Timers for green, black and herbal tea…",
      "category": "Lifestyle",
      "permissions": ["notifications"],
      "features": ["Presets", "Notifications"],
      "size": 18342,
      "package": "com.ana.timer.dapp",
      "icon": "data:image/svg+xml;base64,…",
      "updated": "2026-10-01"
    }
  ]
}
```

- `package` is resolved relative to the `index.json` address, so it can also be a full URL.
- `id` and `version` must match the package. The Store refuses a package whose id differs from its catalog entry.
- Users add your catalog in **Store › Sources › Add a catalog…** with its `https://…/index.json` address. Its apps then appear in Home and search, and new versions appear in **Library › Updates**.
- If two catalogs list the same id, the first wins. The built-in DonutOS catalog always comes first.

To make a catalog the same way DonutOS's own is made, put each app in `apps/<folder>/` with `manifest.json`, `main.js` and `icon.svg`, and adapt `scripts/build-catalog.js`, which writes the `.dapp` files and `index.json`.

Users can also install a single package from a link: **Store › Sources › From a web address…**.

---

## 9. Developer tools

### Terminal: `dapp`

| Command | |
|---|---|
| `dapp new Name` | create `~/Documents/Apps/Name/` with a working starter app |
| `dapp pack [folder]` | validate and write `<id>.dapp` next to the folder (default: current folder) |
| `dapp install [folder \| file.dapp]` | pack if needed, then open it in the Store to install or update |
| `dapp list` | installed Store apps with versions |
| `dapp uninstall id` | remove an installed app, with its storage, permissions and pins (like **Uninstall** in the Store) |

### Command line: `scripts/pack-dapp.js`

```
node scripts/pack-dapp.js <folder> [output.dapp]
```

This packs a folder from your real computer and runs the same checks as DonutOS. Copy the result into DonutOS (drag it into File Explorer on the web, or put it in your DonutOS home folder on the desktop version) and open it.

### Debugging

- **Web:** open the browser DevTools (F12). Your app's `console.log` output appears in the Console. To run code inside your app, pick its `about:srcdoc` frame in the Console's context drop-down.
- **Desktop:** start with `npm start -- --devtools` to open DevTools in its own window.
- Errors that happen after `main()` has started are also written to the system log (**Kernel Console › Log**).

### Examples

The eight apps in the DonutOS Store are real Store apps built only with this SDK, so read them for patterns:

| App | Folder | Shows |
|---|---|---|
| Weather | `src/store/apps/weather/` | `net.fetch`, `location.get`, caching for offline |
| To Do | `src/store/apps/todo/` | storage, notifications with actions |
| Markdown | `src/store/apps/markdown/` | file open/save dialogs, `fileTypes`, `onBeforeClose` |
| QR Codes | `src/store/apps/qrcode/` | canvas, `exportFile`, clipboard |
| Snake, 2048, Typing Test | | keyboard, animation, high scores |
| Colors | | clipboard and the theme variables |

---

## 10. Limits and tips

- **No camera, microphone or screen capture** for Store apps. These powers are kept for built-in apps (Camera, Voice Recorder, Snipping Tool), because a sandboxed frame can't safely be given device access in both versions.
- **Background work stops when your window closes.** Timers and reminders run only while your app is open. If you need a reminder later, show it while open, and tell the user so.
- **No direct network access.** `fetch()`, `XMLHttpRequest`, `WebSocket`, remote `<img src>` and remote fonts are blocked by the sandbox. Use `app.net.fetch` and turn responses into `blob:` URLs for images:
  ```js
  const res = await app.net.fetch(url);
  img.src = URL.createObjectURL(await res.blob());
  ```
- **Workers** are allowed from `blob:` URLs.
- **Keep `main.js` self-contained.** Bundle libraries with esbuild or rollup (`--format=esm`) and mark `@donut/sdk` as external.
- **Save often.** Users can close windows, sign out or shut down at any time. `onBeforeClose` gives you a chance to ask, but `app.storage.set` as you go is safest.
