// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::Emitter;

mod package_manager;
use package_manager::{Backend, Package};

/// One detected backend plus a lock that serializes its privileged
/// operations, so two installs can never race on the package-manager lock.
struct BackendSlot {
    backend: Backend,
    op_lock: Mutex<()>,
}

struct AppState {
    backends: Vec<BackendSlot>,
}

#[derive(Clone, Serialize)]
struct BackendInfo {
    label: String,
    source: String,
}

#[derive(Clone, Serialize)]
struct Progress {
    package: String,
    line: String,
}

#[derive(Clone, Serialize)]
struct OpResult {
    package: String,
    success: bool,
}

/// Query payload: partial results plus per-backend errors, so one failing
/// source never blanks out the data from the working ones.
#[derive(Serialize)]
struct QueryResults {
    results: Vec<Package>,
    errors: Vec<BackendError>,
}

#[derive(Serialize)]
struct BackendError {
    source: String,
    error: String,
}

/* ── validation ─────────────────────────────────────────────────────────── */

/// Reject empty / flag-like / over-long / odd-character queries before they
/// ever reach a package-manager CLI.
fn validate_query(q: &str) -> Result<(), String> {
    let t = q.trim();
    if t.is_empty() {
        return Err("Enter a search term".into());
    }
    if t.starts_with('-') {
        return Err("Search term cannot start with '-'".into());
    }
    if t.len() > 100 {
        return Err("Search term too long (max 100 characters)".into());
    }
    if !t
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.' | '+' | ':' | '/'))
    {
        return Err("Search term contains unsupported characters".into());
    }
    Ok(())
}

/// Package names: no leading dash, no whitespace, conservative charset.
fn validate_pkg(p: &str) -> Result<(), String> {
    if p.is_empty() {
        return Err("Package name is empty".into());
    }
    if p.starts_with('-') {
        return Err("Package name cannot start with '-'".into());
    }
    if p.len() > 200 {
        return Err("Package name too long".into());
    }
    if !p
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '_' | '-'))
    {
        return Err("Package name contains unsupported characters".into());
    }
    Ok(())
}

fn find_slot<'a>(state: &'a AppState, source: &str) -> Result<&'a BackendSlot, String> {
    state
        .backends
        .iter()
        .find(|s| s.backend.manager.source_id() == source)
        .ok_or_else(|| format!("backend '{source}' not found"))
}

fn label_of(slot: &BackendSlot) -> &'static str {
    slot.backend.manager.label()
}

/* ── detection ──────────────────────────────────────────────────────────── */

