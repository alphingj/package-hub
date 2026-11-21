/**
 * package-hub views
 * Browse, Installed, Updates, Settings.
 */

import {
  state, showToast, applyTheme, escapeHtml,
} from './ui.js';
import {
  el, createAppCard, createAppRow,
  createEmptyState, createLoadingState, createDetailModal,
  createSourceErrors, sourceLabel,
} from './components.js';
import {
  searchPackages, listInstalledPackages, checkUpdates,
  installPackage, removePackage, updatePackage, updateAllPackages,
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
    [['vlc', 'mpv', 'player', 'video', 'audio', 'music', 'sound', 'spotify', 'radio', 'podcast', 'audacity'], 'media'],
    [['gnome', 'kde', 'settings', 'manager', 'system', 'kernel', 'driver', 'firmware', 'tweak', 'utility', 'tool', 'admin', 'config'], 'system'],
    [['geogebra', 'scratch', 'education', 'learn', 'teach', 'kid', 'student', 'school', 'math'], 'edu'],
  ];
  for (const [keywords, cat] of rules) {
    if (keywords.some((k) => haystack.includes(k))) return cat;
  }
  return 'system';
}

/** Decorate a copy of the package — never mutate shared objects. */
function withCategory(pkg) {
  return { ...pkg, category: pkg.category || guessCategory(pkg.name, pkg.description || '') };
}

const MAX_RESULTS = 60;

/* Module-level search cache — survives view re-renders (e.g. after a
 * package change refresh), so returning to Browse is instant for
 * recent queries. Oldest entry evicted past 20. */
