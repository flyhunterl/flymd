# 飞速MarkDown【flyMD】

> 一款多平台的极致简洁即开即用的 Markdown 文档编辑预览工具

[![Version](https://img.shields.io/badge/version-0.1.3-blue.svg)](https://github.com/flyhunterl/flymd)
[![License](https://img.shields.io/badge/license-Apache%202.0-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey.svg)](https://github.com/flyhunterl/flymd)



## ✨ 项目定位

flyMD 是一款追求**极致速度与简洁体验**的 Markdown 编辑器，目标是提供媲美 Windows 记事本的启动速度和操作流畅度，同时支持实时 Markdown 预览。

设计理念：
- 即开即用：冷启动直达编辑区，无启动画面/欢迎页 极速启动
- 界面干净：极简界面，默认仅菜单栏+编辑区，专注内容创作
- 文库功能：支持指定文件夹，树状目录显示文件夹下子文件夹及文档
- 安全可靠：本地运行，无网络连接，预览 HTML 自动消毒
- 图床支持：支持S3/R2绑定，直接粘贴图片上传

## 📸 界面预览

<div style="display: flex; justify-content: center; flex-wrap: wrap; gap: 10px;">
  <img width="450" alt="image" src="https://github.com/user-attachments/assets/2aed5cf6-344e-4b3c-a88d-d1dd0b4154fb" />
  <img width="450" alt="image" src="https://github.com/user-attachments/assets/c738d2df-b363-4ce8-98b1-b738a3474ade" />
</div>

*界面风格类似 Windows 记事本，采用纯文本菜单栏设计*

## 🎯 核心特性（v0.1.3）

### 📝 编辑
- 原生 `<textarea>` 编辑器，零延迟输入响应
- 自动焦点到编辑区，启动即可输入
- 实时显示光标位置（行号、列号）
- UTF-8 编码，正确处理中文与特殊字符
- 文本格式化：`Ctrl+B` 加粗、`Ctrl+I` 斜体
- 插入链接：`Ctrl+K` 打开自定义弹窗（文本/URL），支持 ESC/按钮/遮罩关闭

### 👁️ 预览
- `Ctrl+E` 一键切换编辑/预览模式
- 基于 `markdown-it` 的高质量渲染
- `highlight.js` 代码高亮（按需加载）
- `DOMPurify` HTML 安全消毒，放行必要的 SVG 标签/属性
- 外链自动添加 `target="_blank"` 和 `rel="noopener noreferrer"`
- 本地图片路径自动转换为 `asset:`，Tauri 中本地图片可正常显示
- KaTeX（LaTeX 公式）与 Mermaid（流程/时序图等）

### 💾 文件
- 打开 (`Ctrl+O`)：支持 `.md`、`.markdown`、`.txt`
- 保存 (`Ctrl+S`)、另存为 (`Ctrl+Shift+S`)、新建 (`Ctrl+N`)
- 最近文件（最多 5 个）
- 未保存标记（标题栏 `*`）与统一原生确认对话框（关闭/打开/新建/拖拽覆盖）
- 拖拽：
  - Tauri：`tauri://drag-drop`；拖拽 `.md` 打开、拖拽图片自动插入 Markdown
  - 浏览器：拖拽 `.md` 在未保存时先确认；拖拽图片自动插入 data URL

### 🎨 界面体验
- Windows 记事本风格菜单栏
- 跟随系统主题（浅色/深色）
- 预览覆盖层设计，切换无闪烁
- 窗口状态持久化（尺寸、位置）
- “最近”面板、“关于”弹窗（含快捷键说明）

### 🛡️ 安全与稳定
- 全局错误捕获与日志记录（INFO/WARN/ERROR/DEBUG）
- 未处理 Promise 拒绝日志
- 路径归一化与跨平台兼容
- 日志优先写入 AppLog/AppLocalData，失败不影响应用
- 浏览器兼容模式（可在浏览器中测试 UI），Tauri API 优雅降级

### ⚡ 性能
- 高亮库按需加载，首次启动更快
- Markdown 渲染器延迟初始化
- 纯 TypeScript（无前端框架）
- 精简事件绑定避免泄漏

## 🚀 快速开始

### 环境要求

- Windows 10/11 (x64)
- WebView2 Runtime（Windows 10/11 通常已预装）
- 开发（可选）：Rust 1.70+、Node.js 18+、pnpm 或 npm

### 安装使用（推荐）

1. 前往 [Releases](https://github.com/flyhunterl/flymd/releases) 下载最新版本
2. 运行 `flymd_0.1.3_x64_setup.exe` 安装（文件名以实际发布为准）
3. 启动 flyMD，开始使用

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` | 新建文件 |
| `Ctrl+O` | 打开文件 |
| `Ctrl+S` | 保存文件 |
| `Ctrl+Shift+S` | 另存为 |
| `Ctrl+E` | 切换编辑/预览 |
| `Escape` | 预览或弹窗下关闭/返回 |
| `Ctrl+B` | 加粗 |
| `Ctrl+I` | 斜体 |
| `Ctrl+K` | 插入链接 |

## 目录结构

```
flymd/
├── src/                     # 前端源码
│   ├── main.ts             # 编辑、预览、文件/拖拽/对话框
│   ├── style.css           # 全局样式
│   └── index.html          # HTML 入口
├── src-tauri/              # Tauri 后端（v2）
│   ├── src/
│   │   └── main.rs         # Rust 主进程（dialog/fs/store/window-state/single-instance）
│   ├── tauri.conf.json     # Tauri 配置（含 dialog:allow-ask 权限）
│   ├── Cargo.toml
│   └── build.rs
├── package.json            # 依赖与脚本
├── vite.config.ts          # Vite 配置
└── README.md               # 项目说明
```

## 📊 性能指标（目标）

- 冷启动：≤ 300ms
- 安装包体积：≤ 10MB
- 常驻内存：≤ 50MB
- 预览切换：≤ 16ms

## 🗺️ 路线图


## 更新 v0.1.3

- 新增：库功能 在侧栏显示库里所有文档
- 新增：剪切板图片直接粘贴
- 修复: 本图片不能渲染的问题
- 修复：连接无法跳转的问题


## 更新 v0.1.2

本次版本聚焦稳定性与细节体验优化，主要改动：

- 统一确认对话框为 Tauri 原生 `ask`（打开/新建/拖拽打开/关闭），
- 修复 未保存直接关闭不提示 的问题：
- 修复 插入链接弹窗两个输入框在部分尺寸下溢出的视觉问题
- 增强 文档拖拽体验：
- 增强 预览安全/显示：
- 增强 Mermaid 渲染流程与错误提示；代码高亮按需加载


## 更新 v0.1.1

- 新增 LaTeX（基于 KaTeX）渲染支持
- 新增 Mermaid 流程图/时序图等渲染支持
- 新增快捷键：Ctrl+B 加粗、Ctrl+I 斜体、Ctrl+K 插入链接


### 跨平台支持
- [x] Windows 10/11
- [x] Linux（桌面环境）

### 计划中
- [ ] Typecho 发布（XML-RPC）：一键发布/更新文章到 Typecho，支持草稿/发布、分类与标签
- [ ] 图片直传（R2）：对接 Cloudflare R2（S3 兼容），支持拖拽/粘贴上传并自动替换为外链，提供鉴权配置与体积压缩

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

本项目采用 Apache 2.0 许可证，详见 [LICENSE](LICENSE)。

## 🙏 致谢

- [Tauri](https://tauri.app/)
- [markdown-it](https://github.com/markdown-it/markdown-it)
- [DOMPurify](https://github.com/cure53/DOMPurify)
- [highlight.js](https://highlightjs.org/)
- [KaTeX](https://katex.org/)
- [Mermaid](https://mermaid.js.org/)

## 常见问题 (Linux)

- [Arch 遇到程序打开空白的解决方法](arch.md)
