// flymd 库入口（移动端 Android/iOS 使用）
// 桌面端使用 main.rs 的 main() 函数
// 移动端使用 lib.rs 的 mobile_entry_point 宏

// 引入 main.rs 中的所有代码（重命名为 app 模块）
#[path = "main.rs"]
mod app;

// 移动端入口点（Android/iOS）
#[cfg(mobile)]
#[tauri::mobile_entry_point]
fn mobile_main() {
    // 调用 main.rs 中的公共函数
    app::run_app();
}
