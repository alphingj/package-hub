/**
 * UI helpers and component rendering for package-hub.
 * Follows the antislop rules: specific labels, real states, no dead controls.
 */

export const state = {
  theme: 'light',
  backends: [],
  packages: [],
  installed: [],
  updates: [],
  activeView: 'browse',
  activeBackend: null,
  searchQuery: '',
  loading: false,
  installing: new Set(),
  statusMessage: '',
  statusType: 'info', // 'info' | 'success' | 'error'
  logLines: [],
};

/**
 * Escape HTML to prevent XSS when rendering package names/descriptions.
 */
export function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format a package source label for display.
 */
export function sourceLabel(source) {
  const map = {
    apt: 'APT',
    dnf: 'DNF',
    pacman: 'Pacman',
    zypper: 'Zypper',
    flatpak: 'Flatpak',
  };
  return map[source] || source;
}

/**
 * Status toast / banner. Shows a temporary message at the top of the view.
 */
export function showStatus(type, message) {
  state.statusType = type;
  state.statusMessage = message;
  renderStatusBanner();
  if (type !== 'error') {
    setTimeout(() => {
      state.statusMessage = '';
      renderStatusBanner();
    }, 4000);
  }
}

/**
 * Render the status banner element if a message exists.
 */
export function renderStatusBanner() {
  const banner = document.getElementById('status-banner');
  if (!banner) return;
  if (!state.statusMessage) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'block';
  banner.className = `fixed inset-x-0 top-0 px-6 py-3 text-sm font-medium text-center z-50 ${
    state.statusType === 'success'
      ? 'bg-green-100 text-green-800 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800'
      : state.statusType === 'error'
        ? 'bg-red-100 text-red-800 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800'
        : 'bg-accent-100 text-accent-800 border border-accent-200 dark:bg-accent-900/30 dark:text-accent-400 dark:border-accent-800'
  }`;
  banner.textContent = escapeHtml(state.statusMessage);
}

/**
 * Create an app card element.
 */
