<p align="center">
  <a href="https://github.com/flyhunterl/flymd/releases/latest"><img src="https://img.shields.io/github/v/release/flyhunterl/flymd" alt="GitHub Release" /></a>
  <a href="https://github.com/flyhunterl/flymd/releases/latest"><img src="https://img.shields.io/github/release-date/flyhunterl/flymd" alt="Release Date" /></a>
  <a href="https://github.com/flyhunterl/flymd/actions/workflows/build.yml"><img src="https://github.com/flyhunterl/flymd/actions/workflows/build.yml/badge.svg" alt="Build Status" /></a>
  <a href="https://github.com/flyhunterl/flymd/stargazers"><img src="https://img.shields.io/github/stars/flyhunterl/flymd" alt="GitHub Stars" /></a>
  <img src="https://img.shields.io/github/downloads/flyhunterl/flymd/total" alt="GitHub Downloads" />
</p>

<p align="center">
  <a href="README.md">简体中文</a> | <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-green" alt="License: GPL-3.0" /></a>
  <a href="https://github.com/flyhunterl/flymd"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg" alt="Platform" /></a>
  <a href="https://github.com/microsoft/winget-pkgs/tree/master/manifests/f/flyhunterl/FlyMD"><img src="https://img.shields.io/badge/winget-flyhunterl.FlyMD-blue" alt="Winget" /></a>
  <a href="https://t.me/+3SOMbwSbCvIxMGQ9"><img src="https://img.shields.io/badge/Telegram-Join-blue?logo=telegram&logoColor=white" alt="Telegram Community" /></a>
</p>

---

## Introduction

FlyMD is a lightweight, high-performance local Markdown editor supporting high-precision PDF parsing, AI-assisted writing, and intelligent todo reminders. Local-first, secure data control, ready to use out of the box.

<img width="1920" height="1080" alt="hero" src="https://github.com/user-attachments/assets/acf758c1-6c8e-4b4f-a313-d4ce2190394b" />

<p align="center">
  <a href="https://github.com/flyhunterl/flymd/releases/latest">Download Desktop (Windows / macOS / Linux)</a>
  ·
  <a href="https://github.com/flyhunterl/flymd/releases?q=android&expanded=true">Download Android (Beta)</a>
</p>

## Table of Contents

