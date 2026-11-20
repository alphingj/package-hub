/**
 * View renderers for package-hub.
 * Each view returns a DOM element and is given access to shared state + API callbacks.
 */

import { state, createAppCard, createEmptyState, createLoadingState, renderStatusBanner, escapeHtml } from './ui.js';
import {
  searchPackages,
  listInstalledPackages,
  checkUpdates,
  installPackage,
  removePackage,
  updateAllPackages,
} from './api.js';

/**
 * Browse view: search + grid of available packages.
 */
export function renderBrowse(container) {
  container.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6';

  const title = document.createElement('h1');
  title.className = 'text-2xl font-bold text-neutral-900 dark:text-neutral-100';
  title.textContent = 'Browse';

  const searchBox = document.createElement('div');
  searchBox.className = 'flex-1 lg:max-w-md relative';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search apps…';
  searchInput.className = 'input pl-10';
  searchInput.value = state.searchQuery;
  const searchIcon = document.createElement('div');
  searchIcon.className = 'absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400';
  searchIcon.textContent = '🔍';
  searchBox.appendChild(searchIcon);
  searchBox.appendChild(searchInput);

  header.appendChild(title);
  header.appendChild(searchBox);
  container.appendChild(header);

  // Backend selector (if multiple)
  const backendBar = document.createElement('div');
  backendBar.className = 'flex gap-2 mb-6 flex-wrap';
  const allBtn = document.createElement('button');
  allBtn.className = `btn-ghost px-3 py-1.5 text-xs ${state.activeBackend === null ? 'bg-accent-600 text-white' : ''}`;
  allBtn.textContent = 'All sources';
  allBtn.onclick = () => {
    state.activeBackend = null;
    renderBrowse(container);
  };
  backendBar.appendChild(allBtn);

  state.backends.forEach((b) => {
    const btn = document.createElement('button');
    btn.className = `btn-ghost px-3 py-1.5 text-xs ${
      state.activeBackend === b.source ? 'bg-accent-600 text-white' : ''
    }`;
    btn.textContent = b.label;
    btn.onclick = () => {
      state.activeBackend = b.source;
      renderBrowse(container);
    };
    backendBar.appendChild(btn);
  });
  container.appendChild(backendBar);

  // Content area
  const content = document.createElement('div');
  content.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4';
  container.appendChild(content);

  // Load packages
  async function load() {
    content.innerHTML = '';
    content.appendChild(createLoadingState());

    try {
      const pkgs = await searchPackages(state.searchQuery);
      let filtered = pkgs;
      if (state.activeBackend) {
        filtered = pkgs.filter((p) => p.source === state.activeBackend);
      }

      content.innerHTML = '';
      if (filtered.length === 0) {
        content.appendChild(
          createEmptyState(
            '📦',
            'No packages found',
            'Try a different search term or source.'
          )
        );
        return;
      }

      // Show not-installed packages primarily, but include installed ones too
      filtered.forEach((pkg) => {
        const card = createAppCard(
          pkg,
          async (source, name) => {
            await installPackage(source, name);
          },
          async (source, name) => {
            await removePackage(source, name);
          },
          async (source) => {
            await updateAllPackages(source);
          }
        );
        content.appendChild(card);
      });
    } catch (err) {
      content.innerHTML = '';
      content.appendChild(
        createEmptyState(
          '⚠️',
          'Search failed',
          escapeHtml(err.message || String(err))
        )
      );
    }
  }

  // Search input handler with debounce
  let debounceTimer;
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(load, 300);
  });

  load();
}

/**
 * Installed view: list of installed packages with remove buttons.
 */
