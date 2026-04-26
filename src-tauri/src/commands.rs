use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader as TokioBufReader};

// ─── Shared state ────────────────────────────────────────────────────────────

/// Maps a conversion `file_id` to the PID of the ffmpeg child process,
/// so that a running conversion can be killed from `ffmpeg_cancel`.
pub struct ActiveProcesses(pub Mutex<HashMap<String, u32>>);

// ─── Progress event payload ──────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
pub struct FfmpegProgress {
    pub file_id: String,
    /// 0–100.  -1 means the duration is unknown (indeterminate progress bar).
    pub percent: f32,
}

// ─── Detect ──────────────────────────────────────────────────────────────────

/// Return `true` when `ffmpeg` is reachable on the system PATH.
#[tauri::command]
pub fn detect_ffmpeg() -> bool {
    std::process::Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Probe the total duration (seconds) of a media file.
/// Runs `ffmpeg -i <path>` which exits non-zero but writes the file info —
/// including a `Duration:` field — to stderr.  Returns -1.0 on failure.
async fn probe_duration(input_path: &str) -> f64 {
    let Ok(out) = tokio::process::Command::new("ffmpeg")
        .args(["-i", input_path])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
    else {
        return -1.0;
    };

    let text = String::from_utf8_lossy(&out.stderr);
    for line in text.lines() {
        if let Some(dur) = parse_duration_line(line) {
            return dur;
        }
    }
    -1.0
}

/// Extract duration from a line like `  Duration: 00:01:30.45, start: 0.0, ...`
fn parse_duration_line(line: &str) -> Option<f64> {
    let pos = line.find("Duration:")?;
    let after = line[pos + 9..].trim_start();
    let end = after.find(',').unwrap_or(after.len());
    let dur_str = after[..end].trim();
    if dur_str == "N/A" {
        return None;
    }
    parse_time_str(dur_str)
}

/// Parse `HH:MM:SS.ffffff` → total seconds.
fn parse_time_str(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.splitn(3, ':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].trim().parse().ok()?;
    let m: f64 = parts[1].trim().parse().ok()?;
    let sec: f64 = parts[2].trim().parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}

/// Parse an `out_time=HH:MM:SS.ffffff` line from ffmpeg `-progress` output.
/// Returns `None` for N/A, negative values, or unrecognised lines.
fn parse_progress_time(line: &str) -> Option<f64> {
    let val = line.trim().strip_prefix("out_time=")?;
    if val.is_empty() || val.starts_with("N/A") || val.starts_with('-') {
        return None;
    }
    parse_time_str(val)
}

/// Send SIGTERM / taskkill to a process by PID.
#[cfg(target_os = "windows")]
fn kill_pid(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(target_os = "windows"))]
fn kill_pid(pid: u32) {
    let _ = std::process::Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status();
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/// Convert a media file with the system FFmpeg.
///
/// Emits `ffmpeg-progress` events shaped as `{ file_id: string, percent: number }`.
/// `percent` is in [0, 100] or -1 when the total duration is unknown.
#[tauri::command]
pub async fn ffmpeg_convert(
    app: AppHandle,
    state: State<'_, ActiveProcesses>,
    file_id: String,
    input_path: String,
    output_path: String,
) -> Result<(), String> {
    // ── Probe duration for progress reporting ──────────────────────────────
    let duration = probe_duration(&input_path).await;

    // ── Spawn ffmpeg ───────────────────────────────────────────────────────
    // -progress pipe:1  → structured progress to stdout
    // -nostats          → suppress per-frame stats on stderr
    // -y                → overwrite output file without prompting
    let mut child = tokio::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            input_path.as_str(),
            "-progress",
            "pipe:1",
            "-nostats",
        ])
        .arg(output_path.as_str())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {e}"))?;

    // Register the PID for potential cancellation
    if let Some(pid) = child.id() {
        state.0.lock().unwrap().insert(file_id.clone(), pid);
    }

    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");

    // Drain stderr concurrently so its pipe buffer never fills up and
    // deadlocks the process. We collect it for error reporting.
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        TokioBufReader::new(stderr)
            .read_to_string(&mut buf)
            .await
            .ok();
        buf
    });

    // ── Stream progress from stdout ────────────────────────────────────────
    let mut lines = TokioBufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(elapsed) = parse_progress_time(&line) {
            let percent = if duration > 0.0 {
                ((elapsed / duration * 100.0) as f32).clamp(0.0, 100.0)
            } else {
                -1.0
            };
            let _ = app.emit(
                "ffmpeg-progress",
                FfmpegProgress {
                    file_id: file_id.clone(),
                    percent,
                },
            );
        }
    }

    // ── Wait for ffmpeg to exit ────────────────────────────────────────────
    let status = child.wait().await.map_err(|e| e.to_string())?;
    let stderr_text = stderr_task.await.unwrap_or_default();

    // If the PID is no longer in the map it was removed by ffmpeg_cancel
    let was_cancelled = state.0.lock().unwrap().remove(&file_id).is_none();

    if !status.success() {
        if was_cancelled {
            return Err("cancelled".to_string());
        }
        // Return the last few lines of stderr as the error message
        let tail: String = stderr_text
            .lines()
            .filter(|l| !l.is_empty())
            .rev()
            .take(6)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("FFmpeg failed:\n{tail}"));
    }

    Ok(())
}

/// Kill an active FFmpeg conversion identified by `file_id`.
#[tauri::command]
pub fn ffmpeg_cancel(
    state: State<'_, ActiveProcesses>,
    file_id: String,
) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    if let Some(pid) = map.remove(&file_id) {
        kill_pid(pid);
    }
    Ok(())
}
