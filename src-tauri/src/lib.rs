use notify::{EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, State};

#[derive(Default)]
struct WatcherState {
    inner: Mutex<Option<ActiveWatcher>>,
    last_self_write: Arc<Mutex<Option<(PathBuf, Instant)>>>,
}

struct ActiveWatcher {
    _watcher: notify::RecommendedWatcher,
}

#[derive(Clone, Serialize)]
struct FileChangedPayload {
    path: String,
}

fn validate_pen_path(path: &str) -> Result<PathBuf, String> {
    let pb = PathBuf::from(path);
    let ext = pb
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext.as_deref() {
        Some("pen") | Some("json") => Ok(pb),
        _ => Err("Only .pen and .json files are supported".to_string()),
    }
}

fn validate_fig_path(path: &str) -> Result<PathBuf, String> {
    let pb = PathBuf::from(path);
    let ext = pb
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext.as_deref() {
        Some("fig") => Ok(pb),
        _ => Err("Only .fig files are supported".to_string()),
    }
}

#[tauri::command]
fn read_pen_file(path: String) -> Result<String, String> {
    let pb = validate_pen_path(&path)?;
    std::fs::read_to_string(&pb).map_err(|e| format!("Failed to read file: {e}"))
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    let pb = validate_fig_path(&path)?;
    std::fs::read(&pb).map_err(|e| format!("Failed to read binary file: {e}"))
}

#[tauri::command]
fn write_pen_file(
    state: State<'_, WatcherState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let pb = validate_pen_path(&path)?;
    if let Ok(mut guard) = state.last_self_write.lock() {
        *guard = Some((pb.clone(), Instant::now()));
    }
    std::fs::write(&pb, content).map_err(|e| format!("Failed to write file: {e}"))
}

#[tauri::command]
fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    let pb = validate_fig_path(&path)?;
    std::fs::write(&pb, data).map_err(|e| format!("Failed to write binary file: {e}"))
}

#[tauri::command]
fn get_launch_file() -> Option<String> {
    std::env::args().skip(1).find(|arg| {
        !arg.starts_with('-')
            && (validate_pen_path(arg).is_ok() || validate_fig_path(arg).is_ok())
            && Path::new(arg).exists()
    })
}

#[tauri::command]
fn watch_pen_file(
    app: tauri::AppHandle,
    state: State<'_, WatcherState>,
    path: Option<String>,
) -> Result<(), String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "Watcher lock poisoned".to_string())?;
    *guard = None;

    let Some(path_str) = path else {
        return Ok(());
    };

    let pb = validate_pen_path(&path_str)?;
    let canonical_target = std::fs::canonicalize(&pb).unwrap_or_else(|_| pb.clone());
    let watch_dir = canonical_target
        .parent()
        .ok_or_else(|| "File has no parent directory".to_string())?
        .to_path_buf();

    let last_self_write = Arc::clone(&state.last_self_write);
    let last_emit = Arc::new(Mutex::new(None::<Instant>));
    let target_name = canonical_target.file_name().map(|n| n.to_os_string());
    let emitted_path = path_str.clone();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        let relevant_kind = matches!(
            event.kind,
            EventKind::Modify(_) | EventKind::Create(_)
        );
        if !relevant_kind {
            return;
        }

        let matches_target = event.paths.iter().any(|p| {
            std::fs::canonicalize(p).ok().as_ref() == Some(&canonical_target)
                || p.file_name().map(|n| n.to_os_string()) == target_name
        });
        if !matches_target {
            return;
        }

        // Ignore our own writes within 1.2s
        if let Ok(self_guard) = last_self_write.lock() {
            if let Some((ref written_path, written_at)) = *self_guard {
                let same_file = std::fs::canonicalize(written_path).ok().as_ref()
                    == Some(&canonical_target)
                    || written_path == &pb;
                if same_file && written_at.elapsed() < Duration::from_millis(1200) {
                    return;
                }
            }
        }

        // Debounce rapid filesystem notifications
        if let Ok(mut emit_guard) = last_emit.lock() {
            if let Some(prev) = *emit_guard {
                if prev.elapsed() < Duration::from_millis(250) {
                    return;
                }
            }
            *emit_guard = Some(Instant::now());
        }

        let _ = app.emit(
            "pen-file-changed",
            FileChangedPayload {
                path: emitted_path.clone(),
            },
        );
    })
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    watcher
        .watch(&watch_dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch directory: {e}"))?;

    *guard = Some(ActiveWatcher { _watcher: watcher });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            read_pen_file,
            read_binary_file,
            write_pen_file,
            write_binary_file,
            get_launch_file,
            watch_pen_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                if let Some(url) = urls.first() {
                    if let Ok(path) = url.to_file_path() {
                        if let Some(path_str) = path.to_str() {
                            if validate_pen_path(path_str).is_ok() {
                                let _ = _app_handle.emit(
                                    "pen-file-open-request",
                                    FileChangedPayload {
                                        path: path_str.to_string(),
                                    },
                                );
                            }
                        }
                    }
                }
            }
        });
}