#[tauri::command]
fn detect_backends(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<BackendInfo>, String> {
    Ok(state
        .backends
        .iter()
        .map(|s| BackendInfo {
            label: s.backend.manager.label().to_string(),
            source: s.backend.manager.source_id().to_string(),
        })
        .collect())
}

/* ── read-only queries (partial results on per-backend failure) ────────── */

#[tauri::command]
async fn search_packages(
    query: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueryResults, String> {
    validate_query(&query)?;
    let query = query.trim().to_string();
    let st = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut results = Vec::new();
        let mut errors = Vec::new();
        for slot in &st.backends {
            match slot.backend.search(&query) {
                Ok(mut found) => results.append(&mut found),
                Err(e) => errors.push(BackendError {
                    source: label_of(slot).to_string(),
                    error: e,
                }),
            }
        }
        Ok(QueryResults { results, errors })
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn list_installed_packages(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueryResults, String> {
    let st = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut results = Vec::new();
        let mut errors = Vec::new();
        for slot in &st.backends {
            match slot.backend.list_installed() {
                Ok(mut found) => results.append(&mut found),
                Err(e) => errors.push(BackendError {
                    source: label_of(slot).to_string(),
                    error: e,
                }),
            }
        }
        Ok(QueryResults { results, errors })
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn check_updates(state: tauri::State<'_, Arc<AppState>>) -> Result<QueryResults, String> {
    let st = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut results = Vec::new();
        let mut errors = Vec::new();
        for slot in &st.backends {
            match slot.backend.check_updates() {
                Ok(mut found) => results.append(&mut found),
                Err(e) => errors.push(BackendError {
                    source: label_of(slot).to_string(),
                    error: e,
                }),
            }
        }
        Ok(QueryResults { results, errors })
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

/* ── privileged operations (serialized per backend) ────────────────────── */

#[tauri::command]
async fn install_package(
    app: tauri::AppHandle,
    source: String,
    package: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    validate_pkg(&package)?;
    let st = state.inner().clone();
    let app2 = app.clone();
    let pkg2 = package.clone();
    let src = source.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let slot = find_slot(&st, &src)?;
        // Hold this backend's op lock for the whole operation so two
        // privileged commands against the same package manager never race
        // on its database lock. The guard lives only inside this closure,
        // never across an await.
        let _guard = slot
            .op_lock
            .lock()
            .map_err(|_| "operation lock poisoned".to_string())?;
        let mut sink = |line: &str| {
            let _ = app2.emit(
                "install-output",
                Progress {
                    package: pkg2.clone(),
                    line: line.to_string(),
                },
            );
        };
        slot.backend.install(&pkg2, &mut sink)
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?;

    finish_op(&app, "install", package, result)
}

#[tauri::command]
async fn remove_package(
    app: tauri::AppHandle,
    source: String,
    package: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    validate_pkg(&package)?;
    let st = state.inner().clone();
    let app2 = app.clone();
    let pkg2 = package.clone();
    let src = source.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let slot = find_slot(&st, &src)?;
        let _guard = slot
            .op_lock
            .lock()
            .map_err(|_| "operation lock poisoned".to_string())?;
        let mut sink = |line: &str| {
            let _ = app2.emit(
                "remove-output",
                Progress {
                    package: pkg2.clone(),
                    line: line.to_string(),
                },
            );
        };
        slot.backend.remove(&pkg2, &mut sink)
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?;

    finish_op(&app, "remove", package, result)
}

/// Update one package to its newest available version.
#[tauri::command]
async fn update_package(
    app: tauri::AppHandle,
    source: String,
    package: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    validate_pkg(&package)?;
    let st = state.inner().clone();
    let app2 = app.clone();
    let pkg2 = package.clone();
    let src = source.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let slot = find_slot(&st, &src)?;
        let _guard = slot
            .op_lock
            .lock()
            .map_err(|_| "operation lock poisoned".to_string())?;
        let mut sink = |line: &str| {
            let _ = app2.emit(
                "update-output",
                Progress {
                    package: pkg2.clone(),
                    line: line.to_string(),
                },
            );
        };
        slot.backend.update_package(&pkg2, &mut sink)
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?;

    finish_op(&app, "update", package, result)
}

/// Update every package from one backend.
#[tauri::command]
async fn update_all_packages(
    app: tauri::AppHandle,
    source: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let st = state.inner().clone();
    let app2 = app.clone();
    let src = source.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let slot = find_slot(&st, &src)?;
        let _guard = slot
            .op_lock
            .lock()
            .map_err(|_| "operation lock poisoned".to_string())?;
        let mut sink = |line: &str| {
            let _ = app2.emit(
                "update-output",
                Progress {
                    package: "*".to_string(),
                    line: line.to_string(),
                },
            );
        };
        slot.backend.update_all(&mut sink)
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?;

    match result {
        Ok(()) => {
            let _ = app.emit("update-complete", serde_json::json!({ "success": true }));
            Ok(())
        }
        Err(e) => {
            let _ = app.emit(
                "update-complete",
                serde_json::json!({ "success": false, "error": e }),
            );
            Err(e)
        }
    }
}

fn finish_op(
    app: &tauri::AppHandle,
    prefix: &'static str,
    package: String,
    result: Result<(), String>,
) -> Result<(), String> {
    match result {
        Ok(()) => {
            let _ = app.emit(
                &format!("{prefix}-complete"),
                OpResult { package, success: true },
            );
            Ok(())
        }
        Err(e) => {
            let _ = app.emit(
                &format!("{prefix}-complete"),
                OpResult { package, success: false },
            );
            Err(e)
        }
    }
}

fn main() {
    let backends: Vec<BackendSlot> = Backend::detect_all()
        .into_iter()
        .map(|backend| BackendSlot {
            backend,
            op_lock: Mutex::new(()),
        })
        .collect();

    let state = Arc::new(AppState { backends });

    tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_backends,
            search_packages,
            list_installed_packages,
            check_updates,
            install_package,
            remove_package,
            update_package,
            update_all_packages,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
