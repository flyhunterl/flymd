# Android 版本适配方案（Tauri v2）

本文档给出在现有 flymd（Tauri 2 + Vite + Rust）项目上新增 Android 版本的整体方案、代码改造点与发布流程。目标是在尽量少改动现有代码的前提下，让核心功能在 Android 设备上稳定可用。

## 1. 技术路线
- 跨端框架：沿用 Tauri 2（已内置移动端支持），前端不改栈（Vite/TS），后端 Rust 复用。
- 打包工具链：Android Studio + Android SDK/NDK + Rust Android targets，使用 `tauri android` 子命令开发/构建。
- 存储与权限：优先使用 Tauri 插件 `@tauri-apps/plugin-fs` 的 App 专用目录；跨目录访问通过系统文件选择器（SAF）。
- 网络：使用 `reqwest` + `rustls`（已配置）和 `@tauri-apps/plugin-http`，Manifest 启用 `INTERNET`。

## 2. 兼容性清单（重要）
- 已用插件的 Android 适配
  - fs：可用，建议限制为 App 专用目录或经 SAF 授权的 URI。
  - http：可用；如需明文 HTTP，需要 Network Security Config 允许特定域名明文流量。
  - opener：可用，用于外部浏览器/应用唤起。
  - store：可用，保存偏好/轻量配置。
  - dialog：消息/确认对话可用；文件打开/保存依系统文件选择器，交互与桌面不同（路径多为 URI）。
  - window-state：桌面特性（窗口大小/位置），Android 不适用，需条件编译屏蔽注册。
- 现有自定义命令影响
  - move_to_trash：Android 无“回收站”概念；建议在 Android 上退化为直接删除或移动到 App 自建回收目录。
  - read_text_file_any / write_text_file_any：直接路径在移动端不可靠；建议：前端改用 `plugin-fs` + BaseDirectory 或通过文件选择器取得 URI 后在 Rust 侧处理。
  - download_file：当前默认保存到 `HOME/Downloads`，Android 需改为 App 专用目录或通过 SAF 写入“下载”目录。
  - 更新检查/下载安装包：桌面逻辑不适用 Android。建议：Android 仅提示最新版本并跳转到 Release 页面/商店，或接入应用分发平台的内置更新能力。

## 3. 开发环境准备
- 安装 Android Studio（含 SDK/Platform-Tools/Build-Tools）。
- 安装 NDK（建议 r25+），在 Android Studio SDK Manager 勾选。
- JDK 17（Android Gradle 推荐）。配置 `JAVA_HOME`。
- Rust 目标：
  ```bash
  rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
  ```
- Node 版本：已满足（本项目 Node v22+）。

## 4. 工程初始化与脚本
- 初始化 Android 工程（首次执行）：
  ```bash
  npx tauri android init
  ```
  将在 `src-tauri/gen/android` 生成原生工程与 Manifest/Gradle 配置。
- 推荐在 `package.json` 增加脚本：
  ```json
  {
    "scripts": {
      "tauri:android:init": "tauri android init",
      "tauri:android:dev": "tauri android dev",
      "tauri:android:build": "tauri android build"
    }
  }
  ```
- 运行到真机/模拟器：
  ```bash
  npm run tauri:android:dev
  ```
- 构建发布包：
  ```bash
  npm run tauri:android:build
  ```

## 5. 必要代码改造（最小改动）
1) 条件注册桌面专属插件（`window-state`）
   - 修改 `src-tauri/src/main.rs` 插件注册处：
   ```rust
   #[cfg(not(target_os = "android"))]
   .plugin(tauri_plugin_window_state::Builder::default().build())
   ```
2) 回收站能力降级
   - 在 `move_to_trash` 内做平台分支：Android 直接删除或移入 App 私有回收目录。
   ```rust
   #[tauri::command]
   async fn move_to_trash(path: String) -> Result<(), String> {
     #[cfg(target_os = "android")]
     {
       std::fs::remove_file(&path).map_err(|e| format!("remove error: {e}"))?;
       return Ok(());
     }
     #[cfg(not(target_os = "android"))]
     {
       tauri::async_runtime::spawn_blocking(move || {
         trash::delete(path).map_err(|e| format!("move_to_trash error: {e}"))
       })
       .await
       .map_err(|e| format!("join error: {e}"))??;
       Ok(())
     }
   }
   ```
3) 文件读写路径策略
   - 前端优先使用 `@tauri-apps/plugin-fs` 的 `BaseDirectory`，避免裸路径：
   ```ts
   import { readTextFile, writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs'
   await writeTextFile('flymd/notes/demo.md', '# 标题', { dir: BaseDirectory.AppData })
   const text = await readTextFile('flymd/notes/demo.md', { dir: BaseDirectory.AppData })
   ```
   - 如需“任意目录”访问，通过 `dialog.open()` 选文件后获得句柄（Android 可能是 URI），由后端结合 SAF/插件处理。
