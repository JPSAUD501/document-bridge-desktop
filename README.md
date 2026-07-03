# Document Bridge Desktop

Windows-only Electron app for browser-based document transfer workflows using Playwright and a desktop control panel.
The automation engine stays in Node, while the UI is rendered in Electron with a preload bridge and a React renderer.

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm run test
npm run build
npm run package
```

On first startup, the app opens Microsoft Edge by default using a dedicated persistent automation profile.
The user may need to sign in once; subsequent runs reuse the saved browser profile.
If Edge or Chrome is not available, the app falls back to Playwright's managed Chromium/Chrome for Testing.

## Configuration

Provide the target system URLs through environment variables before packaging or running in production:

```bash
set ERP_URL=https://erp.example.com/path
set MIDAS_URL=https://destination.example.com/upload
set ERP_MIDAS_BROWSER_CHANNEL=msedge
```

Optional browser overrides:

```bash
set ERP_MIDAS_BROWSER_CHANNEL=chrome
set ERP_MIDAS_BROWSER_PATH=C:\Program Files\Microsoft\Edge\Application\msedge.exe
set ERP_MIDAS_BROWSER_PROFILE_DIR=C:\Users\you\AppData\Roaming\Pegasus\browser-profile
```

## Build And Release

```bash
npm run build
npm run package
npm run release:github
```

The local packaging flow generates the installer, blockmap, and `latest.yml` metadata for Electron auto-update.