export function createAppCard(pkg, onInstall, onRemove, onUpdate) {
  const card = document.createElement('div');
  card.className = 'app-card';

  const isInstalled = pkg.installed;
  const hasUpdate = pkg.update_available;

  const iconDiv = document.createElement('div');
  iconDiv.className = 'w-12 h-12 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-3 text-neutral-400 shrink-0';
  iconDiv.textContent = pkg.name.charAt(0).toUpperCase();

  const nameEl = document.createElement('h3');
  nameEl.className = 'text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1';
  nameEl.textContent = escapeHtml(pkg.name);

  const versionEl = document.createElement('p');
  versionEl.className = 'text-xs text-neutral-500 dark:text-neutral-400 mb-1';
  versionEl.textContent = pkg.version ? `v${escapeHtml(pkg.version)}` : '';

  const descEl = document.createElement('p');
  descEl.className = 'text-sm text-neutral-600 dark:text-neutral-300 mb-3 line-clamp-2';
  descEl.textContent = escapeHtml(pkg.description || 'No description available');

  const sourceEl = document.createElement('span');
  sourceEl.className = 'text-xs font-mono text-neutral-400 dark:text-neutral-500 mb-3';
  sourceEl.textContent = sourceLabel(pkg.source);

  const badgeEl = document.createElement('span');
  badgeEl.className = 'badge mb-3';
  if (hasUpdate) {
    badgeEl.className = 'badge-updated';
    badgeEl.textContent = 'Update available';
  } else if (isInstalled) {
    badgeEl.className = 'badge-installed';
    badgeEl.textContent = 'Installed';
  }

  const actions = document.createElement('div');
  actions.className = 'flex gap-2 mt-auto pt-3 border-t border-neutral-100 dark:border-neutral-800';

  const installBtn = document.createElement('button');
  installBtn.className = 'btn-primary flex-1';
  installBtn.textContent = 'Install';
  installBtn.disabled = isInstalled || state.installing.has(pkg.name);
  installBtn.onclick = async () => {
    if (state.installing.has(pkg.name)) return;
    state.installing.add(pkg.name);
    installBtn.disabled = true;
    installBtn.textContent = 'Installing...';
    renderButtonStates(actions);
    try {
      await onInstall(pkg.source, pkg.name);
      showStatus('success', `"${escapeHtml(pkg.name)}" installed`);
    } catch (err) {
      showStatus('error', `Failed to install "${escapeHtml(pkg.name)}": ${escapeHtml(err.message || String(err))}`);
    } finally {
      state.installing.delete(pkg.name);
      installBtn.disabled = false;
      installBtn.textContent = 'Install';
      renderButtonStates(actions);
    }
  };

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-danger flex-1';
  removeBtn.textContent = 'Remove';
  removeBtn.disabled = !isInstalled || state.installing.has(pkg.name);
  removeBtn.onclick = async () => {
    if (state.installing.has(pkg.name)) return;
    if (!confirm(`Remove "${escapeHtml(pkg.name)}"?`)) return;
    state.installing.add(pkg.name);
    removeBtn.disabled = true;
    removeBtn.textContent = 'Removing...';
    renderButtonStates(actions);
    try {
      await onRemove(pkg.source, pkg.name);
      showStatus('success', `"${escapeHtml(pkg.name)}" removed`);
    } catch (err) {
      showStatus('error', `Failed to remove "${escapeHtml(pkg.name)}": ${escapeHtml(err.message || String(err))}`);
    } finally {
      state.installing.delete(pkg.name);
      removeBtn.disabled = false;
      removeBtn.textContent = 'Remove';
      renderButtonStates(actions);
    }
  };

  const updateBtn = document.createElement('button');
  updateBtn.className = 'btn-ghost flex-1';
  updateBtn.textContent = 'Update';
  updateBtn.disabled = !hasUpdate || state.installing.has(pkg.name);
  updateBtn.onclick = async () => {
    if (state.installing.has(pkg.name)) return;
    state.installing.add(pkg.name);
    updateBtn.disabled = true;
    updateBtn.textContent = 'Updating...';
    renderButtonStates(actions);
    try {
      // Update is per-backend: we use the package's source backend
      await import('./api.js').then(({ updateAllPackages }) => updateAllPackages(pkg.source));
      showStatus('success', `Updated via ${sourceLabel(pkg.source)}`);
    } catch (err) {
      showStatus('error', `Update failed: ${escapeHtml(err.message || String(err))}`);
    } finally {
      state.installing.delete(pkg.name);
      updateBtn.disabled = false;
      updateBtn.textContent = 'Update';
      renderButtonStates(actions);
    }
  };

  function renderButtonStates() {
    if (isInstalled) {
      actions.innerHTML = '';
      actions.appendChild(removeBtn);
      if (hasUpdate) actions.appendChild(updateBtn);
    } else {
      actions.innerHTML = '';
      actions.appendChild(installBtn);
    }
  }
  renderButtonStates();

  card.appendChild(iconDiv);
  card.appendChild(nameEl);
  card.appendChild(versionEl);
  card.appendChild(descEl);
  card.appendChild(sourceEl);
  card.appendChild(badgeEl);
  card.appendChild(actions);

  return card;
}

/**
 * Create an empty state element.
 */
export function createEmptyState(icon, title, subtitle) {
  const div = document.createElement('div');
  div.className = 'flex flex-col items-center justify-center py-20 text-neutral-500 dark:text-neutral-400';
  div.innerHTML = `
    <div class="w-16 h-16 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4 text-neutral-300 dark:text-neutral-600">
      ${icon}
    </div>
    <h3 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2">${escapeHtml(title)}</h3>
    <p class="text-sm text-neutral-500 dark:text-neutral-300 max-w-xs text-center">${escapeHtml(subtitle)}</p>
  `;
  return div;
}

/**
 * Create a loading spinner element.
 */
export function createLoadingState() {
  const div = document.createElement('div');
  div.className = 'flex flex-col items-center justify-center py-20';
  div.innerHTML = `
    <div class="w-8 h-8 border-3 border-neutral-200 border-t-accent-600 rounded-full animate-spin mb-4"></div>
    <p class="text-sm text-neutral-500 dark:text-neutral-400">Loading...</p>
  `;
  return div;
}
