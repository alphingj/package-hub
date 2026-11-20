/**
 * package-hub views
 * Browse, Installed, Updates, Settings, Detail modal.
 */

import {
  state, showToast, applyTheme, escapeHtml,
} from './ui.js';
import {
  el, btn, avatar, createAppCard, createAppRow,
  createEmptyState, createLoadingState, createDetailModal,
  sourceLabel,
} from './components.js';
import {
  searchPackages, listInstalledPackages, checkUpdates,
  installPackage, removePackage, updateAllPackages,
} from './api.js';

/* ── keyword → category guesser ───────────────────────────────────────── */

function guessCategory(name, description = '') {
  const haystack = `${name} ${description}`.toLowerCase();
  const rules = [
    [['git', 'gcc', 'node', 'npm', 'python', 'rust', 'cargo', 'golang', 'jdk', 'java', 'sdk', 'make', 'cmake', 'build', 'compile', 'dev', 'code', 'vim', 'emacs', 'ide', 'lint'], 'dev'],
    [['gimp', 'inkscape', 'blender', 'krita', 'draw', 'image', 'photo', 'graphic', 'illust', 'paint', 'design', 'digikam'], 'graphics'],
    [['game', 'steam', 'minecraft', 'lutris', 'wine', 'play', 'games', 'tetris', 'frozen'], 'games'],
    [['libreoffice', 'writer', 'calc', 'impress', 'office', 'word', 'excel', 'document', 'spreadsheet', 'presentation'], 'office'],
    [['firefox', 'chrome', 'chromium', 'browser', 'thunderbird', 'email', 'mail', 'chat', 'discord', 'slack', 'signal', 'telegram'], 'internet'],
    [['vlc', 'mpv', 'player', 'video', 'audio', 'music', 'sound', 'spotify', 'radio', 'sound', 'podcast', 'audacity'], 'media'],
    [['gnome', 'kde', 'settings', 'manager', 'system', 'kernel', 'driver', 'firmware', 'tweak', 'utility', 'tool', 'admin', 'config'], 'system'],
    [['geogebra', 'scratch', 'education', 'learn', 'teach', 'kid', 'student', 'school', 'math'], 'edu'],
  ];
  for (const [keywords, cat] of rules) {
    if (keywords.some(k => haystack.includes(k))) return cat;
  }
  return 'system';
}

/* ── shared render helpers ────────────────────────────────────────────── */

function attachInstallLog() {
  const el = document.getElementById('install-log');
  if (el) el.innerHTML = '';
}

function appendInstallLog(line) {
  const el = document.getElementById('install-log');
  if (!el) return;
  const d = document.createElement('div');
  d.className = 'log-line';
  d.textContent = line;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}

/* ── Browse view ──────────────────────────────────────────────────────── */

export function renderBrowse(container) {
  container.innerHTML = '';

  const page = el('div', 'view');

  /* Header */
  const header = el('div', 'page-header');
  header.innerHTML = `
    <span class="page-eyebrow">Explore</span>
    <h1 class="page-title">Browse apps</h1>
    <p class="page-sub">Search, discover, and install software from your configured package sources.</p>
  `;
  page.appendChild(header);

  /* Search */
  const searchWrap = el('div', 'search-wrap');
  searchWrap.innerHTML = `
    <span class="search-icon">🔍</span>
    <input class="search-input" type="text" placeholder="Search apps…" value="${escapeHtml(state.searchQuery)}">
  `;
  const searchInput = searchWrap.querySelector('.search-input');
  page.appendChild(searchWrap);

  /* Category chips */
  const cats = [
    ['All', null],
    ['Development', 'dev'],
    ['Graphics', 'graphics'],
    ['Games', 'games'],
    ['Office', 'office'],
    ['Internet', 'internet'],
    ['System', 'system'],
    ['Media', 'media'],
    ['Education', 'edu'],
  ];
  const catBar = el('div', 'cat-bar');
  cats.forEach(([label, cat]) => {
    const chip = el('button', `cat-chip ${state.activeCategory === cat ? 'active' : ''}`);
    chip.innerHTML = `<span class="chip-dot" style="background: ${cat ? `var(--cat-${cat})` : 'var(--text-muted)'}"></span>${escapeHtml(label)}`;
    chip.onclick = () => {
      state.activeCategory = cat;
      renderBrowse(container);
    };
    catBar.appendChild(chip);
  });
  page.appendChild(catBar);

  /* Results */
  const results = el('div', 'apps-grid');
  page.appendChild(results);

  let debounceTimer;
  async function load() {
    results.innerHTML = '';
    results.appendChild(createLoadingState());

    try {
      const pkgs = await searchPackages(state.searchQuery);
      const filtered = pkgs.filter(p => {
        if (!state.activeCategory) return true;
        return guessCategory(p.name, p.description) === state.activeCategory;
      });

      results.innerHTML = '';
      if (filtered.length === 0) {
        results.appendChild(
          createEmptyState(
            '📦',
            'No packages found',
            'Try a different search term or category.',
            'Clear search',
            () => {
              state.searchQuery = '';
              searchInput.value = '';
              renderBrowse(container);
            }
          )
        );
        return;
      }

      filtered.forEach(pkg => {
        pkg.category = pkg.category || guessCategory(pkg.name, pkg.description);
        const card = createAppCard(pkg, {
          onInstall: (source, name) => installPackage(source, name),
          onRemove: (source, name) => removePackage(source, name),
          onUpdate: (source) => updateAllPackages(source),
          onDetail: (p) => {
            if (p) createDetailModal(p, {
              onInstall: (source, name) => installPackage(source, name),
              onRemove: (source, name) => removePackage(source, name),
              onUpdate: (source) => updateAllPackages(source),
            });
          },
        });
        results.appendChild(card);
      });
    } catch (err) {
      results.innerHTML = '';
      results.appendChild(createEmptyState('⚠️', 'Search failed', escapeHtml(String(err))));
    }
  }

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(load, 200);
  });

  load();
  container.appendChild(page);
}

