use serde::Serialize;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct McpServerState {
    child: Mutex<Option<Child>>,
}

impl McpServerState {
    pub fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpBridgeInfo {
    pub running: bool,
    pub url: String,
    pub script_path: String,
}

fn find_bridge_script() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("tools").join("collab-bridge").join("index.js"));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join("tools").join("collab-bridge").join("index.js"));
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("tools").join("collab-bridge").join("index.js"));
        }
    }
    candidates.into_iter().find(|p| p.exists())
}

pub fn start_bridge(state: &McpServerState) -> Result<McpBridgeInfo, String> {
    let script = find_bridge_script()
        .ok_or_else(|| "Не найден tools/collab-bridge/index.js".to_string())?;
    let script_str = script.to_string_lossy().to_string();

    if let Ok(mut guard) = state.child.lock() {
        // Check if already running
        if let Some(ref mut existing) = *guard {
            if existing.try_wait().ok().flatten().is_none() {
                return Ok(McpBridgeInfo {
                    running: true,
                    url: "ws://localhost:4567".to_string(),
                    script_path: script_str,
                });
            }
        }

        let mut cmd = Command::new("node");
        cmd.arg(&script)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let child = cmd
            .spawn()
            .map_err(|e| format!("Не удалось запустить Node.js для MCP Bridge: {e}"))?;
        *guard = Some(child);
    }

    Ok(McpBridgeInfo {
        running: true,
        url: "ws://localhost:4567".to_string(),
        script_path: script_str,
    })
}

