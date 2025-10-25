// flymd 主进程（Tauri 2）
// 职责：创建窗口、加载插件（对话框、文件、存储、窗口状态）

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, Emitter};

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      #[cfg(target_os = "windows")]
      {
        use std::time::Duration;
        // 二次启动（或通过"打开方式"触发）将参数转发到已运行实例
        if let Some(win) = app.get_webview_window("main") {
          if let Some(p) = argv.into_iter().skip(1).map(std::path::PathBuf::from).find(|p| {
            p.exists() && matches!(p.extension().and_then(|s| s.to_str()).map(|s| s.to_ascii_lowercase()), Some(ext) if ext=="md"||ext=="markdown"||ext=="txt")
          }) {
            // 延迟发送，确保事件监听器已就绪
            let win_clone = win.clone();
            let path = p.to_string_lossy().to_string();
            std::thread::spawn(move || {
              std::thread::sleep(Duration::from_millis(200));
              let _ = win_clone.emit("open-file", path);
              let _ = win_clone.set_focus();
            });
          }
        }
      }
    }))
    .setup(|app| {      // Windows "打开方式/默认程序"传入的文件参数处理
      #[cfg(target_os = "windows")]
      {
        use std::env;
        use std::path::PathBuf;
        use std::time::Duration;
        if let Some(win) = app.get_webview_window("main") {
          let args: Vec<PathBuf> = env::args_os().skip(1).map(PathBuf::from).collect();
          if let Some(p) = args.into_iter().find(|p| {
            if !p.exists() { return false; }
            match p.extension().and_then(|s| s.to_str()).map(|s| s.to_ascii_lowercase()) {
              Some(ext) => ext == "md" || ext == "markdown" || ext == "txt",
              None => false,
            }
          }) {
            // 延迟发送事件，确保前端事件监听器已注册
            let win_clone = win.clone();
            let path = p.to_string_lossy().to_string();
            std::thread::spawn(move || {
              std::thread::sleep(Duration::from_millis(500));
              let _ = win_clone.emit("open-file", path);
              let _ = win_clone.set_focus();
            });
          }
        }
      }
      // 可在此定制窗口属性或初始化逻辑
      if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_focus();
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

