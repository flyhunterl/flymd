## FlySpeed Markdown (flyMD)

[简体中文](README.md) | English

[![Version](https://img.shields.io/badge/version-v0.0.7-blue.svg)](https://github.com/flyhunterl/flymd)
[![License](https://img.shields.io/badge/license-Apache%202.0-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey.svg)](https://github.com/flyhunterl/flymd)

A fast, lightweight, and stable Markdown editor/previewer powered by Tauri.


## Highlights

- WYSIWYG overlay: instant rendering while typing; toggle with `Ctrl+Shift+E`.
- Solid Preview mode: toggle Edit/Preview with `Ctrl+E`.
- Full Markdown stack: Markdown‑It, KaTeX (LaTeX), Mermaid, highlight.js.
- Safe HTML rendering with DOMPurify; image path auto‑fix for Tauri `asset:`.
- File library sidebar with quick open/rename/move/delete.
- Drag‑and‑drop open; PDF inline preview; paste or upload images to S3/R2.
- Position persistence: restore last caret/scroll position per file.


## Screenshots

See the main README for screenshots.


## Install

- Download from Releases and run the installer:
  - Windows: `flymd_0.0.7_x64_setup.exe` (file name may vary per release)
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
- Insert link: `Ctrl+K`  •  Bold: `Ctrl+B`  •  Italic: `Ctrl+I`
- New/Open/Save/Save As: `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S`
- Drag a `.md` file onto the window to open; paste an image to insert and upload if configured.


## Markdown Features

- Markdown‑It with `breaks: true` so a single newline becomes `<br>`.
- KaTeX for inline/block math; tuned to avoid overlap in WYSIWYG view.
- Mermaid diagrams via fenced blocks ```mermaid.
- Safe rendering via DOMPurify, with essential SVG/Math tags allowed.


## Image Upload (S3/R2)

- Configure your S3/R2 credentials (see code under `src/uploader/s3.ts`).
- Paste an image or drag/drop to insert. While uploading, a placeholder is shown and then replaced with the final URL.


## Known Behaviors

- In WYSIWYG mode, unclosed ```/~~~ fences and unclosed math blocks are intentionally not rendered until closed, to avoid obstructing input.
- When an inline `$...$` math is closed, the editor automatically inserts extra newlines to prevent visual overlap with following text.


## Shortcuts

- `Ctrl+N` New  •  `Ctrl+O` Open  •  `Ctrl+S` Save  •  `Ctrl+Shift+S` Save As
- `Ctrl+E` Edit/Preview  •  `Ctrl+Shift+E` WYSIWYG overlay
- `Ctrl+B` Bold  •  `Ctrl+I` Italic  •  `Ctrl+K` Insert Link
- `Esc` Close Preview / dialogs


## Changelog (v0.0.7)

- Library: improved file support and filters (md/markdown/txt/PDF); better UX for open/rename/move/delete.
- File operations: add Trash integration and force remove APIs to improve safety and recovery.
- Mermaid: add caching of rendered SVG to reduce flicker and speed up repeated renders.
- Stability and performance improvements.


## License

Apache-2.0. See `LICENSE`.


## Acknowledgements

- Tauri  •  Markdown‑It  •  DOMPurify  •  highlight.js  •  KaTeX  •  Mermaid
