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

On first startup, the app may install Chrome for Testing through Playwright if no compatible browser is available locally.

## Configuration

Provide the target system URLs through environment variables before packaging or running in production:

```bash
set ERP_URL=https://erp.example.com/path
set MIDAS_URL=https://destination.example.com/upload
```

## Build And Release

```bash
npm run build
npm run package
npm run release:github
```

The local packaging flow generates the installer, blockmap, and `latest.yml` metadata for Electron auto-update.
