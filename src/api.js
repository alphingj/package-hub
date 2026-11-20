import { invoke } from '@tauri-apps/api/core';

/**
 * Thin wrapper around Tauri `invoke` calls.
 * Read commands return { results, errors } so one failing source never
 * blanks the view.
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

/** Update a single package to its newest version. */
export async function updatePackage(source, packageName) {
  return invoke('update_package', { source, package: packageName });
}

/** Update every package from one source. */
export async function updateAllPackages(source) {
  return invoke('update_all_packages', { source });
}
