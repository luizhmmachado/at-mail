use tauri::Manager;

/// O desktop carrega o mesmo bundle web do Expo (React Native Web), garantindo
/// 1:1 de UI com Web/Mobile e consumo de RAM baixo (WebView do sistema, sem
/// Chromium embutido como no Electron).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // O login Google precisa abrir o navegador do sistema: a WebView do Tauri
        // não cria abas externas sozinha.
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("@mail");
                #[cfg(target_os = "macos")]
                {
                    let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("@mail: falha ao iniciar a janela");
}