4) 下载保存位置
   - Android 上将 `download_file` 保存位置改到 App 专用目录，或在前端通过 SAF 选择保存目标；避免直接写 `Downloads` 物理路径。
5) 更新检查行为
   - Android 构建下隐藏“下载并安装”按钮，仅展示最新版本并通过 `opener` 打开 Release 页；或集成第三方分发平台的 In-App Update。

## 6. Manifest 与权限
- `INTERNET`：网络访问（`reqwest`/`plugin-http`）。
- 明文 HTTP（可选）：若需访问 `http://`，添加 Network Security Config 并在 Manifest 绑定，最好只放行特定域名。
- 存储：尽量不申请 `READ/WRITE_EXTERNAL_STORAGE`（新系统已废弃），改用 SAF（系统文件选择器）。
- 外链唤起：`opener` 使用 Intent，不额外权限。

生成后的位置：`src-tauri/gen/android/app/src/main/AndroidManifest.xml`。按需添加 `queries`、`provider` 或 `networkSecurityConfig`。

## 7. UI/交互差异
- 单窗口模型：Android 只有一个 WebView 窗口，窗口大小/位置相关功能不适用。
- 返回键：建议前端监听并优先执行路由后退，无路由可退时再退出。
- 文件选择：通过系统选择器进行授权访问，路径多为 URI 而非传统文件路径。

## 8. 构建、签名与发布
- 构建产物：默认生成 `apk`；生产发布建议使用 `aab`（Android App Bundle）。
- 签名：在 `android` 工程配置 keystore，或使用环境变量在 CI 中注入。
- 架构：发布至少包含 `arm64-v8a`（aarch64），可按需增加 `armeabi-v7a`、`x86_64`（模拟器）。
- 命令：
  ```bash
  # 开发调试
  tauri android dev --target aarch64
  # 发布构建
  tauri android build --release
  ```

## 9. CI/CD（可选）
- 使用 GitHub Actions：
  - runner: ubuntu-latest
  - 安装 Android SDK/NDK，配置 `JAVA_HOME`、`ANDROID_SDK_ROOT`。
  - 安装 Rust 目标并执行 `tauri android build`。
  - 产物上传到 Release。

## 10. 风险与里程碑
- 体积：AWS SDK + Rust 依赖会抬升 APK 体积；建议按需裁剪功能或拆分 feature。
- 文件访问：跨目录访问依赖 SAF，需调整前端交互引导用户授权。
- 更新机制：桌面与 Android 差异较大，建议独立规范。
- 里程碑：
  1) 环境联调（设备可运行）
  2) 核心阅读/编辑/保存流程稳定
  3) 对话框与外链唤起验证
  4) S3 上传/预签名、XML-RPC 等网络能力验证
  5) 签名发布与渠道分发

---
如需，我可以按本方案提交一个最小改造 PR：
- 条件编译去掉 `window-state` 插件（Android）
- 调整 `move_to_trash` 降级
- 新增 Android 命令脚本与初始化工程
- 将下载/存储切换为 App 专用目录

## Kotlin 支持与配置

- 可以完全使用 Kotlin 替代 Java。Tauri v2 的 Android 模板默认即为 Kotlin（若你看到 Java 模板，也可用 Android Studio 的“Convert Java File to Kotlin File”一键转换）。
- 关键点：
  1) 在 app 模块启用 Kotlin 插件，并设置 JDK 17 目标
  2) 用 Kotlin 定义 `MainActivity` 继承 Tauri 的 `TauriActivity`

- Gradle（Groovy DSL）示例：
```gradle
plugins {
  id 'com.android.application'
  id 'org.jetbrains.kotlin.android'
}

android {
  namespace 'com.flymd'
  compileSdk 34

  defaultConfig {
    applicationId 'com.flymd'
    minSdk 24
    targetSdk 34
    versionCode 1
    versionName '0.1.0'
  }

  compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
  }
  kotlinOptions {
    jvmTarget = '17'
  }
}
```

- Kotlin 入口 Activity 示例：
```kotlin
package com.flymd

import app.tauri.TauriActivity

class MainActivity : TauriActivity()
```

- 说明：
  - 业务与插件调用仍走 Rust/Tauri 通道；是否使用 Kotlin 不影响现有前端或 Rust 代码。
  - 如果 Gradle 使用 Kotlin DSL（`build.gradle.kts`），请按等价方式启用 `org.jetbrains.kotlin.android` 插件并设置 `jvmTarget = "17"`。

## GitHub Actions（Android 独立工作流）

- 路径：`.github/workflows/android.yml`
- 触发：`push` 标签（`v*`）和手动 `workflow_dispatch`
- 主要步骤：
  - 安装 Node 20、Java 17、Android SDK/NDK、Rust 目标
  - 若 `src-tauri/gen/android` 不存在则在 CI 中执行初始化
  - 构建 `--release` 并上传 APK/AAB 工件
- 不影响现有桌面端工作流（Windows/Linux 的 `build.yml` 保持不变）。