/* ── Installed view ──────────────────────────────────────────────────── */

export function renderInstalled(container) {
  container.innerHTML = '';

  const page = el('div', 'view');

  const header = el('div', 'page-header');
  header.innerHTML = `
    <span class="page-eyebrow">Library</span>
    <h1 class="page-title">Installed apps</h1>
    <p class="page-sub">Manage software already on your system.</p>
  `;
  page.appendChild(header);

  const list = el('div', 'app-list');
  page.appendChild(list);
  container.appendChild(page);

  async function load() {
    list.innerHTML = '';
    list.appendChild(createLoadingState());

    try {
      const pkgs = await listInstalledPackages();
      state.installed = pkgs;

      list.innerHTML = '';
      if (pkgs.length === 0) {
        list.appendChild(
          createEmptyState(
            '📦',
            'Nothing installed yet',
            'Install apps from Browse and they’ll appear here.'
          )
        );
        return;
      }

      pkgs.sort((a, b) => a.name.localeCompare(b.name));
      pkgs.forEach(pkg => {
        pkg.category = pkg.category || guessCategory(pkg.name, pkg.description);
        const row = createAppRow(pkg, {
          onRemove: (source, name) => removePackage(source, name),
          onUpdate: (source) => updateAllPackages(source),
        });
        list.appendChild(row);
      });
    } catch (err) {
      list.innerHTML = '';
      list.appendChild(createEmptyState('⚠️', 'Load failed', escapeHtml(String(err))));
    }
  }

  load();
}

/* ── Updates view ────────────────────────────────────────────────────── */