export function renderInstalled(container) {
  container.innerHTML = '';

  const header = document.createElement('h1');
  header.className = 'text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-6';
  header.textContent = 'Installed';
  container.appendChild(header);

  const content = document.createElement('div');
  content.className = 'flex flex-col gap-2';
  container.appendChild(content);

  async function load() {
    content.innerHTML = '';
    content.appendChild(createLoadingState());

    try {
      const pkgs = await listInstalledPackages();
      state.installed = pkgs;

      content.innerHTML = '';
      if (pkgs.length === 0) {
        content.appendChild(
          createEmptyState(
            '📦',
            'No packages installed',
            'Install apps from the Browse view.'
          )
        );
        return;
      }

      // Sort by source then name
      pkgs.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));

      pkgs.forEach((pkg) => {
        const row = document.createElement('div');
        row.className = 'app-card flex flex-col md:flex-row md:items-center justify-between gap-3';

        const info = document.createElement('div');
        info.className = 'flex flex-col md:flex-row md:items-center gap-3';

        const icon = document.createElement('div');
        icon.className = 'w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400 shrink-0';
        icon.textContent = pkg.name.charAt(0).toUpperCase();

        const text = document.createElement('div');
        text.className = 'flex-1 min-w-0';
        const nameEl = document.createElement('div');
        nameEl.className = 'text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate';
        nameEl.textContent = escapeHtml(pkg.name);
        const metaEl = document.createElement('div');
        metaEl.className = 'text-xs text-neutral-500 dark:text-neutral-400';
        metaEl.textContent = `${pkg.version ? `v${escapeHtml(pkg.version)}` + '  •  ' : ''}${sourceLabel(pkg.source)}`;
        text.appendChild(nameEl);
        text.appendChild(metaEl);

        info.appendChild(icon);
        info.appendChild(text);

        const actions = document.createElement('div');
        actions.className = 'flex gap-2';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-danger';
        removeBtn.textContent = 'Remove';
        removeBtn.disabled = state.installing.has(pkg.name);
        removeBtn.onclick = async () => {
          if (state.installing.has(pkg.name)) return;
          if (!confirm(`Remove "${escapeHtml(pkg.name)}"?`)) return;
          state.installing.add(pkg.name);
          removeBtn.disabled = true;
          removeBtn.textContent = 'Removing...';
          try {
            await removePackage(pkg.source, pkg.name);
            showStatus('success', `"${escapeHtml(pkg.name)}" removed`);
            load(); // refresh
          } catch (err) {
            showStatus('error', `Remove failed: ${escapeHtml(err.message || String(err))}`);
          } finally {
            state.installing.delete(pkg.name);
            removeBtn.disabled = false;
            removeBtn.textContent = 'Remove';
          }
        };

        actions.appendChild(removeBtn);
        row.appendChild(info);
        row.appendChild(actions);

        content.appendChild(row);
      });
    } catch (err) {
      content.innerHTML = '';
      content.appendChild(
        createEmptyState('⚠️', 'Load failed', escapeHtml(err.message || String(err)))
      );
    }
  }

  load();
}

/**
 * Updates view: pending updates with an "Update all" button per backend.
 */
export function renderUpdates(container) {
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 mb-6';
  const title = document.createElement('h1');
  title.className = 'text-2xl font-bold text-neutral-900 dark:text-neutral-100';
  title.textContent = 'Updates';
  header.appendChild(title);
  container.appendChild(header);

  const content = document.createElement('div');
  content.className = 'flex flex-col gap-4';
  container.appendChild(content);

  async function load() {
    content.innerHTML = '';
    content.appendChild(createLoadingState());

    try {
      const updates = await checkUpdates();
      state.updates = updates;

      content.innerHTML = '';
      if (updates.length === 0) {
        content.appendChild(
          createEmptyState(
            '✅',
            'Your system is up to date',
            'No packages have available updates.'
          )
        );
        return;
      }

      // Group by source
      const bySource = {};
      updates.forEach((u) => {
        if (!bySource[u.source]) bySource[u.source] = [];
        bySource[u.source].push(u);
      });

      Object.entries(bySource).forEach(([source, pkgs]) => {
        const section = document.createElement('div');
        section.className = 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4';

        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'flex items-center justify-between mb-3';
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'text-sm font-medium text-neutral-900 dark:text-neutral-100 uppercase tracking-wider';
        sourceLabel.textContent = sourceLabel(source);
        const countLabel = document.createElement('span');
        countLabel.className = 'text-xs text-neutral-500 dark:text-neutral-400';
        countLabel.textContent = `${pkgs.length} update${pkgs.length !== 1 ? 's' : ''}`;
        sectionHeader.appendChild(sourceLabel);
        sectionHeader.appendChild(countLabel);

        const list = document.createElement('div');
        list.className = 'flex flex-col gap-2 mb-3';

        pkgs.forEach((pkg) => {
          const row = document.createElement('div');
          row.className = 'flex items-center justify-between gap-3 bg-neutral-50 dark:bg-neutral-800/50 p-3 rounded-lg';
          const name = document.createElement('span');
          name.className = 'text-sm text-neutral-800 dark:text-neutral-200';
          name.textContent = escapeHtml(pkg.name);
          const version = document.createElement('span');
          version.className = 'text-xs font-mono text-neutral-500 dark:text-neutral-400';
          version.textContent = pkg.version ? `v${escapeHtml(pkg.version)}` : '';
          const updateBtn = document.createElement('button');
          updateBtn.className = 'btn-primary px-3 py-1.5 text-xs';
          updateBtn.textContent = 'Update';
          updateBtn.disabled = state.installing.has(pkg.name);
          updateBtn.onclick = async () => {
            if (state.installing.has(pkg.name)) return;
            state.installing.add(pkg.name);
            updateBtn.disabled = true;
            updateBtn.textContent = 'Updating...';
            try {
              await updateAllPackages(source);
              showStatus('success', `Updates applied via ${sourceLabel(source)}`);
              load();
            } catch (err) {
              showStatus('error', `Update failed: ${escapeHtml(err.message || String(err))}`);
            } finally {
              state.installing.delete(pkg.name);
              updateBtn.disabled = false;
              updateBtn.textContent = 'Update';
            }
          };
          row.appendChild(name);
          row.appendChild(version);
          row.appendChild(updateBtn);
          list.appendChild(row);
        });

        const updateAllBtn = document.createElement('button');
        updateAllBtn.className = 'btn-ghost w-full';
        updateAllBtn.textContent = `Update all ${pkgs.length} ${sourceLabel(source)} packages`;
        updateAllBtn.disabled = state.installing.has(`__all_${source}`);
        updateAllBtn.onclick = async () => {
          if (state.installing.has(`__all_${source}`)) return;
          state.installing.add(`__all_${source}`);
          updateAllBtn.disabled = true;
          updateAllBtn.textContent = 'Updating all...';
          try {
            await updateAllPackages(source);
            showStatus('success', `All ${sourceLabel(source)} updates applied`);
            load();
          } catch (err) {
            showStatus('error', `Update failed: ${escapeHtml(err.message || String(err))}`);
          } finally {
            state.installing.delete(`__all_${source}`);
            updateAllBtn.disabled = false;
            updateAllBtn.textContent = `Update all ${pkgs.length} ${sourceLabel(source)} packages`;
          }
        };

        section.appendChild(sectionHeader);
        section.appendChild(list);
        section.appendChild(updateAllBtn);
        content.appendChild(section);
      });
    } catch (err) {
      content.innerHTML = '';
      content.appendChild(
        createEmptyState('⚠️', 'Load failed', escapeHtml(err.message || String(err)))
      );
    }
  }

  load();
}

