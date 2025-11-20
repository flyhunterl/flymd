# 飞速MarkDown（FlyMD）

[简体中文](README.md) | [English](README.en.md)

[![Version](https://img.shields.io/badge/version-v0.3.6-blue.svg)](https://github.com/flyhunterl/flymd)
[![License](https://img.shields.io/badge/license-NonCommercial-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)](https://github.com/flyhunterl/flymd)
![GitHub Downloads](https://img.shields.io/github/downloads/flyhunterl/flymd/total)


跨平台 所见所得 图床上传 WebDav同步 插件扩展 响应迅速 占用极低的 Markdown 编辑 PDF 阅读工具。


![1](https://github.com/user-attachments/assets/38f9f007-8a09-4231-9c53-2d3bc6f245be)



## ✨ 项目特色


- 即开即用：安装包仅7MB 拒绝臃肿。冷启动毫秒级响应，代码一键复制
- 界面干净：极简界面，默认仅菜单栏+编辑区，专注内容创作 启动速度和响应速度优秀
- 文库功能：支持指定文件夹，树状目录显示文件夹下子文件夹及文档 并支持文档管理/支持添加多个文档库
- 安全可靠：本地运行，无网络连接，预览 HTML 自动消毒 
- 图床支持：支持S3/R2绑定，直接粘贴图片上传 上传成功后自行写好图片连接语法
- 功能全面：MarkDown LaTeX Mermaid html全部支持
- 即时渲染：所见模式，输入即渲染！Mermaid LaTex全局实时渲染，双击编辑代码
- 极致性能：毫秒级响应速度，告别同类软件常见痛点
- 位置记忆：阅读和编辑文档位置均自动记忆，下次打开改文档无论阅读还是编辑都回到记忆位置（v0.0.6正式版）
- 自动同步：Webdav同步功能
- 插件扩展：支持插件扩展功能，可以自行开发也可以一键安装已上架的扩展/插件
- 格式支持：支持另存为PDF Docx Wps 
- 人工智能：可通过扩展市场安装AI助手（通过扩展市场安装）润色、改错、总结。
- 待办推送：通过扩展市场安装代办事项推送扩展，可将未完成的 TODO 按设定时间通过微信、短信或邮箱推送给指定人员
## 📸 界面预览 0.2.2版本

<p align="center">
  <img src="https://github.com/user-attachments/assets/661c3263-d877-4fcf-a77f-69096b42b9d5" width="32%" alt="Markdown Editor Screenshot 1"/>
  <img src="https://github.com/user-attachments/assets/1182c443-f93c-4167-bc05-f4cc4b391ab5" width="32%" alt="Markdown Editor Screenshot 2"/>
  <img src="https://github.com/user-attachments/assets/d51945f9-c227-43eb-8105-0bb07d66db52" width="32%" alt="Markdown Editor Screenshot 3"/>
</p>


## 核心特性
- 编辑体验
  - 即时编辑/所见即所得（基于 Milkdown）
  - 原生低延迟：保留 `<textarea>` 管线，中文输入法合成友好，智能成对补全括号/引号，不干扰输入（编辑模式）
  - 统一缩进与多行操作：`Tab` 在编辑/WYSIWYG 两种模式下表现一致
  - 常用格式化：`Ctrl+B` 加粗、`Ctrl+I` 斜体、`Ctrl+K` 插入链接；精确的行列/光标位置反馈
  - 编辑/阅读宽度调节：按住 `Shift` + 鼠标滚轮 调整编辑区/阅读区宽度，长文阅读时更容易找到舒适宽度
  - 所见模式使用`Ctrl+Enter`跳出代码区  
  **编辑模式使用标准语法，空格X2+回车才会触发提行。未使用标准语法切换到所见模式提行会失效。阅读模式不受影响**  
  **自动补全仅编辑模式生效**  
  **因中英文符号的区别，中文输入法可能影响补全体验，建议切换到英文标点**
- 阅读与大纲
  - 安全预览：`markdown-it` 渲染 + `highlight.js` 代码高亮 + `DOMPurify` 清洗 HTML，外链自动追加 `target="_blank"` + `rel="noopener"`
  - 大纲导航：提取 Markdown `H1–H6` 生成可点击目录，高亮当前标题，预览与滚动同步
  - PDF 书签（Outline）：内置 PDF 阅读与书签大纲，按文件缓存并在修改时自动失效
- iframe 嵌入支持
  - 灵活嵌入：支持在 Markdown 中嵌入 iframe 控件，可以嵌入音乐、视频、地图、在线文档等外部网页内容
  - 简单语法：直接使用 HTML `<iframe>` 标签，支持自定义宽度、高度等属性
  - 示例用法：
    ```html
    <!-- 嵌入 YouTube 视频 -->
    <iframe width="560" height="315"
      src="https://www.youtube.com/embed/VIDEO_ID"
      frameborder="0" allowfullscreen>
    </iframe>

    <!-- 嵌入在线文档 -->
    <iframe width="100%" height="500"
      src="https://example.com/document"
      frameborder="0">
    </iframe>

    <!-- 嵌入地图 -->
    <iframe width="600" height="450"
      src="https://www.openstreetmap.org/export/embed.html"
      frameborder="0">
    </iframe>

    <!-- 嵌入网易云音乐 -->
    <iframe frameborder="no" border="0" marginwidth="0" marginheight="0" width=330 height=86 src="https://music.163.com/outchain/player?type=2&id=1424916458&auto=1&height=66"></iframe>
    ```
- 图片与图床
  - 一步到位：粘贴/拖拽图片自动处理；优先上传至 S3/R2 并插入公网 URL；未配置/失败时回退本地保存
  - 本地图片就地可见：无需额外配置即可预览
- 同步（WebDAV 扩展）
  - 同步可视化：状态提示、过程日志、进度反馈与冲突提示
  - 远端移动优化：利用 `MOVE` 降低重复下载/上传，优化重命名/移动场景
- 语言与可用性
  - 中英双语 + 自动：跟随系统语言或手动切换，记忆用户选择
  - 位置记忆：每个文件独立记忆上次“阅读/编辑光标/滚动位置”
- 安全与性能
  - 本地优先，零后台网络：除非你明确启用（图床、同步等），否则不进行网络访问
  - 性能优化：冷启动与渲染链路按需加载、静态资源分块、日志可控；目标冷启动 <300ms、预览切换 <16ms（典型 2–3k 行文档）
## 快速开始
- 安装
  - 从发布页下载对应平台安装包并安装；Windows 需安装 WebView2（多数系统已内置）
- 创建/打开
  - 新建：`Ctrl+N`；打开：`Ctrl+O`；保存：`Ctrl+S`；另存为：`Ctrl+Shift+S`
  - 资料库：侧边栏文件树支持新建/重命名/移动/删除与最近文件
- 模式切换
  - 编辑模式：`Ctrl+E`；可以用于编辑阅读切换
  - 快速阅读：`Ctrl+R`
  - 所见模式：`Ctrl+W`；可以用于所见编辑切换
- 常用编辑
  - 加粗/斜体/链接：`Ctrl+B / Ctrl+I / Ctrl+K`；`Esc` 关闭对话框
  - 图片：粘贴/拖入即可（所见模式不支持拖动）；配置 S3/R2 后自动上传插入 URL；未配置/失败回退本地保存。可选：总是保存到本地
- 同步（可选）
  - 在“扩展”里启用 WebDAV，提供 日志/进度/冲突提示；（上线不久仍然完善，记得备份）
- 语言
  - 设置中切换 中文/English 或选择 Auto 跟随系统；语言偏好会被记住
## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` | 新建文件 |
| `Ctrl+O` | 打开文件 |
| `Ctrl+S` | 保存文件 |
| `Ctrl+H` | 查找替换 |
| `Ctrl+Shift+S` | 另存为 |
| `Ctrl+E` | 切换编辑/预览 |
| `Ctrl+R` | 进入阅读（预览） |
| `Ctrl+W` | 开/关所见模式 |
| `Escape` | 预览或弹窗下关闭/返回 |
| `Ctrl+B` | 加粗 |
| `Ctrl+I` | 斜体 |
| `Ctrl+K` | 插入链接 |

## 🔌 扩展开发

flyMD 支持通过扩展插件来增强功能。你可以：

- 开发自定义扩展插件
- 从 GitHub 或 HTTP URL 安装插件
- 管理已安装的扩展

详细开发指南请参阅：[扩展开发文档](plugin.md)

**示例插件：**
- [Typecho Publisher](https://github.com/TGU-HansJack/typecho-publisher-flymd) - 将文章发布到 Typecho 博客平台
- 代办事项推送扩展 - 将未完成的 TODO 按设定时间通过微信、短信或邮箱推送给指定人员


## 📊 性能指标（目标）

- 冷启动：≤ 300ms
- 安装包体积：≤ 10MB
- 常驻内存：≤ 50MB
- 预览切换：≤ 16ms

## 路线图[更新记录]

详见: [ROADMAP.md](ROADMAP.md)

### 跨平台支持
- [x] Windows 10/11
- [x] Linux（桌面环境）
- [x] MacOS 


## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

## 📄 许可与合规

- 本项目采用“飞速MarkDown（flyMD）非商业开源许可协议（NC 1.0）”。
- 允许：在非商业前提下自由使用、修改、复制与再分发；必须保留署名与来源。
- 商业使用：未经书面授权禁止。商业授权请联系：flyhunterl <flyhunterl@gmail.com>。
- 许可全文见：[LICENSE](LICENSE)（附英文翻译，中文为主版本）
- 第三方组件许可见：[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

## 🙏 致谢
- [MilkDown](https://milkdown.dev/)
- [Tauri](https://tauri.app/)
- [markdown-it](https://github.com/markdown-it/markdown-it)
- [DOMPurify](https://github.com/cure53/DOMPurify)
- [highlight.js](https://highlightjs.org/)
- [KaTeX](https://katex.org/)
- [Mermaid](https://mermaid.js.org/)

## 常见问题 (Linux)

- [Arch 遇到程序打开空白的解决方法](arch.md)


## 开源不易

<img width="300" height="300" alt="image" src="https://github.com/user-attachments/assets/4a716fd5-dc61-4a4f-b968-91626debe8d2" />

