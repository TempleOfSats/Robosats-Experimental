# Beep & Bop visual guide

This directory contains the screenshot-led RoboSats Exp. tutorial in two forms:

- [`index.html`](index.html) is the keyboard-navigable presentation.
- [`robosats-visual-guide.pdf`](robosats-visual-guide.pdf) is the portable version.

Every instructional frame uses a current local app capture and an avatar rendered by the app's own `RobotAvatar` generator. Captures block non-local requests and use only deterministic fixtures or synthetic browser-local state. Robot tokens, Fleet keys, invoices, and chat messages are replaced before screenshots are written.

## Regenerate the guide

Start the app on `http://127.0.0.1:5173`, then run:

```sh
npm run tutorial:capture
npm run tutorial:proof
```

Rendering uses the repository's Playwright dependency plus a local Chromium executable and ImageMagick's `montage` command. Set `CHROMIUM_PATH` when Chromium is not installed at `/usr/bin/chromium`.

The second command creates an internal proof, contact sheet, and QA report under `artifacts/tutorial-preview/`. Inspect that proof before publishing:

```sh
npm run tutorial:publish
```

Publishing writes the PDF above and individual 1600 x 900 PNG frames to `docs/assets/tutorial/slides/`.