/**
 * Settings view: theme toggle, backend info, check for updates.
 */
export function renderSettings(container) {
  container.innerHTML = '';

  const header = document.createElement('h1');
  header.className = 'text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-6';
  header.textContent = 'Settings';
  container.appendChild(header);

  // Theme section
  const themeSection = document.createElement('div');
  themeSection.className = 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 mb-6';
  const themeTitle = document.createElement('h2');
  themeTitle.className = 'text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-3';
  themeTitle.textContent = 'Appearance';
  themeSection.appendChild(themeTitle);

  const themeRow = document.createElement('div');
  themeRow.className = 'flex items-center gap-3';
  const themeLabel = document.createElement('span');
  themeLabel.className = 'text-sm text-neutral-700 dark:text-neutral-300';
  themeLabel.textContent = 'Theme';
  const themeSelect = document.createElement('select');
  themeSelect.className = 'input';
  ['light', 'dark', 'system'].forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    if (t === state.theme) opt.selected = true;
    themeSelect.appendChild(opt);
  });
  themeSelect.onchange = (e) => {
    state.theme = e.target.value;
    applyTheme(state.theme);
  };
  themeRow.appendChild(themeLabel);
  themeRow.appendChild(themeSelect);
  themeSection.appendChild(themeRow);
  container.appendChild(themeSection);

  // Backends section
  const backendSection = document.createElement('div');
  backendSection.className = 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 mb-6';
  const backendTitle = document.createElement('h2');
  backendTitle.className = 'text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-3';
  backendTitle.textContent = 'Package Sources';
  backendSection.appendChild(backendTitle);

  if (state.backends.length === 0) {
    backendSection.appendChild(
      createEmptyState('🔍', 'No package managers detected', 'Supported: apt, dnf, pacman, zypper, flatpak')
    );
  } else {
    const list = document.createElement('ul');
    list.className = 'divide-y divide-neutral-100 dark:divide-neutral-800';
    state.backends.forEach((b) => {
      const item = document.createElement('li');
      item.className = 'flex items-center justify-between py-3';
      const info = document.createElement('div');
      const name = document.createElement('span');
      name.className = 'text-sm font-medium text-neutral-900 dark:text-neutral-100';
      name.textContent = b.label;
      const src = document.createElement('span');
      src.className = 'text-xs font-mono text-neutral-500 dark:text-neutral-400';
      src.textContent = b.source;
      info.appendChild(name);
      info.appendChild(src);
      const status = document.createElement('span');
      status.className = 'badge-installed text-xs';
      status.textContent = 'Available';
      item.appendChild(info);
      item.appendChild(status);
      list.appendChild(item);
    });
    backendSection.appendChild(list);
  }
  container.appendChild(backendSection);

  // Actions
  const actionsSection = document.createElement('div');
  actionsSection.className = 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6';
  const actionsTitle = document.createElement('h2');
  actionsTitle.className = 'text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-3';
  actionsTitle.textContent = 'Maintenance';
  actionsSection.appendChild(actionsTitle);

  const checkBtn = document.createElement('button');
  checkBtn.className = 'btn-primary';
  checkBtn.textContent = 'Check for updates';
  checkBtn.onclick = async () => {
    checkBtn.disabled = true;
    checkBtn.textContent = 'Checking...';
    try {
      await checkUpdates();
      showStatus('success', 'Update check complete');
    } catch (err) {
      showStatus('error', `Check failed: ${escapeHtml(err.message || String(err))}`);
    } finally {
      checkBtn.disabled = false;
      checkBtn.textContent = 'Check for updates';
    }
  };
  actionsSection.appendChild(checkBtn);
  container.appendChild(actionsSection);
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    root.classList.toggle('dark', system === 'dark');
  } else {
    root.classList.toggle('dark', theme === 'dark');
  }
}
