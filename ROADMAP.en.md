# Roadmap

[简体中文](ROADMAP.md) | [English](ROADMAP.en.md)

## Update v0.3.6
- Added: Built-in `xxtui todo push` extension to send todos from your document to xxtui in one click, with follow-up improvements to the todo menu UX and batched push behavior.
- Added: Extension runtime now exposes a right-click menu API, along with a demo extension that showcases multiple menu items, nested submenus, and custom icons.
- Added: Extension marketplace now lets you manually choose the install/update channel (GitHub or official site), with the other side automatically used as a fallback to stay robust under different network conditions.
- Added: Dropdown submenu API for extensions so plugins can build grouped menus and more complex action entries.
- Improved: Reworked the Edit mode padding and width control logic, aligning width tuning behavior between Edit and Reading modes so finding a comfortable reading width feels more natural.
- Fixed: Cleaning up extension-registered menus on uninstall to avoid stale or duplicated menu entries.

## Update v0.3.5
- Added: In Edit mode, pasting a URL with `Ctrl+V` now fetches the page `<title>` and expands it into a `[page title](https://...)` Markdown link, while `Ctrl+Shift+V` always pastes plain text.
- Fixed: When pasting from HTML sources, the editor no longer inserts both raw text and converted Markdown; `Ctrl+V` now only keeps the converted Markdown content.
- Added: In Reading mode, holding `Shift` and scrolling the mouse wheel adjusts the reading width, making long-form reading more comfortable.
- Added: Extension update indicators have been added to the notification area in the main window so you can spot available plugin updates at a glance.
- Improved: The AI assistant extension now supports docking on the right side with drag-to-snap behavior, along with several interaction and UX refinements.

## Update v0.3.4
- Improved: Optimized WebDAV sync strategy with new sync options and more robust handling when documents are deleted, moved, or renamed.
- Added: Custom library icons support, along with refreshed folder/library icon styles.
- Improved: Added an optional grid background for Edit mode and refined sidebar copy/layout to better fit multi-library scenarios.
- Improved: Smoother new-document flow so creating and entering the editor feels more seamless.
- Fixed: Rename dialog not refreshing when switching between Chinese and English, and completed the English version of the context menu.
- Improved: Simplified the hit-count display for Find / Find & Replace to keep focus on the most important numbers.

## Update v0.3.3
- Fixed: Manual WebDAV sync no longer gets skipped when the local tree appears unchanged, avoiding missed remote updates.
- Improved: Switching between Edit / Reading / WYSIWYG modes now preserves the scroll position so toggling modes no longer jumps around.
- Improved: Outline navigation and Find/Replace — added match counters with current/total display and fixed several cases where clicking an outline item or search result would not scroll accurately to the target in Edit or Reading mode.

## Update v0.3.2
- Fixed: PDF outline/bookmarks could become invalid; now exported and viewed PDFs retain correct table-of-contents navigation
- Improved: After WebDAV sync completes, the document library tree is proactively refreshed so you don't need to refresh manually
- Improved: AI assistant plugin sidebar now has a minimum width to avoid layout issues when dragged too narrow

## Update v0.3.1
- Improved: Greatly improved startup and rendering performance
> DOM ready: '16ms', first render: '262ms', app ready: '293ms', total: '293ms'
- Improved: WebDAV sync calculation and comparison logic; added concurrent upload/download/scan to greatly speed up synchronization
- Improved: Sync status is now displayed independently to avoid being interrupted by row/column status
- Added: Word count information has been added to the row/column status

## Update v0.3.0
- Improved Enhance window styles, add animation effects, and theme backgrounds



## Update v0.2.9
- Added Exposed `pickDocFiles`, `openFileByPath`, and `exportCurrentToPdf` interfaces for extensions to enrich their functionalities.
- Improved Added a fallback address to the extension marketplace to provide services for regions with GitHub connectivity issues.
- Improved Added connection status prompts to the extension marketplace.
---
Extension Update
Added Batch PDF Export Extension (Supported in v0.2.9)

