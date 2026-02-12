# Ignition Syncing Tool

React + TypeScript application for syncing and reviewing Ignition exports.

The project runs in two modes:
- Web app (Vite)
- Desktop app (Electron wrapper around the same web UI)

## What This Tool Does

### 1) Sync Translation
Upload multiple Ignition translation XML files and merge them.

How it works:
- Parses all uploaded XML translation terms.
- Groups terms by key.
- Keeps keys that have one unique value across files.
- Flags keys with conflicting values as conflicts.
- Shows conflicts in an expandable list with per-value file provenance (which value appears in which files).
- Lets you select one value per conflicting key to include in the merged export.
- Any conflicting key without a selected value is excluded from export.
- Supports `Collapse` per conflict and `Collapse All` for expanded conflicts.

Language validation for export:
- Ignition translation language is inferred from the uploaded filename suffix (final `_xx` segment before extension), for example `_en`, `_pt`, `_es`.
- All uploaded files must share the same language suffix.
- If suffixes are mixed or missing, an inline error is shown and download is disabled.

Output:
- `merged_translations_<language>.xml` (example: `merged_translations_en.xml`)
- Conflict review + selection UI in the page

### 2) Sync UDT Definitions
Upload multiple Ignition UDT definition JSON exports and compare/merge them.

How it works:
- Recursively finds all `tagType: "UdtType"` definitions from each JSON.
- Compares definitions with order-insensitive matching for object keys/arrays.
- Detects:
  - Missing definitions per file
  - Definition mismatches for same UDT name
  - Mismatch type details:
    - Missing properties only
    - Unequal values only
    - Missing properties + unequal values
- Shows expandable differences with:
  - Highlighted JSON sections
  - Variant-level missing/unequal summaries
  - Copy JSON buttons
  - Optional per-finding `Union merge` switch (available for missing-properties-only mismatches)
  - Glossary info button for Difference/Mismatch/Missing/Unequal terms
  - Collapse single / Collapse all controls
  - Optional debug tools toggle (reveals temporary debug export actions)

Merge rule:
- Uses the first uploaded file as reference.
- By default, for UDT names that exist in the reference file, the merged output keeps that reference definition.
- If a UDT name is missing in the reference file, it keeps the first occurrence by upload order.
- For mismatches that are `missing properties only`, you can enable `Union merge` on that finding to include the union of unique properties from all variants in the final export.
- `Union merge` does not override unequal-value conflicts; those continue following the reference-based rule.
- Produces a merged JSON with unique UDT names.

Output:
- `merged_udt_definitions.json`

### 3) Translation Cleaner
Upload one Ignition translation XML and one or more Ignition project ZIP exports, then remove unused translation entries.

How it works:
- Parses all terms from the uploaded translation XML.
- Extracts all uploaded project ZIP files in memory.
- Scans text-based project files for key usage (`.json`, `.xml`, `.py`, `.sql`, `.txt`, `.yaml`, `.yml`, `.csv`, `.js`, `.ts`, `.tsx`, `.jsx`).
- Treats a key as `used` when the full key string exists in any scanned file.
- Lists `unused` terms in a review table (`Unused Translation Entries`).
- Exports a cleaned translation XML containing only used keys.

Detection note:
- This scan is literal string matching.
- Keys assembled dynamically at runtime (for example via string concatenation in scripts/expressions) may not be detected and can appear as unused.

Debug tools:
- A `Show debug tools` toggle reveals temporary troubleshooting actions.
- `Download Cleaner Debug Data (Temporary)` appears at the bottom of the analysis results box.

Output:
- If input filename ends with a locale suffix (`_en.xml`, `_es.xml`, `_pt.xml`, etc.), export is named with `_cleaned` before the locale suffix.
  Example: `merged_translations_en.xml` -> `merged_translations_cleaned_en.xml`
- Fallback for non-locale filenames: `<name>_cleaned.xml`

## Session Behavior

For `Sync Translation`, `Sync UDT Definitons`, and `Translation Cleaner`:
- Uploaded files and analysis results persist when switching tabs.
- State resets only when:
  - You change/remove files in that tab
  - You reload/restart the application

## Tech Stack

- React 19
- TypeScript 5
- Vite 6
- Electron 38
- Bootstrap 5
- `fast-xml-parser` 5.3.4
- `jszip` 3

## Requirements

- Node.js 20+ (LTS recommended)
- npm 10+ recommended
- Windows for `.exe` packaging

## Getting Started (Local Web App)

```bash
npm install
npm run dev
```

Open the URL shown by Vite (default: `http://localhost:5173`).

## Run as Electron App (Local Dev)

```bash
npm install
npm run dev:app
```

What this runs:
- `npm run dev` (Vite dev server)
- `npm run dev:electron` (launches Electron after server is ready)

## Build Commands

### Web build
```bash
npm run build
```

Preview web production build:
```bash
npm run preview
```

### Electron distributables
```bash
npm run build:app
```

This builds web assets and packages Electron using `electron-builder`.

Windows artifacts (from current config):
- Installer (NSIS): `release/Ignition Syncing Tool Setup <version>.exe`
- Portable executable: `release/Ignition Syncing Tool <version>.exe`

Build only the Windows portable executable:
```bash
npm run build:portable
```

## Scripts Reference

- `npm run dev` -> Start web dev server (Vite)
- `npm run dev:electron` -> Start Electron against existing dev server
- `npm run dev:app` -> Run Vite + Electron together
- `npm run build` -> Type-check + web production build
- `npm run build:web` -> Web production build only
- `npm run build:app` -> Web build + Electron packaging
- `npm run build:portable` -> Web build + Windows portable executable only
- `npm run preview` -> Serve built web assets locally
- `npm run lint` -> ESLint

## Suggested Development Workflow

Before pushing changes:

```bash
npm run lint
npm run build
```

Recommended:
- Keep `package-lock.json` committed.
- Keep large local sample exports outside version control.
- Add new parser/comparison logic with deterministic rules and tests where possible.

## Project Structure

```text
electron/                  Electron main + preload
src/
  components/              UI pages/components
  utils/                   XML/JSON parsing, merge, comparison logic
public/                    Static assets
```

## Troubleshooting

### Electron does not open in dev mode
- Confirm `npm run dev` works first.
- Then run `npm run dev:app` (it waits for `http://localhost:5173`).

### SmartScreen warning on Windows executable
- Unsigned executables can trigger SmartScreen.
- For distribution, use code signing.

### I switched tabs and lost data
- Data persists across tabs in this version.
- If data is lost, check if the page/app was reloaded.

## License

No license file is currently included in this repository.
