# DonutOS 🍩

A desktop operating system environment that runs in your browser (and installs as a PWA) or as a
fullscreen desktop app (Electron). One codebase, two hosts, no visible differences.

> Status: **phase 2 of 9** — kernel core and both platform adapters (phase 1); boot animation,
> first-run setup, lock screen, sign-in, multiple accounts with hashed passwords/PINs, guest,
> switch user, sign out, sleep/shut down/restart (phase 2). The desktop, taskbar and Start menu
> arrive in phase 3. A full beginner's guide replaces this README in phase 9.

## Try it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install          # once
npm run serve        # web version → http://localhost:5173
npm start            # desktop version (fullscreen; press Alt+F4 / Cmd+Q to quit)
npm run start:windowed   # desktop version in a normal window
```

## Test

```bash
npm run test:node      # desktop file-system sandbox tests
npm run test:desktop   # core test suite inside Electron (prints PASS/FAIL, exits)
```

Web: open http://localhost:5173/tests/index.html (or Start › Kernel console › **Run core tests**).

Starting over: on the sign-in screen choose *I forgot my password › Reset DonutOS*, or clear the
site's data in your browser (web) / delete `Documents/DonutOS` and the app's data folder (desktop).

## Deploy the web version

Push to GitHub and import the repo in Vercel — `vercel.json` already configures everything
(output folder `src`, no install step).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it all fits together.
