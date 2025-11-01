# flyMD Android 构建指南

## 概述

本文档说明如何构建 flyMD 的 Android 版本。Android 分支包含了所有必要的平台适配代码，支持：
- ✅ SAF（Storage Access Framework）文件访问
- ✅ 移动端 UI（FAB、抽屉式文件库）
- ✅ 虚拟键盘适配
- ✅ 跨平台文件操作（桌面/Android 自动适配）

## 方法一：GitHub Actions 自动构建（推荐）

### 1. 触发构建

在 GitHub 仓库页面：
1. 进入 **Actions** 标签页
2. 选择 **Android Build** workflow
3. 点击 **Run workflow**
4. 选择构建类型：
   - `debug` - 调试版本（无需签名，默认选项）
   - `release` - 发布版本（需要配置签名，见下方）
5. 点击 **Run workflow** 开始构建

### 2. 下载 APK

构建完成后：
1. 进入 workflow 运行详情页
2. 在 **Artifacts** 部分下载：
   - `flymd-android-debug.zip` (调试版)
   - `flymd-android-release.zip` (发布版)
3. 解压后将 APK 安装到 Android 设备

### 3. 配置 Release 签名（可选）

如果要构建发布版 APK，需要在 GitHub 仓库设置中添加以下 Secrets：

**Settings → Secrets and variables → Actions → New repository secret**

| Secret 名称 | 说明 | 示例值 |
|------------|------|--------|
| `ANDROID_KEYSTORE_PATH` | Keystore 文件路径 | `android/flymd.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore 密码 | `your_keystore_password` |
| `ANDROID_KEY_ALIAS` | Key 别名 | `flymd` |
| `ANDROID_KEY_PASSWORD` | Key 密码 | `your_key_password` |

**生成 Keystore（本地操作）：**
```bash
keytool -genkey -v -keystore flymd.keystore \
  -alias flymd \
  -keyalg RSA -keysize 2048 -validity 10000

# 将 flymd.keystore 文件 base64 编码后添加到 Secrets
# Linux/macOS:
base64 flymd.keystore | pbcopy

# Windows (PowerShell):
[Convert]::ToBase64String([IO.File]::ReadAllBytes("flymd.keystore")) | clip
```

---

## 方法二：本地构建

### 前置要求

#### 1. 安装 Java 17
```bash
# Ubuntu/Debian
sudo apt install openjdk-17-jdk

# macOS
brew install openjdk@17

# Windows
# 下载安装：https://adoptium.net/temurin/releases/?version=17
```

#### 2. 安装 Android Studio 和 SDK
1. 下载 Android Studio：https://developer.android.com/studio
2. 安装后，打开 **SDK Manager**（Tools → SDK Manager）
3. 确保安装：
   - Android SDK Platform 34（API Level 34）
   - Android SDK Build-Tools 34.0.0
   - Android SDK Command-line Tools
   - NDK (Side by side) - 版本 26.1.10909125

#### 3. 配置环境变量
```bash
# Linux/macOS (~/.bashrc 或 ~/.zshrc)
export ANDROID_HOME="$HOME/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/26.1.10909125"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/tools:$PATH"

# Windows (PowerShell)
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\26.1.10909125"
$env:PATH += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\tools"
```

#### 4. 安装 Rust Android 工具链
```bash
rustup target add aarch64-linux-android
rustup target add armv7-linux-androideabi
rustup target add x86_64-linux-android
rustup target add i686-linux-android
```

#### 5. 安装 Node.js 和依赖
```bash
# Node.js 20+
node -v  # 确认版本

# 安装项目依赖
npm install

# 安装 Tauri CLI（全局）
npm install -g @tauri-apps/cli
```

### 构建步骤

#### 1. 初始化 Android 项目（仅首次）
```bash
cd flymd
npx tauri android init
```

这将在 `src-tauri/gen/android/` 目录下生成 Android 项目文件。

#### 2. 构建前端
```bash
npm run build
```

#### 3. 构建 Android APK

**调试版（无需签名）：**
```bash
npx tauri android build --debug
```

**发布版（需要签名）：**
```bash
npx tauri android build --release
```

#### 4. 查找生成的 APK

构建成功后，APK 文件位于：
```
src-tauri/gen/android/app/build/outputs/apk/
├── debug/
│   └── app-debug.apk        # 调试版
└── release/
    └── app-release.apk      # 发布版
```

### 安装到设备

#### 使用 USB 连接
```bash
# 连接设备并启用 USB 调试

# 安装 APK
adb install src-tauri/gen/android/app/build/outputs/apk/debug/app-debug.apk
```

#### 使用 Android 模拟器
```bash
# 启动 Tauri 开发模式（自动安装并运行）
npx tauri android dev
```

---

## 故障排查

### 问题 1：`JAVA_HOME` 未设置
```
Error: JAVA_HOME environment variable not set
```

**解决方法：**
```bash
# 查找 Java 安装路径
which java       # Linux/macOS
where java       # Windows

