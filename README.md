# 飞速MarkDown【flyMD】


> 多平台支持  专注写作 极致性能 即开即用 所见即所得

[简体中文](README.md) | [English](README.en.md)

[![Version](https://img.shields.io/badge/version-v0.0.9-blue.svg)](https://github.com/flyhunterl/flymd)
[![License](https://img.shields.io/badge/license-Apache%202.0-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey.svg)](https://github.com/flyhunterl/flymd)

![lv_0_20251028184941](https://github.com/user-attachments/assets/3d6a5b6a-82e8-4d9d-9657-c9b66ef48f82)


## ✨ 项目特色


- 即开即用：安装包仅6MB 拒绝臃肿。冷启动毫秒级响应，代码一键复制
- 界面干净：极简界面，默认仅菜单栏+编辑区，专注内容创作 启动速度和响应速度优秀
- 文库功能：支持指定文件夹，树状目录显示文件夹下子文件夹及文档 并支持文档管理
- 安全可靠：本地运行，无网络连接，预览 HTML 自动消毒 
- 图床支持：支持S3/R2绑定，直接粘贴图片上传 上传成功后自行写好图片连接语法
- 功能全面：MarkDown LaTeX Mermaid html全部支持
- 即时渲染：所见模式，输入即渲染！（v0.0.6）
- 极致性能：毫秒级响应速度，告别同类软件常见痛点
- 位置记忆：阅读和编辑文档位置均自动记忆，下次打开改文档无论阅读还是编辑都回到记忆位置（v0.0.6正式版）
- 自动同步：Webdav同步功能，采用内容哈希对比时间戳辅助判断。
## 📸 界面预览
<p align="center">
  <img src="https://github.com/user-attachments/assets/917ad246-1208-4585-9e10-7d2da54f2eef" width="32%" alt="Markdown Editor Screenshot 1"/>
  <img src="https://github.com/user-attachments/assets/97012b2d-4457-434d-a436-cdba796d25b4" width="32%" alt="Markdown Editor Screenshot 2"/>
  <img src="https://github.com/user-attachments/assets/39343b06-3c54-4990-a198-e5f941da6578" width="32%" alt="Markdown Editor Screenshot 3"/>
</p>
<p align="center">
  <img src="https://github.com/user-attachments/assets/7f1e9179-6087-4abf-80d5-7965dbbf2600" width="32%" alt="Markdown Editor Screenshot 4"/>
  <img src="https://github.com/user-attachments/assets/8d549446-6052-4c32-88f8-f473314476fd" width="32%" alt="Markdown Editor Screenshot 5"/>  <!-- 这里已经修正啦！ -->
  <img src="https://github.com/user-attachments/assets/4283312d-5ff6-43a7-a537-ef503e48604e" width="32%" alt="Markdown Editor Screenshot 6"/>
</p>

## 🎯 核心特性

### 📝 编辑
- 原生 `<textarea>` 编辑器，零延迟输入响应 
- 所见模式，输入即渲染。所见即所得
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

### 图床支持
- 支持S3/R2图床设置，粘贴/拖动图片直接上传图床 方便网络分发
**默认优先级**
      - 已启用并配置图床→直接上传并插入公网 URL（本地不保存）
      - 未启用/未配置图床→走本地落盘分支 [已创建文档：同级 images；未创建文档：系统图片目录]
      - 若图床已开启但上传失败→回退到本地落盘分支作为兜底
      - 本地已存在的图片将以路径读取不写入images目录


### 🎨 界面体验
- Windows 记事本风格菜单栏
- 跟随系统主题（浅色/深色）
- 预览覆盖层设计，切换无闪烁
- 窗口状态持久化（尺寸、位置）
- “最近”面板、“关于”弹窗（含快捷键说明）

### 🛡️ 稳定兼容
- 路径归一化与跨平台兼容


### ⚡ 极致性能
- 高亮库按需加载，首次启动更快
- Markdown 渲染器延迟初始化
- 纯 TypeScript（无前端框架）
- 精简事件绑定避免泄漏

## 🚀 快速开始

### 环境要求

- Windows 10/11 (x64)
- Linux
- WebView2 Runtime（Windows 10/11 通常已预装）


### 安装使用（推荐）

1. 前往 [Releases](https://github.com/flyhunterl/flymd/releases) 下载最新版本
2. 运行 `flymd_0.0.8_x64_setup.exe` 安装（文件名以实际发布为准）
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



## 📊 性能指标（目标）

- 冷启动：≤ 300ms
- 安装包体积：≤ 10MB
- 常驻内存：≤ 50MB
- 预览切换：≤ 16ms

## 🗺️ 路线图

## 更新 v0.1.0
- 新增：webdav同步扩展 使用同步元数据管理，采用内容哈希对比，时间戳辅助判断。
> 同步功能正在测试调整阶段，务必做好数据备份。如有问题请提ISSUE。 首次同步会比较慢（计算哈希值）


## 更新 v.0.0.9-fix
- 新增：下载更新启动失败后提供手动打开方式作为后退
- 修复：所见模式上传了图片后编辑无法聚焦的问题

## 更新 v.0.0.9
- 新增：图片总是保存到本地。默认关闭
- 新增：复制渲染好的文章到编辑器时转译成markdown格式以保证格式不丢失。
- 新增：扩展功能，现在可以管理和安装扩展了 作者：[HansJack](https://github.com/TGU-HansJack)
- 调整：将新建按钮调整至最左侧，以符合操作习惯
- 优化: 极大的优化文档库打开速度

## 更新 v.0.0.8-fix
- 修复之前拼接错误的更新连接导致的自动关下载失败
- 新增几个备用的代理地址以免代理失效导致更新失败


## 更新 v.0.0.8
- 修复：未设置图床的时候从剪切板粘贴图片回退成base64
- 新增: 未设置图床时粘贴板粘贴图片时将写入本地images目录
[本地已存在的图片将以路径读取不写入images目录]
[未保存的文档粘贴图片将放到系统默认图片目录，失败则返回为base64]
**默认优先级**
  - 已启用并配置图床→直接上传并插入公网 URL（本地不保存）
  - 未启用/未配置图床→走本地落盘分支[已创建文档：同级 images；未创建文档：系统图片目录]
  - 若图床已开启但上传失败→回退到本地落盘分支作为兜底
  - 本地已存在的图片将以路径读取不写入images目录


## 更新 v.0.0.7
- 新增：文件库自定义排序
- 新增：文件库隐藏md/txt/pdf/markdown以外的文件
- 新增：更新检测和下载功能
- 优化：为mermaid图标增加缓存


## 更新 v0.0.6-fix
- 修复：所见模式编辑到最下方时，无法聚焦输入框的问题
- 优化:   所见模式滚动逻辑
- 已知：所见模式中如果存在视野内的mermaid 后续输入文字会导致界面闪烁

## 更新 v0.0.6
- 新增：阅读/编辑位置自动记忆，再打开之前编辑或阅读过的文件时，回自动返回上次退出的位置。
- 优化: 修改所见模式处理Latex和mermaid的逻辑，现在所见模式支持Latex和mermaid了
- 优化: 缩短代码区域的行距，以及其他显示效果优化

## 更新 v0.0.6-beta
- 新增：所见模式（暂不支持Latex和mermaid，输入latex和mermaid的时候建议先切换回普通模式）


## 更新 v0.0.5

- 新增：PDF预览支持
- 新增：PDF后缀关联
- 优化：首屏打开速度


## 更新 v0.0.4

- 新增：文档库新建/重命名/删除/移动操作
- 新增：图库一键开关，以方便切换成本地模式
- 重构：重新设计UI 增加文库图标
- **启用新的版本号，安装过老版本的需要卸载重装（不丢数据）**

## 更新 v0.0.3

- 新增：库功能 在侧栏显示库里所有文档
- 新增：剪切板图片直接粘贴
- 修复: 本图片不能渲染的问题
- 修复：连接无法跳转的问题


## 更新 v0.0.2

本次版本聚焦稳定性与细节体验优化，主要改动：

- 统一确认对话框为 Tauri 原生 `ask`（打开/新建/拖拽打开/关闭），
- 修复 未保存直接关闭不提示 的问题：
- 修复 插入链接弹窗两个输入框在部分尺寸下溢出的视觉问题
- 增强 文档拖拽体验：
- 增强 预览安全/显示：
- 增强 Mermaid 渲染流程与错误提示；代码高亮按需加载


## 更新 v0.0.1

- 新增 LaTeX（基于 KaTeX）渲染支持
- 新增 Mermaid 流程图/时序图等渲染支持
- 新增快捷键：Ctrl+B 加粗、Ctrl+I 斜体、Ctrl+K 插入链接


### 跨平台支持
- [x] Windows 10/11
- [x] Linux（桌面环境）


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


<img width="300" height="300" alt="image" src="https://github.com/user-attachments/assets/4a716fd5-dc61-4a4f-b968-91626debe8d2" />


