## FlySpeed Markdown (flyMD)

[简体中文](README.md) | English

[![Version](https://img.shields.io/badge/version-v0.1.0-blue.svg)](https://github.com/flyhunterl/flymd)
[![License](https://img.shields.io/badge/license-Apache%202.0-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey.svg)](https://github.com/flyhunterl/flymd)

A fast, lightweight, and stable Markdown editor/previewer powered by Tauri.


- Extensions & Plugins: manage built-ins and install community extensions (v0.1.0).
- WYSIWYG overlay: instant rendering while typing; toggle with `Ctrl+Shift+E`.
- Solid Preview mode: toggle Edit/Preview with `Ctrl+E`.
- Full Markdown stack: markdown-it, KaTeX (LaTeX), Mermaid, highlight.js.
- Safe HTML rendering with DOMPurify; image path auto-fix for Tauri `asset:`.
- File library sidebar with quick open/rename/move/delete.
- Drag-and-drop open; PDF inline preview; paste or upload images to S3/R2.
- Position persistence: restore last caret/scroll position per file.


## Screenshots

See the main README for screenshots.


## Install

- Download from Releases and run the installer:
  - Windows: `flymd_0.1.0_x64_setup.exe` (file name may vary per release)
- Requirements:
  - Windows 10/11 (x64) or Linux
  - WebView2 Runtime on Windows (usually preinstalled)


## Development

- Prerequisites: Node.js 20+, Rust toolchain for Tauri
- Commands:
  - `npm install`
  - Run web dev server: `npm run dev`
  - Run Tauri app (dev): `npm run tauri:dev`
  - Build release: `npm run tauri:build`


## Usage Tips

- Toggle Edit/Preview: `Ctrl+E`
- WYSIWYG overlay: `Ctrl+Shift+E`
- Insert link: `Ctrl+K` | Bold: `Ctrl+B` | Italic: `Ctrl+I`
- New/Open/Save/Save As: `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S`
- Drag a `.md` file onto the window to open; paste an image to insert and upload if configured.


## Markdown Features

- markdown-it with `breaks: true` so a single newline becomes `<br>`.
- KaTeX for inline/block math; tuned to avoid overlap in WYSIWYG view.
- Mermaid diagrams via ```mermaid` fenced blocks.
- Safe rendering via DOMPurify, with essential SVG/Math tags allowed.


## Extensions

- Manage built-in extensions and install community extensions from GitHub or URLs.
- Built-in: Image Uploader (S3/R2) settings dialog is integrated; you can open it from Extensions.
- Install example: Typecho publisher extension (community) can be installed via the installer input using `TGU-HansJack/typecho-publisher-flymd@main`.
- Open the Extensions panel via the top-right Extensions button.
## Image Upload (S3/R2)

- Configure your S3/R2 credentials (see Settings > Extensions > Image Uploader).
- Paste or drag an image to insert. While uploading, a placeholder is shown and then replaced with the final URL.
- Fallback priority:
  - Enabled + configured uploader: upload to S3/R2 and insert the public URL (no local copy).
  - Disabled or not configured: save to a local `images/` folder next to the current document; for unsaved docs, save to the system Pictures directory and insert the absolute/escaped path.
  - Upload error when enabled: fallback to the local save branch as a safety net.
- Preview rendering: local paths are resolved via Tauri sset:; if loading fails in dev, automatically falls back to a `data:` URL to keep images visible.
## Known Behaviors

- In WYSIWYG mode, unclosed ```/~~~ fences and unclosed math blocks are intentionally not rendered until closed, to avoid obstructing input.
- When an inline `$...$` math is closed, the editor automatically inserts extra newlines to prevent visual overlap with following text.


## Shortcuts

- `Ctrl+N` New | `Ctrl+O` Open | `Ctrl+S` Save | `Ctrl+Shift+S` Save As
- `Ctrl+E` Edit/Preview | `Ctrl+Shift+E` WYSIWYG overlay
- `Ctrl+B` Bold  •  `Ctrl+I` Italic  •  `Ctrl+K` Insert Link
- `Esc` Close Preview / dialogs


## Changelog (v0.0.9)

- New: Extensions system — manage and install extensions. Thanks to contributor [HansJack](https://github.com/TGU-HansJack).

## Changelog (v0.0.8-fix)

- Fix: incorrect update URL caused auto-download failures in some cases.
- Add: backup proxy mirrors to reduce failures when primary proxy is unavailable.
## Changelog (v0.0.8)

- Paste images without uploader: saves to a local `images/` folder next to the current document and inserts a relative path (`images/<name>`). If the image already exists, we reference by path (no copy).
- Unsaved documents: if a default paste directory is configured, pasted images are saved there and the absolute/escaped path is inserted. If not available or write fails, falls back to data URL.
- Auto fallback: on preview, local paths are rendered via Tauri `asset:`; if loading fails, it automatically falls back to a `data:` URL to keep images visible in dev.

## Changelog (v0.0.7)

- Library: improved file support; customizable sort; filters to hide non-md/markdown/txt/PDF; better UX for open/rename/move/delete.
- Update: built-in update checker and downloader.
- File operations: add Trash integration and force remove APIs to improve safety and recovery.
- Mermaid: add caching of rendered SVG to reduce flicker and speed up repeated renders.
- Stability and performance improvements.


## License

Apache-2.0. See `LICENSE`.


## Acknowledgements

- Tauri | markdown-it | DOMPurify | highlight.js | KaTeX | Mermaid