- [Core Features](#core-features)
- [Feature Demonstrations](#feature-demonstrations)
- [PDF High-Precision Parsing (Plugin)](#pdf-high-precision-parsing-plugin)
- [AI Novel Engine (Plugin)](#ai-novel-engine-plugin)
- [Android Version (Beta)](#android-version-beta)
- [Getting Started](#getting-started)
- [Extension Development](#extension-development)
- [Performance & Technology](#performance--technology)
- [Community & Support](#community--support)
- [Other Information](#other-information)

---

## Core Features

### Editing Experience

- **Source Code / WYSIWYG Dual Mode** - Switch freely between modes, source mode supports split view
- **Millisecond-Level Startup & Rendering** - DOM ready in just 5ms, tested with 80,000-word documents without lag
- **Smart Outline Navigation** - TOC/outline supports left/right switching, quick navigation for long documents

### Advanced Features

- **AI Assistant** - Writing assistance, polishing, and error correction with Markdown rendering and code highlighting, built-in free AI models ready to use
- **Full-text / Knowledge-base Search** - Library sidebar quick search supports `:keyword` full-text search and `::keyword` semantic search (requires a flymd-RAG index)
- **Smart Todo Reminder** - Auto-detect TODOs, push via WeChat, SMS, Email, DingTalk, Feishu, and more
- **High-Precision PDF/Image Parsing** - Parse to MD or Docx format, supports translation
- **One-Click Publish** - Supports Typecho / WordPress / Halo blog platforms
- **Collaborative Editing** - Multi-user real-time collaboration via extension plugin (requires "Collaborative Editing" extension, contact QQ Group 343638913 for details)
- **Git Version Control** - Document integration with Git, supports status query, history view, and explicit commits
- **iframe Embedding** - Supports embedding music, videos, maps, online documents, etc.
- **Selection-Aware AI** - Right-click menu shortcuts work on selected text only
- **Tabs & Sticky Notes Toolkit** - Tab right-click menu supports opening in new instance, renaming files, one-click desktop sticky notes

> 💡 The AI Assistant extension installs silently on first launch. If you uninstall it, it won't auto-install again.
>
> ⚠️ Built-in AI models are designed to lower the barrier to AI adoption. This app has strict rate limits on built-in models—please do not abuse. [Register a SiliconFlow account](https://cloud.siliconflow.cn/i/X96CT74a) to unlock more powerful models and higher quotas.

### Platform & Format

- **Cross-Platform** - Windows / Linux / macOS
- **Multi-Format Export** - PDF / DOCX (PDF export optimized for pagination line breaks; "Print" can be used as a fallback in extreme cases)
- **Portable Mode** - All config in app root directory, ideal for USB drives

> [!WARNING]
> **Linux (Arch-based) note**
> - On Arch / Manjaro and other Arch-based distributions, the AppImage build may show a blank window due to WebKitGTK or GPU driver issues.
> - Prefer installing via the AUR package `flymd` (for example: `yay -S flymd`).
>
> The legacy `deb` → `debtap` / PKGBUILD to pacman conversion workflow is no longer recommended.
>

### Data Security

- **Local-First** - Zero background network, secure and controllable data
- **Image Hosting** - S3/R2/Lsky Cloud/Third-party hosting (via plugins) one-click upload, auto-insert image links, supports right-click upload for specific images
- **WebDAV Sync** - Multi-device, multi-library sync with end-to-end encryption and HTTP host whitelist
- **Extension System** - Custom extensions, unlimited possibilities

---

## Feature Demonstrations

### Date-Based Todo Summary

**Generate todos from meeting notes / travel plans / personal notes, push reminders by time and assignee (WeChat/SMS/DingTalk/Feishu, etc.), and summarize todos by day/week/month with built-in templates for diaries and meeting minutes.**

<img width="1065" height="726" alt="Date-based todo summary and reminders" src="https://github.com/user-attachments/assets/dd82577d-eebf-415b-bcd3-96dc3e23ac7e" />

### AI Dialogue Integration + Desktop Sticky Notes

**Ten Color Options · Customizable Transparency · Interactive Visual Controls**

<img src="https://github.com/user-attachments/assets/016617fa-1971-4711-8c5e-1398a1b0aa52" alt="AI Dialogue Integration and Sticky Notes" width="800">

---

## PDF High-Precision Parsing (Plugin)

**Example of the High-Precision Parsing plugin; a MinerU-based parsing plugin is also available depending on your needs.**

<img width="1074" height="765" alt="PDF High-Precision Parsing" src="https://github.com/user-attachments/assets/9d9a845f-e75a-4ad3-a7bb-274017f64165" />

<img src="https://github.com/user-attachments/assets/2a512b4b-7083-41d9-9b84-f9b411b849f1" alt="PDF High-Precision Parsing and Translation" width="800">

---

## AI Novel Engine (Plugin)

✅ Auto-generate at least 3 plot directions

✅ Smart foreshadowing callback + automatic audit

✅ Automatic progress updates, multi-level concurrent retrieval

✅ Character state management, chapter word count, draft review, clear structure

✅ Support for multi-model collaboration & compatible with Git version control plugin

✅ Unique backend Agent tool for segmented management, rigorous logic

<img width="970" height="710" alt="AI Novel Engine" src="https://github.com/user-attachments/assets/005545ee-6377-4f5a-9ae8-e21f7f3330d9" />

---

## Android Version (Beta)

**Adapted Plugins**
- WebDAV Sync
- RAG Knowledge Base
- Todo Push
- Todo Diary (Diary/Todo)
- Typecho Management
- AI Assistant

### Voice-to-Text / Voice Input

<img src="https://github.com/user-attachments/assets/815d5bc2-d367-451a-bfa5-f54f5cc91c5a" alt="Voice-to-text demo" width="400">

---

## Getting Started

### Installation

Download from [Releases](https://github.com/flyhunterl/flymd/releases):

| Platform | Installation |
|----------|--------------|
| **Windows** | `winget install flyhunterl.FlyMD` or download installer |
| **Linux** | Supports mainstream desktop environments; on Arch-based distributions, we recommend installing via the AUR package `flymd` (for example: `yay -S flymd` or `paru -S flymd`). |
| **macOS** | Supports Intel and Apple Silicon |

<details>
<summary><strong>macOS Installation Notes</strong></summary>

Due to the app not being notarized by Apple, you may see a "damaged" warning on first launch.

**Method 1: Terminal Command (Recommended)**
```bash
sudo xattr -r -d com.apple.quarantine /Applications/flymd.app
```

**Method 2: System Settings**
1. Open Finder and locate the downloaded app
2. **Hold Control and click** the app icon, then select "Open"
3. Click "Open" in the dialog that appears

> ⚠️ FlyMD is open-source with fully transparent code. The "damaged" warning is only because we haven't paid for Apple's code signing.

</details>

### Core Operations

| Action | Shortcut | Action | Shortcut |
|--------|----------|--------|----------|
| New File | `Ctrl+N` | Toggle WYSIWYG | `Ctrl+W` |
| Open File | `Ctrl+O` | Toggle Edit/Preview | `Ctrl+E` |
| Save File | `Ctrl+S` | Focus Mode | `Ctrl+Shift+F` |
| New Tab | `Ctrl+T` | Find & Replace | `Ctrl+H` |
| Command Palette | `Ctrl+Shift+P` | Library Sidebar Search | Click the search button |

**Multi-Tab Operations**:
- `Ctrl+T` - Open blank tab
- `Ctrl+Tab` / `Ctrl+Shift+Tab` - Cycle through tabs
- `Ctrl + Click library document` - Open in new tab with source mode
- `Alt+W` - Close current tab

**Config & Migration**:
- Export/Import Config - One-click migration of full environment (extensions & settings)
- Portable Mode - All config in app root directory

**Images & Sync**:
- Paste/drag to auto-process images, supports S3/R2 image hosting upload
- WebDAV sync for multi-device, multi-library, supports end-to-end encryption

**Page Operations**:
- `Shift + Mouse Wheel` - Adjust content width (margins)
- `Ctrl + Mouse Wheel` - Enlarge text and images
- `Shift + Right Click` - Open native menu (when right-click menu is occupied by plugins)

**Library Sidebar Search**:
- Default: type to filter by filename/path
- Full-text: type `:keyword` and press Enter (you can continue with “Deep search”)
- Knowledge-base: type `::keyword` and press Enter (requires flymd-RAG enabled and indexed)

---

## Extension Development

FlyMD has a rich plugin ecosystem supporting unlimited functionality extension through plugins.

### Featured Plugins

**AI & Writing**:
- **AI Assistant** - Writing assistance, polishing and error correction with Markdown rendering and code highlighting, built-in free models ready to use
- **Xiaohongshu Copywriting Generator** - AI-powered Xiaohongshu-style copywriting with one-click polish, expansion and custom prompt templates

**Document Processing**:
- **High-Precision PDF Parsing** - Use LLM for high-precision PDF parsing to Markdown or Docx, supports handwriting, layout, formulas and tables
- **Markdown Table Assistant** - Quickly insert Markdown tables at the cursor to structure content efficiently

**Publishing & Reminders**:
- **Typecho Post Manager** - Pull blog post list from Typecho as local Markdown, filter by time/category, and allow local content to overwrite remote posts
- **xxtui Todo Push** - Scan incomplete todos in the current document and push them to WeChat, SMS, Email and other channels

**Knowledge Management**:
- **Backlinks (Bidirectional Links)** - Based on [[title]] syntax to build forward and reverse links between notes, with AI-powered related suggestions
- **Graph View** - Graph view based on backlinks index that centers on the current note and visualizes its local graph
- **RAG Knowledge Base Indexing (flymd-RAG)** - Builds vector indexes for local Markdown/TXT and provides semantic search and RAG-ready knowledge base support, integrated with the AI Assistant

> 👉 [View all extensions](https://flymd.llingfei.com/extensions.html)

### Install Extensions

- One-click install from extension marketplace
- Install community extensions from GitHub or HTTP URL
- Develop custom extensions for personalized needs

📚 **Documentation**: [扩展开发文档 (中文)](plugin.md) | [Extension Documentation (English)](plugin.en.md)

---

## Performance & Technology

### Performance Metrics

| Metric | Value |
|--------|-------|
| ⚡ Cold Start | ≤ 300ms |
| 📦 Installer Size | ≤ 10MB |
| 💾 Memory Footprint | ≤ 50MB |
| 🔄 Preview Toggle | ≤ 16ms |

### Technology Stack & Acknowledgments

**Core Technologies**:

| Project | Purpose |
|---------|---------|
| [Tauri](https://tauri.app/) | Cross-platform framework |
| [MilkDown](https://milkdown.dev/) | WYSIWYG editor |
| [markdown-it](https://github.com/markdown-it/markdown-it) | Markdown rendering |
| [DOMPurify](https://github.com/cure53/DOMPurify) | HTML sanitization |
| [highlight.js](https://highlightjs.org/) | Code highlighting |
| [KaTeX](https://katex.org/) | Math formula rendering |
| [Mermaid](https://mermaid.js.org/) | Diagram drawing |

**Ecosystem Partners**:

| Partner | Description | Support Type |
|---------|-------------|--------------|
| [SiliconFlow](https://cloud.siliconflow.cn/i/X96CT74a) | Leading AI capability provider | **Free Model Provider** |
| [XXTUI](https://www.xxtui.com/) | Simple and efficient personal push API | Push Service Support |
| [x666.me](https://x666.me/register?aff=yUSz) | Quality AI API support with care | Model Service Support |

**Thanks to SiliconFlow for providing free AI model support**:

<a href="https://cloud.siliconflow.cn/i/X96CT74a" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/plugins/ai-assistant/Powered-by-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="public/plugins/ai-assistant/Powered-by-light.png">
    <img alt="Powered by SiliconFlow" src="public/plugins/ai-assistant/Powered-by-light.png" width="200">
  </picture>
</a>

---

## Community & Support

### Join the Community

Stay connected for the latest updates, preview builds, and tips:

| Platform | Link |
|----------|------|
| QQ Group | 343638913 |
| Telegram | [t.me/+3SOMbwSbCvIxMGQ9](https://t.me/+3SOMbwSbCvIxMGQ9) |

### Community Developers

<table>
  <tr>
    <th>Developer</th>
    <th>Contribution</th>
  </tr>
  <tr>
    <td align="center">
      <a href="https://github.com/xf959211192">
        <img src="https://github.com/xf959211192.png" width="40" alt="xf959211192 avatar" /><br />
        <sub><b>xf959211192</b></sub>
      </a>
    </td>
    <td>Telegraph-Image image hosting uploader</td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://github.com/Vita0519">
        <img src="https://github.com/Vita0519.png" width="40" alt="Vita0519 avatar" /><br />
        <sub><b>Vita0519</b></sub>
      </a>
    </td>
    <td>Xiaohongshu copywriting generator AI extension</td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://github.com/Integral-Tech">
        <img src="https://github.com/Integral-Tech.png" width="40" alt="Integral-Tech avatar" /><br />
        <sub><b>Integral-Tech</b></sub>
      </a>
    </td>
    <td>Arch Linux AUR package maintainer</td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://github.com/qqxt">
        <img src="https://github.com/qqxt.png" width="40" alt="qqxt avatar" /><br />
        <sub><b>qqxt</b></sub>
      </a>
    </td>
    <td>Web image uploader</td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://github.com/afoovo">
        <img src="https://github.com/afoovo.png" width="40" alt="afoovo avatar" /><br />
        <sub><b>afoovo</b></sub>
      </a>
    </td>
    <td>Translate selected text plugin</td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://github.com/gerrampard">
        <img src="https://github.com/gerrampard.png" width="40" alt="gerrampard avatar" /><br />
        <sub><b>gerrampard</b></sub>
      </a>
    </td>
    <td>Dinox Sync (dinox-sync)</td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://github.com/ooopzlong">
        <img src="https://github.com/ooopzlong.png" width="40" alt="ooopzlong avatar" /><br />
        <sub><b>ooopzlong</b></sub>
      </a>
    </td>
    <td>File icon design</td>
  </tr>
</table>

### Contributing

Issues and Pull Requests are welcome!

---

## Other Information

### Roadmap

See: [ROADMAP (English)](ROADMAP.en.md)

### Star History

[![Star History Chart](https://star-history.dera.page/svg?repos=flyhunterl/flymd&type=date&legend=top-left)](https://star-history.dera.page/#flyhunterl/flymd&type=date&legend=top-left)

### License

This project is licensed under the [GNU General Public License v3.0 (GPL-3.0)](LICENSE).

- ✅ **Allowed**: Use, modify, copy, and redistribute for any purpose (including commercial), as long as you comply with GPL-3.0
- ❗ **Constraint**: If you distribute FlyMD or modified versions (whether paid or free), you must provide the corresponding source code and keep copyright and license notices

For proprietary/commercial use cases that are incompatible with GPL-3.0, contact: flyhunterl <flyhunterl@gmail.com>

Full License: [LICENSE](LICENSE) | Third-Party Components: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

### FAQ

<details>
<summary><strong>macOS says the app is "damaged" and won't open?</strong></summary>

Run: `sudo xattr -r -d com.apple.quarantine /Applications/flymd.app`, or hold Control and click the app then select "Open".

</details>

<details>
<summary><strong>Right-click menu taken over by a plugin?</strong></summary>

Press `Shift + Right Click` to open the native context menu.

</details>

<details>
<summary><strong>Need larger content or different margins?</strong></summary>

- `Shift + Mouse Wheel` to adjust content width (margins)
- `Ctrl + Mouse Wheel` to enlarge text and images

</details>

<details>
<summary><strong>Does WYSIWYG mode support todo lists?</strong></summary>

Not yet—`- [ ]` / `- [x]` checkboxes only work in source/preview modes for now.

</details>

---

## Open Source Support

These are stable model providers I personally use.

⭐⭐⭐[rightcode: Highly stable and cost-effective Claude and Codex relay service](https://www.right.codes/register?aff=E8E36524)





<img width="300" height="300" alt="image" src="https://github.com/user-attachments/assets/4a716fd5-dc61-4a4f-b968-91626debe8d2" />