## Update v0.2.8
- Added: Update checking and hot-reload support for extension plugins.
- Improved: Rendering logic of the extension marketplace.
- Improved: Removed obsolete dependencies and debug logging to optimize performance and reduce installer/bundle size.

## Update v0.2.7
- Added: Ctrl+H find & replace in WYSIWYG mode.
- Added: Replaced WebView's built-in "Find in page" with a unified JS search panel.
- Fixed: Ctrl+F match counter in Reading/Preview mode reporting double counts.
- Fixed: In Edit mode, cycling backwards in find & replace could lose the inverted selection highlight after wrapping to the first match.
- Fixed: KaTeX square roots sometimes not rendering in the preview layer, in SVG exports, or when saving as PDF.
- Improved: Auto-update download pipeline — added ghfast.top as an extra proxy prefix and tweaked some styles (including sidebar header z-index).
## Update v0.2.6
- Fixed: Missing LaTeX symbols in Reading mode rendering
- Improved: Mermaid is now supported when exporting to Word (DOCX/WPS)

## Update v0.2.5 
- Added: Mermaid zoom support in Reading/WYSIWYG modes
- Added: Export Mermaid as standalone SVG
- Improved: Handle array returns from open dialogs; fixes some macOS cases where files failed to load on open
- Improved: Register native macOS menu events to ensure the system menu also triggers the open flow

## Update v0.2.4
- Added: Editor/Plugin APIs to empower AI extensions (insert at cursor, streaming output, replace selection)
- Added: Plugin store sorting and "Featured" badge styling
- Added: Multiple libraries support
- Fixed: Extension buttons missing after restart due to not being registered on startup

## Update v0.2.3
- Added: Custom font support (Theme panel). Supports picking system fonts and installing user fonts for use in the app.
- Added: Zoom in/out via Ctrl/Cmd + mouse wheel in Edit, Reading and WYSIWYG modes.
- Fixed: Clicking File and Mode menus in succession sometimes failed to open their menu items.
- Fixed: macOS - Documents failed to load after application launch.
- Improved: Unified centered layout between Edit and Reading/WYSIWYG modes.

## Update v0.2.2
- Fixed: Theme-related CSS compatibility to better respect color variables across modes.
- Improved: Global icons/visual polish.



## Update v0.2.0
- Added: Theme and background color customization/extension API
- Added: Image hosting conversion & compression, with on/off switch and quality controls
- Fixed: macOS path escaping issue causing files not to load when opened (app launched but document not loaded)
- Improved: Added background color to Reading mode to visually distinguish it from Edit mode
- Improved: Image hosting uploads switched to WebP format to better suit network usage

## Update v0.1.9
- Added: Drag documents in the library to move between folders
- Added: In Chinese IME, typing two ￥/¥ in a row maps to $$ (edit mode only)
- Improved: Updater now includes changelog
- Improved: After auto-installation fails, provide an option to open the download directory for manual installation fallback

## Update v0.1.8
- Added: Save as PDF
- Added: Save as DOCX and WPS (Mermaid not supported)
- Fixed: Code block language label no longer overlaps code lines
- Improved: Removed unnecessary dependencies
- Improved: Better cache utilization for performance
- Improved: Split chunks to improve performance

## Update v0.1.7
- Improved: Changed mermaid in WYSIWYG mode to global rendering / double-click image to edit code
- Improved: Adjusted default mermaid scaling
- Fixed: Ctrl+Z couldn't undo replace content
- Fixed: * marker completion logic
- Fixed: Text display error in Ctrl+K hyperlink shortcut popup in WYSIWYG mode
- Added: Deletion marker ~~ completion. (Surround completion only works with English IME~)


