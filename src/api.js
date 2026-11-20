import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Thin wrapper around Tauri `invoke` calls.
 * Each function returns a Promise that resolves to the backend's return value.
 */

export async function detectBackends() {
  return invoke('detect_backends');
}

export async function searchPackages(query) {
  return invoke('search_packages', { query });
}

export async function listInstalledPackages() {
  return invoke('list_installed_packages');
}

export async function checkUpdates() {
  return invoke('check_updates');
}

export async function installPackage(source, packageName) {
  return invoke('install_package', { source, package: packageName });
}

export async function removePackage(source, packageName) {
  return invoke('remove_package', { source, package: packageName });
}

export async function updateAllPackages(source) {
  return invoke('update_all_packages', { source });
}

/**
 * Listen for streaming install output from the backend.
 * Callback receives { package, line }.
 */
export function onInstallOutput(callback) {
  return listen('install-output', (event) => {
    callback(event.payload);
  });
}

/**
 * Listen for streaming remove output.
 */
export function onRemoveOutput(callback) {
  return listen('remove-output', (event) => {
    callback(event.payload);
  });
}

/**
 * Listen for streaming update output.
 */
export function onUpdateOutput(callback) {
  return listen('update-output', (event) => {
    callback(event.payload);
  });
}

/**
 * Listen for operation completion events.
 * Event names: 'install-complete', 'remove-complete', 'update-complete'
 */
export function onOperationComplete(eventName, callback) {
  return listen(eventName, (event) => {
    callback(event.payload);
  });
}
