// flymd 桌面端：Tauri 2
// 职责：对话框、文件系统、存储、窗口状态、外链打开等插件初始化

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, Emitter};

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .setup(|app| {
      // Windows "打开方式/默认程序" 传入的文件参数处理
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
            // 延迟发送事件，确保渲染侧事件监听已注册
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
      // 其它初始化逻辑
      if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_focus();
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
