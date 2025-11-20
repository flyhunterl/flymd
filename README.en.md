# FlySpeed Markdown (flyMD)

[简体中文](README.md) | [English](README.en.md)

[![Version](https://img.shields.io/badge/version-v0.3.6-blue.svg)](https://github.com/flyhunterl/flymd)
[![License](https://img.shields.io/badge/license-NonCommercial-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)](https://github.com/flyhunterl/flymd)
![GitHub Downloads](https://img.shields.io/github/downloads/flyhunterl/flymd/total)

A cross-platform WYSIWYG Markdown editor and PDF reader with image hosting, WebDAV sync, plugin extensions, fast response, and minimal resource usage.

![app-hero](https://github.com/user-attachments/assets/38f9f007-8a09-4231-9c53-2d3bc6f245be)


## ✨ Highlights

- Ready to Use: Only 7MB installer, no bloat. Millisecond-level cold start, one-click code copy
- Clean Interface: Minimalist design with just menubar + editor, focused on content creation. Excellent startup and response speed
- Library Feature: Support for designated folders, tree-view display of subfolders and documents, with document management; supports multiple libraries
- Secure & Reliable: Local execution, no network connection, automatic HTML sanitization in preview
- Image Hosting: S3/R2 binding support, direct paste image upload with automatic link syntax generation
- Full-Featured: Complete support for Markdown, LaTeX, Mermaid, and HTML
- Real-time Rendering: WYSIWYG mode, instant render on input! Global real-time rendering for Mermaid and LaTeX, double-click to edit code
- Ultimate Performance: Millisecond-level response, farewell to common pain points of similar software
- Position Memory: Automatic memory of reading and editing positions, returning to remembered positions on next open (v0.0.6 official)
- Auto Sync: WebDAV sync functionality
- Plugin Extensions: Support for plugin extensions, develop your own or install with one click
- AI Assistant: Install from the Extensions market to polish, correct and summarize content
- Export formats: Export to PDF, DOCX, WPS
- Todo Reminder Extension: Install from the Extensions market to push unfinished TODOs at scheduled times via WeChat, SMS, or email to designated recipients
## 📸 Interface Preview (v0.2.2)
<p align="center">
  <img src="https://github.com/user-attachments/assets/661c3263-d877-4fcf-a77f-69096b42b9d5" width="32%" alt="Markdown Editor Screenshot 1"/>
  <img src="https://github.com/user-attachments/assets/1182c443-f93c-4167-bc05-f4cc4b391ab5" width="32%" alt="Markdown Editor Screenshot 2"/>
  <img src="https://github.com/user-attachments/assets/d51945f9-c227-43eb-8105-0bb07d66db52" width="32%" alt="Markdown Editor Screenshot 3"/>
</p>


## Core Features
- Editing Experience
  - Instant editing/WYSIWYG (powered by Milkdown)
  - Native low-latency: Preserves `<textarea>` pipeline, IME composition-friendly, smart bracket/quote pairing without disrupting input (Edit mode)
  - Unified indent & multi-line operations: `Tab` behaves consistently in Edit/WYSIWYG modes
  - Common formatting: `Ctrl+B` bold, `Ctrl+I` italic, `Ctrl+K` insert link; precise line/column/cursor feedback
  - Edit/reading width control: Hold `Shift` and scroll the mouse wheel to adjust edit/reading area width, making long-form reading more comfortable
  - WYSIWYG mode: Use `Ctrl+Enter` to exit code blocks
  **Edit mode uses standard syntax, double space + Enter triggers line break. Non-standard syntax will break line breaks in WYSIWYG mode. Reading mode unaffected**
  **Auto-completion only works in Edit mode**
  **Due to Chinese/English punctuation differences, Chinese IME may affect completion experience, recommend switching to English punctuation**
- Reading & Outline
  - Safe preview: `markdown-it` rendering + `highlight.js` code highlighting + `DOMPurify` HTML sanitization, external links auto-add `target="_blank"` + `rel="noopener"`
  - Outline navigation: Extract Markdown `H1–H6` to generate clickable TOC, highlight current heading, preview and scroll sync
  - PDF Bookmarks (Outline): Built-in PDF reading and bookmark outline, cached per file and auto-invalidated on changes
- iframe Embedding Support
  - Flexible embedding: Embed iframe controls in Markdown to include videos, maps, online documents, and other external web content
  - Simple syntax: Use HTML `<iframe>` tags directly with customizable width, height, and other attributes
  - Usage examples:
    ```html
    <!-- Embed YouTube video -->
    <iframe width="560" height="315"
      src="https://www.youtube.com/embed/VIDEO_ID"
      frameborder="0" allowfullscreen>
    </iframe>

    <!-- Embed online document -->
    <iframe width="100%" height="500"
      src="https://example.com/document"
      frameborder="0">
    </iframe>

    <!-- Embed map -->
    <iframe width="600" height="450"
      src="https://www.openstreetmap.org/export/embed.html"
      frameborder="0">
    </iframe>
    ```
- Images & Hosting
  - One-step process: Paste/drag images auto-handled; prefer upload to S3/R2 and insert public URL; fallback to local save when unconfigured/failed
  - Local images just work: No extra configuration needed for preview
- Sync (WebDAV Extension)
  - Visual sync: Status hints, process logs, progress feedback, and conflict prompts
  - Remote MOVE optimization: Use `MOVE` to reduce duplicate download/upload, optimize rename/move scenarios
- Language & Usability
  - Bilingual (Chinese/English) + Auto: Follow system language or manual switch, remembers user choice
  - Position memory: Each file independently remembers last "reading/editing cursor/scroll position"
- Security & Performance
  - Local-first, zero background network: No network access unless explicitly enabled (image hosting, sync, etc.)
  - Performance optimization: Cold start and render pipeline with lazy loading, chunked static assets, controllable logs; target cold start <300ms, preview toggle <16ms (typical 2–3k line documents)

## Getting Started
- Installation
  - Download platform-appropriate installer from release page and install; Windows requires WebView2 (pre-installed on most systems)
- Create/Open
  - New: `Ctrl+N`; Open: `Ctrl+O`; Save: `Ctrl+S`; Save As: `Ctrl+Shift+S`
  - Library: Sidebar file tree supports new/rename/move/delete and recent files
- Mode Switching
  - Edit mode: `Ctrl+E`; can toggle between editing and reading
  - Quick reading: `Ctrl+R`
  - WYSIWYG mode: `Ctrl+W`; can toggle WYSIWYG editing
- Common Editing
  - Bold/Italic/Link: `Ctrl+B / Ctrl+I / Ctrl+K`; `Esc` closes dialogs
  - Images: Paste/drag to insert (WYSIWYG mode doesn't support dragging); with S3/R2 configured, auto-upload and insert URL; unconfigured/failed fallback to local save. Optional: Always save to local
- Sync (Optional)
  - Enable WebDAV in "Extensions", provides logs/progress/conflict hints; (newly launched, still improving, remember to backup)
- Language
  - Switch between Chinese/English or select Auto to follow system; language preference is remembered

- Export: Save As (Ctrl+Shift+S) supports PDF, DOCX and WPS
## ⌨️ Shortcuts

| Shortcut | Function |
|----------|----------|
| `Ctrl+N` | New file |
| `Ctrl+O` | Open file |
| `Ctrl+S` | Save file |
| `Ctrl+H` | Find & Replace |
| `Ctrl+Shift+S` | Save as |
| `Ctrl+E` | Toggle edit/preview |
| `Ctrl+R` | Enter reading (preview) |
| `Ctrl+W` | Toggle WYSIWYG mode |
| `Escape` | Close/return in preview or dialogs |
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+K` | Insert link |

## 🔌 Extension Development

flyMD supports plugin extensions to enhance functionality. You can:

- Develop custom extension plugins
- Install plugins from GitHub or HTTP URL
- Manage installed extensions

For detailed development guide, see: [Extension Development Documentation](plugin.md)

**Example Plugins:**
- [Typecho Publisher](https://github.com/TGU-HansJack/typecho-publisher-flymd) - Publish articles to Typecho blog platform
- Todo Reminder Extension - Push unfinished TODOs at scheduled times via WeChat, SMS, or email to designated recipients


## 📊 Performance Targets

- Cold start: ≤ 300ms
- Installer size: ≤ 10MB
- Memory footprint: ≤ 50MB
- Preview toggle: ≤ 16ms

## Roadmap & Changelog

See: [ROADMAP.en.md](ROADMAP.en.md)

### Cross-platform Support
- [x] Windows 10/11
- [x] Linux (Desktop environment)
- [x] macOS


## 🤝 Contributing

Issues and Pull Requests are welcome!

## 📄 License & Compliance

- This project uses "FlySpeed MarkDown (flyMD) Non-Commercial Open Source License (NC 1.0)".
- Allowed: Free use, modification, copying, and redistribution for non-commercial purposes; must retain attribution and source.
- Commercial use: Prohibited without written authorization. For commercial licensing, contact: flyhunterl <flyhunterl@gmail.com>.
- Full license: [LICENSE](LICENSE) (includes English translation, Chinese version is primary)
- Third-party component licenses: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

## 🙏 Acknowledgments
- [MilkDown](https://milkdown.dev/)
- [Tauri](https://tauri.app/)
- [markdown-it](https://github.com/markdown-it/markdown-it)
- [DOMPurify](https://github.com/cure53/DOMPurify)
- [highlight.js](https://highlightjs.org/)
- [KaTeX](https://katex.org/)
- [Mermaid](https://mermaid.js.org/)

## FAQ (Linux)

- [Solution for blank screen on Arch](arch.md)


<img width="300" height="300" alt="image" src="https://github.com/user-attachments/assets/4a716fd5-dc61-4a4f-b968-91626debe8d2" />