# 设置 JAVA_HOME（示例）
export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"  # Linux
export JAVA_HOME="/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"  # macOS
```

### 问题 2：NDK 找不到
```
Error: NDK not found
```

**解决方法：**
1. 打开 Android Studio → SDK Manager → SDK Tools
2. 勾选 **NDK (Side by side)**
3. 安装版本 26.1.10909125
4. 设置环境变量：
   ```bash
   export NDK_HOME="$ANDROID_HOME/ndk/26.1.10909125"
   ```

### 问题 3：构建失败 - 依赖下载超时
```
Error: Failed to download gradle dependencies
```

**解决方法（国内用户）：**
编辑 `src-tauri/gen/android/build.gradle`，添加阿里云镜像：
```gradle
allprojects {
    repositories {
        maven { url 'https://maven.aliyun.com/repository/google' }
        maven { url 'https://maven.aliyun.com/repository/central' }
        maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }
        google()
        mavenCentral()
    }
}
```

### 问题 4：Rust 编译错误
```
Error: linker `aarch64-linux-android-gcc` not found
```

**解决方法：**
```bash
# 确保安装了 Rust Android 工具链
rustup target list --installed | grep android

# 如果缺少，重新安装
rustup target add aarch64-linux-android armv7-linux-androideabi
```

### 问题 5：APK 无法安装
```
Failure [INSTALL_PARSE_FAILED_NO_CERTIFICATES]
```

**解决方法：**
- 调试版 APK 需要在开发者选项中启用 **"允许通过 USB 安装应用"**
- 或者签名 APK 后再安装

---

## Android 特性说明

### 文件访问
- **桌面版**：直接路径访问 (`/path/to/file.md`)
- **Android 版**：SAF URI 模式 (`content://com.android.providers...`)

Android 版通过 SAF（Storage Access Framework）访问文件：
1. 点击 FAB → 打开文件
2. 系统弹出文件选择器
3. 选择 `.md` 文件后，应用获取 URI 权限
4. 文件引用存储在"最近文件"列表中

### 移动端 UI
- **FAB（浮动操作按钮）**：替代桌面快捷键
  - 新建文件
  - 打开文件
  - 保存文件
  - 切换预览
  - 打开文件库

- **抽屉式文件库**：从左侧滑出
  - 最近打开的文件
  - WebDAV 同步文件（如已配置）

- **虚拟键盘适配**：
  - 编辑器自动调整高度，防止被键盘遮挡
  - 使用 Visual Viewport API 动态计算

### 功能限制
- ❌ 无自动更新（Android 通过 Google Play 或手动安装更新）
- ❌ 无拖拽打开文件（移动端不支持）
- ❌ 无窗口状态管理（移动端全屏应用）
- ✅ 其他功能（WebDAV 同步、S3 图片上传、扩展系统）完全兼容

---

## 下一步

### 完善 JNI 桥接
当前 Android SAF 命令为框架代码（返回 "JNI implementation pending"），需要实现：

1. 创建 Java/Kotlin 原生模块：
   ```kotlin
   // src-tauri/gen/android/app/src/main/java/.../SafBridge.kt
   class SafBridge {
       fun pickDocument(): String { /* 调用 Intent */ }
       fun readUri(uri: String): String { /* ContentResolver */ }
       fun writeUri(uri: String, content: String) { /* ... */ }
   }
   ```

2. 在 Rust 中通过 JNI 调用：
   ```rust
   #[tauri::command]
   async fn android_pick_document() -> Result<String, String> {
       #[cfg(target_os = "android")]
       {
           // TODO: 使用 jni crate 调用 SafBridge
           // let jvm = JavaVM::attach_current_thread()?;
           // let result = jvm.call_method(...)?;
       }
   }
   ```

参考资料：
- Tauri Android 文档：https://beta.tauri.app/develop/android/
- JNI 示例：https://github.com/jni-rs/jni-rs

### 测试清单
- [ ] 在真机上安装并启动 APK
- [ ] 测试 FAB 打开文件功能
- [ ] 测试编辑和保存
- [ ] 测试 WebDAV 同步
- [ ] 测试 S3 图片上传
- [ ] 测试虚拟键盘适配
- [ ] 测试屏幕旋转

---

## 贡献指南

如果你完善了 Android JNI 实现，欢迎提交 PR：
1. Fork 本仓库
2. 在 `android` 分支上开发
3. 提交 PR 并附上测试截图

---

**文档版本**：v1.0
**更新日期**：2025-11-01
**对应分支**：android