export function renderUpdates(container) {
  container.innerHTML = '';

  const page = el('div', 'view');

  const header = el('div', 'page-header');
  header.innerHTML = `
    <span class="page-eyebrow">Maintenance</span>
    <h1 class="page-title">Updates</h1>
    <p class="page-sub">Keep your software up to date.</p>
  `;
  page.appendChild(header);

  const list = el('div', 'app-list');
  page.appendChild(list);
  container.appendChild(page);

  async function load() {
    list.innerHTML = '';
    list.appendChild(createLoadingState());

    try {
      const updates = await checkUpdates();
      state.updates = updates;

      list.innerHTML = '';
      if (updates.length === 0) {
        list.appendChild(
          createEmptyState(
            '✅',
            'Your system is up to date',
            'No packages have available updates.'
          )
        );
        return;
      }

      const bySource = {};
      updates.forEach(u => {
        if (!bySource[u.source]) bySource[u.source] = [];
        bySource[u.source].push(u);
      });

      Object.entries(bySource).forEach(([source, pkgs]) => {
        const section = el('div', 'update-section');
        const catColor = CAT_COLORS_MAP[source] || 'var(--text-muted)';

        const head = el('div', 'update-section-head');
        head.innerHTML = `
          <span class="update-source" style="color: ${catColor}">${sourceLabel(source)}</span>
          <span class="update-count">${pkgs.length} update${pkgs.length !== 1 ? 's' : ''}</span>
        `;

        const rows = el('div', 'update-rows');
        pkgs.forEach(pkg => {
          pkg.category = pkg.category || guessCategory(pkg.name, pkg.description);
          const row = createAppRow(pkg, {
            onRemove: (s, n) => removePackage(s, n),
            onUpdate: (s) => updateAllPackages(s),
          });
          rows.appendChild(row);
        });

        const updateAll = el('button', 'btn-primary update-all-btn', `Update all ${pkgs.length}`);
        updateAll.onclick = async () => {
          if (state.installing.has(`__all_${source}`)) return;
          try {
            state.installing.add(`__all_${source}`);
            updateAll.disabled = true;
            updateAll.textContent = 'Updating all…';
            await updateAllPackages(source);
            showToast(`All ${sourceLabel(source)} updates applied`, 'success');
            load();
          } catch (err) {
            showToast(`Update failed: ${escapeHtml(String(err))}`, 'error');
          } finally {
            state.installing.delete(`__all_${source}`);
            updateAll.disabled = false;
            updateAll.textContent = `Update all ${pkgs.length}`;
          }
        };

        section.appendChild(head);
        section.appendChild(rows);
        section.appendChild(updateAll);
        list.appendChild(section);
      });
    } catch (err) {
      list.innerHTML = '';
      list.appendChild(createEmptyState('⚠️', 'Load failed', escapeHtml(String(err))));
    }
  }

  load();
}

/* ── Settings view ───────────────────────────────────────────────────── */

export function renderSettings(container) {
  container.innerHTML = '';

  const page = el('div', 'view');

  const header = el('div', 'page-header');
  header.innerHTML = `
    <span class="page-eyebrow">Preferences</span>
    <h1 class="page-title">Settings</h1>
    <p class="page-sub">Configure package-hub.</p>
  `;
  page.appendChild(header);

  /* Theme card */
  const themeCard = el('div', 'settings-card');
  themeCard.innerHTML = `
    <h3 class="settings-card-title">Appearance</h3>
    <div class="settings-row">
      <label class="settings-label">Theme</label>
      <select class="settings-select" id="theme-select">
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  `;
  const themeSelect = themeCard.querySelector('#theme-select');
  themeSelect.value = state.theme;
  themeSelect.onchange = (e) => {
    state.theme = e.target.value;
    applyTheme(state.theme);
  };
  page.appendChild(themeCard);

  /* Sources card */
  const sourcesCard = el('div', 'settings-card');
  sourcesCard.innerHTML = `
    <h3 class="settings-card-title">Package Sources</h3>
    <div class="settings-list" id="sources-list"></div>
  `;
  const sourcesList = sourcesCard.querySelector('#sources-list');
  page.appendChild(sourcesCard);

  if (state.backends.length === 0) {
    sourcesList.innerHTML = '<p class="empty-note">No package managers detected.</p>';
  } else {
    state.backends.forEach(b => {
      const item = el('div', 'settings-source-item');
      item.innerHTML = `
        <span class="settings-source-name">${escapeHtml(b.label)}</span>
        <span class="badge badge-installed">Available</span>
      `;
      sourcesList.appendChild(item);
    });
  }

  /* Actions card */
  const actionsCard = el('div', 'settings-card');
  actionsCard.innerHTML = `
    <h3 class="settings-card-title">Maintenance</h3>
    <div class="settings-actions">
      <button class="btn-primary settings-btn" id="check-updates-btn">Check for updates</button>
    </div>
  `;
  const checkBtn = actionsCard.querySelector('#check-updates-btn');
  checkBtn.onclick = async () => {
    checkBtn.disabled = true;
    checkBtn.textContent = 'Checking…';
    try {
      await checkUpdates();
      showToast('Update check complete', 'success');
    } catch (err) {
      showToast(`Check failed: ${escapeHtml(String(err))}`, 'error');
    } finally {
      checkBtn.disabled = false;
      checkBtn.textContent = 'Check for updates';
    }
  };
  page.appendChild(actionsCard);

  container.appendChild(page);
}

/* ── category color map for source labels in updates ── */
const CAT_COLORS_MAP = {
  apt: 'var(--cat-internet)',
  dnf: 'var(--cat-dev)',
  pacman: 'var(--cat-system)',
  zypper: 'var(--cat-games)',
  flatpak: 'var(--cat-media)',
};
