# 飞速MarkDown【flyMD】

> 一款多平台的极致简洁即开即用的 Markdown 文档编辑预览工具

[![Version](https://img.shields.io/badge/version-0.1.1-blue.svg)](https://github.com/flyhunterl/flymd)
[![License](https://img.shields.io/badge/license-Apache%202.0-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey.svg)](https://github.com/flyhunterl/flymd)

## 更新 v0.1.1

- 新增 LaTeX（基于 KaTeX）渲染支持
- 新增 Mermaid 流程图/时序图等渲染支持
- 新增快捷键：Ctrl+B 加粗、Ctrl+I 斜体、Ctrl+K 插入链接

## ✨ 项目定位

flyMD 是一款追求**极致速度与简洁体验**的 Markdown 编辑器，目标是提供媲美 Windows 记事本的启动速度和操作流畅度，同时支持实时 Markdown 预览。

**设计理念**：
- 🚀 **即开即用** - 冷启动直达编辑区，无启动画面，无欢迎页
- 🎯 **零干扰** - 极简界面，默认仅菜单栏+编辑区，专注内容创作
- ⚡ **极速切换** - `Ctrl+E` 瞬间切换编辑/预览，无白屏与闪烁
- 🪶 **轻量小巧** - 安装包 ≤10MB，常驻内存 ≤50MB
- 🔒 **安全可靠** - 本地运行，无网络连接，预览 HTML 自动消毒

## 📸 界面预览

<div style="display: flex; justify-content: center; flex-wrap: wrap; gap: 10px;">
  <img width="450" alt="image" src="https://github.com/user-attachments/assets/2aed5cf6-344e-4b3c-a88d-d1dd0b4154fb" />
  <img width="450" alt="image" src="https://github.com/user-attachments/assets/c738d2df-b363-4ce8-98b1-b738a3474ade" />
</div>

*界面风格类似 Windows 记事本，采用纯文本菜单栏设计*

## 🎯 核心特性

### 已实现功能 (v0.1.0)

#### 📝 编辑功能
- ✅ 原生 `<textarea>` 编辑器，零延迟输入响应
- ✅ 自动焦点到编辑区，启动即可输入
- ✅ 实时显示光标位置（行号、列号）
- ✅ UTF-8 编码支持，正确处理中文与特殊字符

#### 👁️ 预览功能
- ✅ `Ctrl+E` 一键切换编辑/预览模式
- ✅ 基于 `markdown-it` 的高质量渲染
- ✅ `highlight.js` 代码高亮支持（按需加载）
- ✅ `DOMPurify` HTML 安全消毒，防止 XSS 攻击
- ✅ 外部链接自动添加 `target="_blank"` 和 `rel="noopener noreferrer"`
- ✅ 支持 Markdown 标准语法（标题、列表、代码块、表格等）

#### 💾 文件操作
- ✅ 打开文件 (`Ctrl+O`) - 支持 `.md`、`.markdown`、`.txt`
- ✅ 保存文件 (`Ctrl+S`)
- ✅ 另存为 (`Ctrl+Shift+S`)
- ✅ 新建文件 (`Ctrl+N`)
- ✅ 最近文件列表（最多显示 5 个）
- ✅ 未保存提示（标题栏显示 `*` 标记）
- ✅ 关闭前确认（未保存时弹出提示）

#### 🎨 界面与体验
- ✅ Windows 记事本风格菜单栏
- ✅ 自动跟随系统主题（浅色/深色）
- ✅ 预览模式覆盖层设计，切换无闪烁
- ✅ 窗口状态持久化（尺寸、位置）
- ✅ 响应式布局，支持窗口缩放

#### 🛡️ 安全与稳定
- ✅ 全局错误捕获与日志记录
- ✅ 详细的操作日志（INFO/WARN/ERROR/DEBUG）
- ✅ 浏览器兼容模式（可在浏览器中测试 UI）
- ✅ Tauri API 容错处理，优雅降级
- ✅ 本地文件访问，无网络连接

#### ⚡ 性能优化
- ✅ 按需加载高亮库，首次启动更快
- ✅ Markdown 渲染器延迟初始化
- ✅ 零依赖前端框架，纯 Vanilla TypeScript
- ✅ 优化的事件绑定，避免内存泄漏

## 🚀 快速开始

### 环境要求

- **Windows**: Windows 10/11 (x64)
- **运行库**: WebView2 Runtime（Windows 10/11 通常已预装）
- **开发环境**（仅开发者需要）：
  - Rust 1.70+
  - Node.js 18+
  - pnpm 或 npm

### 安装使用

#### 下载安装包（推荐）

1. 前往 [Releases](https://github.com/flyhunterl/flymd/releases) 下载最新版本
2. 运行 `flymd_0.1.1_x64_setup.exe` 安装
3. 启动 flyMD，开始使用



## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` | 新建文件 |
| `Ctrl+O` | 打开文件 |
| `Ctrl+S` | 保存文件 |
| `Ctrl+Shift+S` | 另存为 |
| `Ctrl+E` | 切换编辑/预览模式 |
| `Escape` | 预览模式下返回编辑 |
| `Ctrl+B` | 加粗 |
| `Ctrl+I` | 斜体 |
| `Ctrl+K` | 插入链接 |

## 📊 性能指标

- 冷启动：≤ 300ms
- 安装包体积：≤ 10MB
- 常驻内存：≤ 50MB
- 预览切换：≤ 16ms


### 项目结构

```
flymd/
├── src/                    # 前端源码
│   ├── main.ts            # 核心逻辑（编辑、预览、文件操作）
│   ├── style.css          # 全局样式
│   └── index.html         # HTML 入口
├── src-tauri/             # Tauri 后端
│   ├── src/
│   │   └── main.rs        # Rust 主进程
│   ├── tauri.conf.json    # Tauri 配置
│   └── build.rs           # 构建脚本
├── assets/                # 应用资源
│   └── icon.ico           # 应用图标
├── plan.md                # 项目方案文档
└── package.json           # 依赖管理
```

## 🗺️ 路线图

### v0.1.1 (当前版本) ✅
- [x] 基础编辑与预览
- [x] 文件打开/保存/另存为
- [x] 快捷键支持
- [x] 最近文件列表
- [x] 主题跟随系统
- [x] 全局错误日志
- [x] 拖拽文件打开


### 跨平台支持
- [x] Windows 10/11
- [x] Linux (桌面环境)


## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！



## 📄 许可证

本项目采用 Apache 2.0 许可证，详见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

- [Tauri](https://tauri.app/) - 构建轻量级桌面应用的利器
- [markdown-it](https://github.com/markdown-it/markdown-it) - 快速且可扩展的 Markdown 解析器
- [DOMPurify](https://github.com/cure53/DOMPurify) - 强大的 HTML 消毒库
- [highlight.js](https://highlightjs.org/) - 语法高亮支持


<img width="300" height="300" alt="image" src="https://github.com/user-attachments/assets/4a716fd5-dc61-4a4f-b968-91626debe8d2" />

## 常见问题 (Linux)
- [Arch 遇到程序打开空白的解决方法](arch.md)
