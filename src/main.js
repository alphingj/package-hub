/**
 * package-hub — main application entry
 * Wires shell, navigation, Tauri commands, and event streaming.
 */

import { state, showToast, applyTheme, escapeHtml } from './ui.js';
import { renderBrowse, renderInstalled, renderUpdates, renderSettings } from './views.js';
import {
  detectBackends,
  onInstallOutput,
  onRemoveOutput,
  onUpdateOutput,
  onOperationComplete,
} from './api.js';

let contentEl = null;
let navLinks = {};
let sidebarStatus = null;
let themeBtn = null;
let refreshBtn = null;

/* ── shell ─────────────────────────────────────────────────────────────── */

function initShell() {
  document.getElementById('app').innerHTML = `
    <div class="shell">
      <header class="shell-header">
        <div class="shell-brand">
          <div class="shell-brand-mark">P</div>
          <div class="shell-brand-text">package-hub</div>
        </div>
        <div class="shell-actions">
          <button id="btn-theme" class="icon-btn" aria-label="Toggle theme" title="Theme">🌓</button>
          <button id="btn-refresh" class="icon-btn" aria-label="Refresh" title="Refresh">⟳</button>
        </div>
      </header>

      <div class="shell-sidebar">
        <div class="sidebar-scroll">
          <div class="nav-section">
            <div class="nav-section-title">Browse</div>
            <button class="nav-item active" data-view="browse">
              <span class="nav-emoji">📦</span> Browse
            </button>
            <button class="nav-item" data-view="installed">
              <span class="nav-emoji">📥</span> Installed
            </button>
            <button class="nav-item" data-view="updates">
              <span class="nav-emoji">🔄</span> Updates
            </button>
          </div>
          <div class="nav-section">
            <div class="nav-section-title">System</div>
            <button class="nav-item" data-view="settings">
              <span class="nav-emoji">⚙️</span> Settings
            </button>
          </div>
        </div>
        <div class="sidebar-footer">
          <div class="sidebar-status" id="sidebar-status">Detecting sources…</div>
          <div class="sidebar-version">package-hub 0.1.0</div>
        </div>
      </div>

      <main class="shell-main">
        <div class="view-container" id="view-container"></div>
      </main>
    </div>

    <div class="toast-container" id="toast-container"></div>
    <div id="install-log-panel" class="hidden"></div>
  `;

  contentEl = document.getElementById('view-container');
  sidebarStatus = document.getElementById('sidebar-status');
  themeBtn = document.getElementById('btn-theme');
  refreshBtn = document.getElementById('btn-refresh');

  document.querySelectorAll('[data-view]').forEach(el => {
    navLinks[el.dataset.view] = el;
  });

  Object.entries(navLinks).forEach(([view, el]) => {
    el.addEventListener('click', () => setActiveView(view));
  });

  themeBtn.addEventListener('click', () => {
    const themes = ['light', 'dark', 'system'];
    const cur = state.theme;
    const next = themes[(themes.indexOf(cur) + 1) % themes.length];
    state.theme = next;
    applyTheme(next);
    updateThemeIcon(next);
  });

  refreshBtn.addEventListener('click', () => setActiveView(state.activeView));

  applyTheme(state.theme);
  updateThemeIcon(state.theme);
}

function updateThemeIcon(theme) {
  const icons = { light: '🌙', dark: '☀️', system: '🌓' };
  themeBtn.textContent = icons[theme] || '🌓';
}

/* ── navigation ────────────────────────────────────────────────────────── */

function setActiveView(view) {
  state.activeView = view;

  Object.entries(navLinks).forEach(([v, el]) => {
    const active = v === view;
    el.classList.toggle('active', active);
    el.setAttribute('aria-current', active ? 'page' : 'false');
  });

  switch (view) {
    case 'browse': renderBrowse(contentEl); break;
    case 'installed': renderInstalled(contentEl); break;
    case 'updates': renderUpdates(contentEl); break;
    case 'settings': renderSettings(contentEl); break;
  }
}

/* ── Tauri event wiring ────────────────────────────────────────────────── */

async function wireEvents() {
  await onInstallOutput((payload) => {
    const { package: pkgName, line } = payload;
    console.log(`[install ${pkgName}] ${line}`);
  });

  await onRemoveOutput((payload) => {
    const { package: pkgName, line } = payload;
    console.log(`[remove ${pkgName}] ${line}`);
  });

  await onUpdateOutput((payload) => {
    console.log(`[update] ${payload.line}`);
  });

  await onOperationComplete('install-complete', (payload) => {
    const { package: pkgName, success } = payload;
    if (success) {
      showToast(`"${escapeHtml(pkgName)}" installed`, 'success');
    } else {
      showToast(`"${escapeHtml(pkgName)}" install failed`, 'error');
    }
    setTimeout(() => setActiveView(state.activeView), 600);
  });

  await onOperationComplete('remove-complete', (payload) => {
    const { package: pkgName, success } = payload;
    if (success) {
      showToast(`"${escapeHtml(pkgName)}" removed`, 'success');
    } else {
      showToast(`"${escapeHtml(pkgName)}" removal failed`, 'error');
    }
    setTimeout(() => setActiveView(state.activeView), 600);
  });

  await onOperationComplete('update-complete', (payload) => {
    if (payload.success) {
      showToast('Updates applied', 'success');
    } else {
      showToast(`Update failed: ${escapeHtml(String(payload.error || ''))}`, 'error');
    }
    setTimeout(() => setActiveView(state.activeView), 600);
  });
}

/* ── bootstrap ─────────────────────────────────────────────────────────── */

async function bootstrap() {
  initShell();

  try {
    const backends = await detectBackends();
    state.backends = backends;
    if (sidebarStatus) {
      sidebarStatus.textContent = `${backends.length} source${backends.length !== 1 ? 's' : ''} ready`;
    }
    showToast(`Detected ${backends.length} package source${backends.length !== 1 ? 's' : ''}`, 'info');
  } catch (err) {
    if (sidebarStatus) sidebarStatus.textContent = 'Detection failed';
    showToast(`Failed to detect package managers: ${escapeHtml(String(err))}`, 'error');
  }

  await wireEvents();
  setActiveView('browse');
}

bootstrap();