## Update v0.1.6
- Fixed: Interface incorrectly displaying as edit when switching from Reading → WYSIWYG → back to "Reading" via "Mode" menu
- Fixed: Unsaved prompt when switching modes after only switching to WYSIWYG without editing (initialization/closing WYSIWYG V2 causing false dirty flag)
- Improved: WYSIWYG mode now supports undo/redo (Ctrl+Z / Ctrl+Y)
- Improved: Edit and indent modes support Tab paragraph indentation (simulates input &emsp;&emsp;)
- Optimized: Smooth animation transitions, improved font rendering. Added anti-aliasing and some CSS beautification
- Added: TODO list support, change status by mouse click (Reading mode only)
- Added: New Ctrl+H find & replace in Edit mode, added paired marker completion (auto/surround/skip/paired deletion)
  - Auto-completion: When typing left markers like `(`, `[`, `{`, `"`, `'`, `` ` ``, `*`, `_` in Edit mode, automatically insert right marker and place cursor between them. *May have compatibility issues with some Chinese IMEs*
  - Surround completion: When text is selected and a left marker is typed, automatically add paired markers before and after selected text, only adjusting selection for continued input. *May have compatibility issues with some Chinese IMEs*
  - Skip right: When typing a right marker, if the same marker already exists at cursor position, directly move cursor right to avoid duplication. *May have compatibility issues with some Chinese IMEs*
  - Paired deletion: Backspace between a pair of markers deletes both markers at once. *May have compatibility issues with some Chinese IMEs*

## Update v0.1.5
- Hidden mermaid rendering error prompts in WYSIWYG mode to avoid disrupting input experience
- Set icons for different formats in library/file list for distinction
- Added Markdown table of contents outline (WYSIWYG and Reading modes) and PDF bookmark table of contents
- Fixed issue where unselected library directory was still displayed after not selecting library
- Restored previously hidden scrollbars while maintaining elegant simplicity
- Tab display optimization (priority push, small changes, intuitive benefits)
>  Title displays file name; appends parent directory name for duplicate names; added unsaved indicator*; window title syncs to "filename - FlySpeed MarkDown", easier to distinguish in taskbar/switching; hover title shows full path


## Update v0.1.4
- Sync feature added library root snapshot for quick short-circuit, avoiding meaningless scanning and inability to sync empty directories
- Sync feature added directory snapshots to optimize remote scanning logic, greatly improving scanning speed
- Fixed incorrect rendering of LaTeX formula ² in Reading mode
- Changed LaTeX formulas in WYSIWYG mode to global rendering
- Fixed issue where closing program without saving document didn't prompt for save
- Fixed code block format abnormality in Reading mode
- Fixed Linux icon not displaying issue


## Update v0.1.3
- Refactor: Completely refactored WYSIWYG mode, now WYSIWYG V2 has better experience
> To ensure editing smoothness, LaTeX and Mermaid will display as source code, only rendering when cursor or mouse pointer is in code area. Inline formula $...$ doesn't inline render (for stable editing)
- Fixed: Supplied missing update address for macOS version
- Changed: More flexible (library) sidebar mode
- Changed: Changed single column to multi-level menu
- Added: Save reminder popup when switching documents
- Added: Reading mode shortcut Ctrl+R, WYSIWYG mode shortcut Ctrl+W



## Update v0.1.2
- Modified extension window and some extension styles
- Added sync logic options, enriched real-time log information
- Modified sync scanning logic to improve scanning speed
- Rewrote some sync logic, will ask whether to sync delete or download restore when encountering locally deleted files
- Document library added new/delete folder functionality
- Fixed issue where printing documents could only print visible range


## Update v0.1.1
- Added extension list hot update functionality

## Update v0.1.0-fix
- Temporarily removed deletion judgment in sync functionality, only doing incremental sync
- Greatly optimized hash algorithm in sync functionality
- Added sync log display and log recording
> Those who lost local files using version 0.1.0 sync can use this version to sync and restore. Sync functionality still not perfected, please don't use in production environment, backup data well

## Update v0.1.0
- Added: WebDAV sync extension using sync metadata management, content hash comparison, timestamp auxiliary judgment. **This release has been deleted, this version will cause local file loss**
> Sync functionality is in testing and adjustment stage, must backup data well. If issues arise, please submit ISSUE. First sync will be slower (calculating hash values)


## Update v.0.0.9-fix
- Added: Provide manual open method as fallback after download update startup failure
- Fixed: Unable to focus edit in WYSIWYG mode after uploading image

## Update v.0.0.9
- Added: Always save images to local. Default off
- Added: Convert to markdown format when copying rendered article to editor to ensure format not lost
- Added: Extension functionality, can now manage and install extensions. Author: [HansJack](https://github.com/TGU-HansJack)
- Adjusted: Moved new button to leftmost to conform to operation habits
- Optimized: Greatly optimized document library opening speed

## Update v.0.0.8-fix
- Fixed previous incorrect update link causing automatic download failure
- Added several backup proxy addresses to prevent update failure due to proxy failure


## Update v.0.0.8
- Fixed: Falling back to base64 when pasting images from clipboard without image hosting configured
- Added: When image hosting not configured, pasting clipboard images will write to local images directory
[Locally existing images will be read by path, not written to images directory]
[Pasting images in unsaved documents will go to system default pictures directory, falls back to base64 if fails]
**Default Priority**
  - Image hosting enabled and configured → direct upload and insert public URL (not saved locally)
  - Not enabled/not configured → go to local save branch [created document: same-level images; uncreated document: system pictures directory]
  - If image hosting enabled but upload fails → fall back to local save branch as fallback
  - Locally existing images will be read by path, not written to images directory


## Update v.0.0.7
- Added: Custom sorting for file library
- Added: File library hides files other than md/txt/pdf/markdown
- Added: Update detection and download functionality
- Optimized: Added cache for mermaid icons




## Update v0.0.6-fix
- Fixed: Unable to focus input box when editing to bottom in WYSIWYG mode
- Optimized: WYSIWYG mode scrolling logic
- Known: Text input after mermaid in viewport in WYSIWYG mode will cause interface flicker

## Update v0.0.6
- Added: Automatic memory of reading/editing positions, will automatically return to last exit position when reopening previously edited or read files
- Optimized: Modified WYSIWYG mode logic for handling LaTeX and mermaid, now WYSIWYG mode supports LaTeX and mermaid
- Optimized: Shortened line spacing in code areas and other display effect optimizations

## Update v0.0.6-beta
- Added: WYSIWYG mode (currently doesn't support LaTeX and mermaid, recommend switching back to normal mode when inputting latex and mermaid)


## Update v0.0.5

- Added: PDF preview support
- Added: PDF suffix association
- Optimized: First screen opening speed


## Update v0.0.4

- Added: Document library new/rename/delete/move operations
- Added: Image hosting one-click toggle for easy switching to local mode
- Refactored: Redesigned UI, added library icon
- **Enabled new version number, old version installations need uninstall and reinstall (data not lost)**

## Update v0.0.3

- Added: Library feature, displays all documents in library in sidebar
- Added: Direct clipboard image paste
- Fixed: Local images cannot render issue
- Fixed: Links cannot jump issue


## Update v0.0.2

This version focuses on stability and detail experience optimization, main changes:

- Unified confirmation dialogs to Tauri native `ask` (open/new/drag open/close)
- Fixed: Issue where no prompt when closing without saving
- Fixed: Visual overflow of two input boxes in insert link popup at certain sizes
- Enhanced: Document drag experience
- Enhanced: Preview security/display
- Enhanced: Mermaid rendering process and error prompts; code highlighting lazy loaded


## Update v0.0.1

- Added: LaTeX (based on KaTeX) rendering support
- Added: Mermaid flowchart/sequence diagram etc. rendering support
- Added shortcuts: Ctrl+B bold, Ctrl+I italic, Ctrl+K insert link