const searchCache = new Map();

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

  /* Search (min 2 chars before we hit the backends) */
  const searchWrap = el('div', 'search-wrap');
  searchWrap.innerHTML = `
    <span class="search-icon">🔍</span>
    <input class="search-input" type="text" placeholder="Search apps (min 2 characters)…" aria-label="Search apps">
  `;
  const searchInput = searchWrap.querySelector('.search-input');
  searchInput.value = state.searchQuery;
  page.appendChild(searchWrap);

  /* Source filter chips */
  const sourceBar = el('div', 'cat-bar');
  const sourceChips = [];
  const sourceOptions = [['All sources', null], ...state.backends.map((b) => [b.label, b.source])];
  sourceOptions.forEach(([label, src]) => {
    const chip = el('button', `cat-chip ${state.activeSource === src ? 'active' : ''}`);
    chip.textContent = label;
    chip.onclick = () => {
      state.activeSource = src;
      sourceChips.forEach(({ chip: c, src: s }) => c.classList.toggle('active', state.activeSource === s));
      load();
    };
    sourceChips.push({ chip, src });
    sourceBar.appendChild(chip);
  });
  page.appendChild(sourceBar);

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
  const catChips = [];
  cats.forEach(([label, cat]) => {
    const chip = el('button', `cat-chip ${state.activeCategory === cat ? 'active' : ''}`);
    const dot = el('span', 'chip-dot');
    dot.style.background = cat ? `var(--cat-${cat})` : 'var(--text-muted)';
    chip.append(dot, document.createTextNode(label));
    chip.onclick = () => {
      state.activeCategory = cat;
      catChips.forEach(({ chip: c, cat: k }) => c.classList.toggle('active', state.activeCategory === k));
      load();
    };
    catChips.push({ chip, cat });
    catBar.appendChild(chip);
  });
  page.appendChild(catBar);

  /* Error banner + results */
  const errorSlot = el('div');
  page.appendChild(errorSlot);

  const results = el('div', 'apps-grid');
  page.appendChild(results);
  container.appendChild(page);

  /* Search result cache is module-level (searchCache) so it survives
   * view re-renders. */
  let debounceTimer;
  let seq = 0; // guard against out-of-order async responses

  async function load() {
    const query = state.searchQuery.trim();
    const mySeq = ++seq;

    results.innerHTML = '';

    if (query.length < 2) {
      errorSlot.innerHTML = '';
      results.appendChild(
        createEmptyState(
          '🔍',
          'Search to get started',
          'Type at least 2 characters to search your package sources.',
        ),
      );
      return;
    }

    let entry = searchCache.get(query);
    if (!entry) {
      results.appendChild(createLoadingState());
      try {
        const payload = await searchPackages(query);
        entry = payload;
        searchCache.set(query, entry);
        if (searchCache.size > 20) {
          searchCache.delete(searchCache.keys().next().value);
        }
      } catch (err) {
        if (mySeq !== seq) return;
        results.innerHTML = '';
        results.appendChild(createEmptyState('⚠️', 'Search failed', String(err)));
        return;
      }
    }

    if (mySeq !== seq) return; // stale response, a newer search is running

    errorSlot.innerHTML = '';
    const warn = createSourceErrors(entry.errors);
    if (warn) errorSlot.appendChild(warn);

    let pkgs = entry.results.map(withCategory);
    if (state.activeSource) {
      pkgs = pkgs.filter((p) => p.source === state.activeSource);
    }
    if (state.activeCategory) {
      pkgs = pkgs.filter((p) => p.category === state.activeCategory);
    }

    results.innerHTML = '';
    if (pkgs.length === 0) {
      results.appendChild(
        createEmptyState(
          '📦',
          'No packages found',
          'Try a different search term, source, or category.',
          'Clear search',
          () => {
            state.searchQuery = '';
            searchInput.value = '';
            searchInput.focus();
            load();
          },
        ),
      );
      return;
    }

    const shown = pkgs.slice(0, MAX_RESULTS);
    shown.forEach((pkg) => {
      const card = createAppCard(pkg, {
        onInstall: (source, name) => installPackage(source, name),
        onRemove: (source, name) => removePackage(source, name),
        onDetail: (p) => createDetailModal(p, {
          onInstall: (s, n) => installPackage(s, n),
          onRemove: (s, n) => removePackage(s, n),
          onUpdate: (s, n) => updatePackage(s, n),
        }),
      });
      results.appendChild(card);
    });

    if (pkgs.length > MAX_RESULTS) {
      const note = el('p', 'results-note');
      note.textContent = `Showing ${MAX_RESULTS} of ${pkgs.length} results — refine your search to see more.`;
      results.appendChild(note);
    }
  }

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(load, 250);
  });

  load();
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

  const errorSlot = el('div');
  page.appendChild(errorSlot);

  const list = el('div', 'app-list');
  page.appendChild(list);
  container.appendChild(page);

  async function load() {
    list.innerHTML = '';
    list.appendChild(createLoadingState());

    let payload;
    try {
      payload = await listInstalledPackages();
    } catch (err) {
      list.innerHTML = '';
      list.appendChild(createEmptyState('⚠️', 'Load failed', String(err)));
      return;
    }

    errorSlot.innerHTML = '';
    const warn = createSourceErrors(payload.errors);
    if (warn) errorSlot.appendChild(warn);

    const pkgs = payload.results;
    state.installed = pkgs;

    list.innerHTML = '';
    if (pkgs.length === 0) {
      list.appendChild(
        createEmptyState('📦', 'Nothing installed yet', 'Install apps from Browse and they’ll appear here.'),
      );
      return;
    }

    const sorted = [...pkgs].sort((a, b) => a.name.localeCompare(b.name));
    const frag = document.createDocumentFragment();
    sorted.forEach((pkg) => {
      frag.appendChild(
        createAppRow(withCategory(pkg), {
          onRemove: (s, n) => removePackage(s, n),
          onUpdate: (s, n) => updatePackage(s, n),
          onUpdateAll: (s) => updateAllPackages(s),
        }),
      );
    });
    list.appendChild(frag);
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

  const errorSlot = el('div');
  page.appendChild(errorSlot);

  const list = el('div', 'app-list');
  page.appendChild(list);
  container.appendChild(page);

  async function load() {
    list.innerHTML = '';
    list.appendChild(createLoadingState());

    let payload;
    try {
      payload = await checkUpdates();
    } catch (err) {
      list.innerHTML = '';
      list.appendChild(createEmptyState('⚠️', 'Load failed', String(err)));
      return;
    }

    errorSlot.innerHTML = '';
    const warn = createSourceErrors(payload.errors);
    if (warn) errorSlot.appendChild(warn);

    const updates = payload.results;
    state.updates = updates;

    list.innerHTML = '';
    if (updates.length === 0) {
      list.appendChild(
        createEmptyState('✅', 'Your system is up to date', 'No packages have available updates.'),
      );
      return;
    }

    const bySource = new Map();
    updates.forEach((u) => {
      if (!bySource.has(u.source)) bySource.set(u.source, []);
      bySource.get(u.source).push(u);
    });

    bySource.forEach((pkgs, source) => {
      const section = el('div', 'update-section');

      const head = el('div', 'update-section-head');
      const sourceEl = el('span', 'update-source', sourceLabel(source));
      const count = el('span', 'update-count');
      count.textContent = `${pkgs.length} update${pkgs.length !== 1 ? 's' : ''}`;
      head.append(sourceEl, count);

      const rows = el('div', 'update-rows');
      pkgs.forEach((pkg) => {
        rows.appendChild(
          createAppRow(withCategory(pkg), {
            onRemove: (s, n) => removePackage(s, n),
            onUpdate: (s, n) => updatePackage(s, n),
            onUpdateAll: (s) => updateAllPackages(s),
          }),
        );
      });

      const updateAll = el('button', 'btn-primary update-all-btn');
      updateAll.textContent = `Update all ${pkgs.length} ${sourceLabel(source)} package${pkgs.length !== 1 ? 's' : ''}`;
      const allKey = `all:${source}`;
      updateAll.onclick = () => {
        if (state.installing.has(allKey)) return;
        state.installing.add(allKey);
        const orig = updateAll.textContent;
        updateAll.disabled = true;
        updateAll.textContent = 'Updating all…';
        updateAllPackages(source)
          .then(() => {
            showToast(`All ${sourceLabel(source)} updates applied`, 'success');
          })
          .catch((err) => {
            showToast(`Update failed: ${String(err)}`, 'error');
          })
          .finally(() => {
            state.installing.delete(allKey);
            updateAll.disabled = false;
            updateAll.textContent = orig;
            load();
          });
      };

      section.append(head, rows, updateAll);
      list.appendChild(section);
    });
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
  const themeTitle = el('h3', 'settings-card-title', 'Appearance');
  const themeRow = el('div', 'settings-row');
  const themeLabel = el('label', 'settings-label', 'Theme');
  themeLabel.htmlFor = 'theme-select';
  const themeSelect = el('select', 'settings-select');
  themeSelect.id = 'theme-select';
  ['system', 'light', 'dark'].forEach((t) => {
    const opt = el('option');
    opt.value = t;
    opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    themeSelect.appendChild(opt);
  });
  themeSelect.value = state.theme;
  themeSelect.onchange = (e) => applyTheme(e.target.value);
  themeRow.append(themeLabel, themeSelect);
  themeCard.append(themeTitle, themeRow);
  page.appendChild(themeCard);

  /* Sources card */
  const sourcesCard = el('div', 'settings-card');
  const sourcesTitle = el('h3', 'settings-card-title', 'Package Sources');
  const sourcesList = el('div', 'settings-list');
  if (state.backends.length === 0) {
    sourcesList.appendChild(el('p', 'empty-note', 'No package managers detected.'));
  } else {
    state.backends.forEach((b) => {
      const item = el('div', 'settings-source-item');
      const nameEl = el('span', 'settings-source-name');
      nameEl.textContent = `${b.label} (${b.source})`;
      const badge = el('span', 'badge badge-installed', 'Available');
      item.append(nameEl, badge);
      sourcesList.appendChild(item);
    });
  }
  sourcesCard.append(sourcesTitle, sourcesList);
  page.appendChild(sourcesCard);

  /* Maintenance card */
  const actionsCard = el('div', 'settings-card');
  const actionsTitle = el('h3', 'settings-card-title', 'Maintenance');
  const actionsRow = el('div', 'settings-actions');
  const checkBtn = el('button', 'btn-primary settings-btn', 'Check for updates');
  checkBtn.onclick = async () => {
    checkBtn.disabled = true;
    checkBtn.textContent = 'Checking…';
    try {
      const payload = await checkUpdates();
      const failed = payload.errors.length;
      if (failed > 0) {
        showToast(`Update check done; ${failed} source${failed !== 1 ? 's' : ''} unavailable`, 'info');
      } else {
        showToast(`Update check done — ${payload.results.length} update${payload.results.length !== 1 ? 's' : ''} found`, 'success');
      }
    } catch (err) {
      showToast(`Check failed: ${String(err)}`, 'error');
    } finally {
      checkBtn.disabled = false;
      checkBtn.textContent = 'Check for updates';
    }
  };
  actionsRow.appendChild(checkBtn);
  actionsCard.append(actionsTitle, actionsRow);
  page.appendChild(actionsCard);

  container.appendChild(page);
}
