// flymd 主进程（Tauri 2）
// 职责：创建窗口、加载插件（对话框、文件、存储、窗口状态）

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager};

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .setup(|app| {
      // 可在此定制窗口属性或初始化逻辑
      if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_focus();
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

