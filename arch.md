## 排除双显卡渲染或依赖库问题
# Arch 遇到程序打开空白的解决方法

适用：Arch/Manjaro/EndeavourOS 等基于 Arch 的发行版。症状：启动 AppImage 后窗口空白（全白/无渲染）。

按顺序尝试，每步后重启应用验证。

1) 安装运行时依赖

```bash
sudo pacman -S --needed webkit2gtk gtk3
```

2) 切换后端/禁用部分渲染路径（逐项尝试）

```bash
chmod +x ./flymd_0.1.1_amd64.AppImage
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./flymd_0.1.1_amd64.AppImage
WEBKIT_DISABLE_COMPOSITING_MODE=1 ./flymd_0.1.1_amd64.AppImage
GDK_BACKEND=x11 ./flymd_0.1.1_amd64.AppImage      # 当前是 Wayland 时优先试
GDK_BACKEND=wayland ./flymd_0.1.1_amd64.AppImage  # 当前是 X11 时可尝试
```

3) 检查缺库

```bash
./flymd_0.1.1_amd64.AppImage --appimage-extract
ldd squashfs-root/usr/bin/flymd | grep -E 'webkit|gtk' || true
```

若看到 “not found”，用 pacman 安装对应包（通常是 `webkit2gtk` 或 `gtk3`）。

4) 仍为空白的常见方向
- 切换到 X11 或 Wayland 再试（参考第 2 步）。
- 全量更新（驱动/WebKitGTK）：`sudo pacman -Syu`。
- 临时关闭外接显示器或缩放，排除合成器问题。
- 使用debtap 转换 deb 并安装


## 最终方法
# Arch 使用 debtap 转换 deb 并安装

- 安装 debtap（AUR 包，任选其一）：
```bash
# 若已安装 AUR 助手，任选一个
yay -S debtap
paru -S debtap
```

- 初始化映射数据库（首次必做，之后偶尔更新）：
```bash
sudo debtap -u
```

- 转换 deb（文件名可自定，这里示例为 flymd_0.1.1_amd64.deb）：
```bash
debtap ./flymd_0.1.1_amd64.deb
```
  出现提示 “If you want to edit .PKGINFO and .INSTALL files ...” 时：
  - 选择 2（nano）或你熟悉的编辑器；
  - 在 .PKGINFO 的 depends 段，保留：
    - `depends = gtk` #删除这行
    - `depends = gtk3`
  - 若有旧名 `gtk`，请删除，避免与 gtk3 冲突；保存并退出。

- 安装生成的包（文件名以实际输出为准，例如）：
```bash
sudo pacman -U ./flymd-0.1.1-1-x86_64.pkg.tar.zst
```

6) 反馈最小信息（便于排查）
- `ldd` 输出中的 “not found” 行
- 会话（Wayland/X11）与桌面环境（GNOME/KDE 等）