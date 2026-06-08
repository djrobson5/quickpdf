use tauri::ipc::Response;
use tauri::{Emitter, Manager};

/// Read a file's raw bytes. Returns an efficient binary `Response` (the JS side
/// receives an ArrayBuffer), rather than a JSON number array.
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|e| e.to_string())
}

/// Write raw bytes to a file, overwriting any existing file at that path.
#[tauri::command]
fn write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &contents).map_err(|e| e.to_string())
}

/// A `.pdf` path passed on the command line at launch (file association), if any.
#[tauri::command]
fn get_launch_path() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(".pdf"))
}

fn pdf_from_args(argv: &[String]) -> Option<String> {
    argv.iter()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(".pdf"))
        .cloned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance must be registered first. When a second launch happens
        // (e.g. double-clicking another PDF), focus our window and forward the file.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
            if let Some(path) = pdf_from_args(&argv) {
                let _ = app.emit("open-file", path);
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            get_launch_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
