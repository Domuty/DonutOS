# DonutOS 🍩

A desktop operating system environment that runs in your browser (and installs as a PWA) or as a
fullscreen desktop app (Electron). One codebase, two hosts, no visible differences.

> Status: **phase 8 of 9**:
> 1. Kernel and platform adapters.
> 2. Boot, setup, lock screen, accounts and sign-in.
> 3. Desktop, taskbar, Start, Search, Quick Settings, notifications, widgets, clipboard and emoji, screenshots, Run, windows, Settings and Recycle Bin.
> 4. Snapping, snap layouts and groups, virtual desktops, Task View and Alt+Tab.
> 5. File Explorer, Terminal, Task Manager, Settings › Themes and per-app advanced options.
> 6. Notepad, Writer, Calculator, Paint, Photos, Media Player, Camera, Sound Recorder, Clock, Calendar, Sticky Notes, Browser, Mail, Solitaire and Minesweeper.
> 7. The Store (8 apps, extra catalogs, .dapp packages, updates) and the app SDK.
> 8. Accessibility (Narrator, Magnifier, contrast themes, colour filters, bigger pointers, Sticky/Bounce/Toggle Keys, on-screen keyboard), keyboard navigation, performance and polish.
>
> A full beginner's guide replaces this README in phase 9.

## Try it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install          # once
npm run serve        # web version → http://localhost:5173
npm start            # desktop version (fullscreen; quit with Start › Power › Shut down)
npm run start:windowed   # desktop version in a normal window
```

## Test

```bash
npm run test:node      # desktop file-system sandbox tests
npm run test:desktop   # core test suite inside Electron (prints PASS/FAIL, exits)
```

Web: open http://localhost:5173/tests/index.html (or open the Kernel Console app › **Run core tests**).

Starting over: on the sign-in screen choose *I forgot my password › Reset DonutOS*, or clear the
site's data in your browser (web) / delete `Documents/DonutOS` and the app's data folder (desktop).

## Deploy the web version

Push to GitHub and import the repo in Vercel. `vercel.json` already configures everything:
output folder `src`, no install step, and two small functions in `api/` for the Browser app.

- **`api/relay`** shows websites inside the Browser window. Most big sites refuse to be shown
  inside another page, so on the web version the Browser fetches pages through your
  deployment instead. Relayed pages are sealed off from DonutOS. No cookies are kept, so
  signing in to websites doesn't work, and some video or very interactive sites may not
  either. All Browser traffic goes through your Vercel account. You can turn the relay off
  in Browser › Settings.
- **`api/frame-check`** is used when the relay is off: it tells the Browser which sites refuse to
  be shown, so it can offer to open them in a normal tab instead of showing a blank page.

On static hosts without functions (e.g. GitHub Pages), sites that refuse to be shown stay
blank, with a notice offering to open them in a normal tab. The desktop version needs none of
this: every site works inside the window.

## Make an app

Open Terminal in DonutOS and type `dapp new MyApp`, edit `main.js`, then `dapp install`. The
whole API, the package format and how to publish your own catalog are in [docs/SDK.md](docs/SDK.md).

After changing a Store app in `src/store/apps/`, rebuild the catalog with `npm run build:catalog`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it all fits together.
