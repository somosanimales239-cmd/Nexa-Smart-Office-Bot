# Installation and build instructions

## Through Nexa Manual Delivery

1. Create or open the project `Nexa Smart Office Bot`.
2. Open **Manual Delivery**.
3. Upload `Nexa_Smart_Office_Bot_v1.0.0_source.zip`.
4. Review the staged file list.
5. Apply the staged files.
6. Connect the project to its GitHub repository.
7. Choose **Push to GitHub & Build**.
8. Wait for the same workflow run to finish.
9. Download the verified Installer, Portable and Windows ZIP artifacts.

## Local development

Requires Node.js 24 or newer.

```bash
npm install
npm start
```

## Validation

```bash
npm run validate
npm test
npm run ui:smoke
```

## Windows build

```bash
npm run build:win
npm run verify:artifacts
```

The generated files are written to `dist/`.

## First launch

The application creates its SQLite workspace in Electron's user-data directory. Open **Settings** to configure the preferred provider, model and API key. Keys are encrypted through the operating system using Electron `safeStorage`.
