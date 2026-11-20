// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::Emitter;

mod package_manager;
use package_manager::{Backend, Package};

/// Shared state: the detected backends for this machine.
struct AppState {
    backends: Mutex<Vec<Backend>>,
}

#[derive(Clone, Serialize)]
struct BackendInfo {
    label: String,
    source: String,
}

#[derive(Clone, Serialize)]
struct InstallProgress {
    package: String,
    line: String,
}

#[derive(Clone, Serialize)]
struct InstallResult {
    package: String,
    success: bool,
}

/// Detect available package managers on this machine.
#[tauri::command]
fn detect_backends(state: tauri::State<'_, AppState>) -> Result<Vec<BackendInfo>, String> {
    let backends = state.backends.lock().map_err(|e| e.to_string())?;
    Ok(backends
        .iter()
        .map(|b| BackendInfo {
            label: b.manager.label().to_string(),
            source: b.manager.label().to_lowercase(),
        })
        .collect())
}

/// Search for packages across all backends.
#[tauri::command]
fn search_packages(
    query: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Package>, String> {
    let backends = state.backends.lock().map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for backend in backends.iter() {
        let mut found = backend
            .search(&query)
            .map_err(|e| format!("{}: {}", b_label(backend), e))?;
        results.append(&mut found);
    }
    Ok(results)
}

/// List installed packages across all backends.
#[tauri::command]
fn list_installed_packages(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Package>, String> {
    let backends = state.backends.lock().map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for backend in backends.iter() {
        let mut installed = backend
            .list_installed()
            .map_err(|e| format!("{}: {}", b_label(backend), e))?;
        results.append(&mut installed);
    }
    Ok(results)
}

/// Check for available updates across all backends.
#[tauri::command]
fn check_updates(state: tauri::State<'_, AppState>) -> Result<Vec<Package>, String> {
    let backends = state.backends.lock().map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for backend in backends.iter() {
        let mut updates = backend
            .check_updates()
            .map_err(|e| format!("{}: {}", b_label(backend), e))?;
        results.append(&mut updates);
    }
    Ok(results)
}

/// Install a package via a specific backend, streaming output via Tauri events.
#[tauri::command]
async fn install_package(
    app: tauri::AppHandle,
    source: String,
    package: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let backends = state.backends.lock().map_err(|e| e.to_string())?;
    let backend = backends
        .iter()
        .find(|b| b.manager.label().to_lowercase() == source)
        .ok_or_else(|| format!("backend '{source}' not found"))?;

    let app_clone = app.clone();
    let package_clone = package.clone();
    let result = backend.install(&package, move |line| {
        let _ = app_clone.emit(
            "install-output",
            InstallProgress {
                package: package_clone.clone(),
                line: line.to_string(),
            },
        );
    });

    match result {
        Ok(()) => {
            let _ = app.emit(
                "install-complete",
                InstallResult {
                    package,
                    success: true,
                },
            );
            Ok(())
        }
        Err(e) => {
            let _ = app.emit(
                "install-complete",
                InstallResult {
                    package,
                    success: false,
                },
            );
            Err(e)
        }
    }
}

/// Remove a package via a specific backend, streaming output via Tauri events.
#[tauri::command]
async fn remove_package(
    app: tauri::AppHandle,
    source: String,
    package: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let backends = state.backends.lock().map_err(|e| e.to_string())?;
    let backend = backends
        .iter()
        .find(|b| b.manager.label().to_lowercase() == source)
        .ok_or_else(|| format!("backend '{source}' not found"))?;

    let app_clone = app.clone();
    let package_clone = package.clone();
    let result = backend.remove(&package, move |line| {
        let _ = app_clone.emit(
            "remove-output",
            InstallProgress {
                package: package_clone.clone(),
                line: line.to_string(),
            },
        );
    });

    match result {
        Ok(()) => {
            let _ = app.emit(
                "remove-complete",
                InstallResult {
                    package,
                    success: true,
                },
            );
            Ok(())
        }
        Err(e) => {
            let _ = app.emit(
                "remove-complete",
                InstallResult {
                    package,
                    success: false,
                },
            );
            Err(e)
        }
    }
}

/// Update all packages via a specific backend, streaming output via Tauri events.
#[tauri::command]
async fn update_all_packages(
    app: tauri::AppHandle,
    source: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let backends = state.backends.lock().map_err(|e| e.to_string())?;
    let backend = backends
        .iter()
        .find(|b| b.manager.label().to_lowercase() == source)
        .ok_or_else(|| format!("backend '{source}' not found"))?;

    let app_clone = app.clone();
    let result = backend.update_all(move |line| {
        let _ = app_clone.emit(
            "update-output",
            serde_json::json!({ "line": line }),
        );
    });

    match result {
        Ok(()) => {
            let _ = app.emit("update-complete", serde_json::json!({ "success": true }));
            Ok(())
        }
        Err(e) => {
            let _ = app.emit("update-complete", serde_json::json!({ "success": false, "error": e }));
            Err(e)
        }
    }
}

fn b_label(backend: &Backend) -> String {
    backend.manager.label().to_string()
}

fn main() {
    let backends = Backend::detect_all();
    let state = AppState {
        backends: Mutex::new(backends),
    };

    tauri::Builder::default()
        .manage(Arc::new(state))
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
            update_all_packages,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
