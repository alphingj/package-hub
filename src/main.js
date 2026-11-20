/**
 * package-hub — main application entry
 * Wires shell, navigation, and the packages-changed refresh loop.
 * All toasts + refreshes come from the operation wrappers in components.js;
 * this file never duplicates them.
 */

import {
  state, showToast, applyTheme, loadTheme, onPackagesChanged,
} from './ui.js';
import { renderBrowse, renderInstalled, renderUpdates, renderSettings } from './views.js';
import { detectBackends } from './api.js';

let contentEl = null;
let navLinks = {};
let sidebarStatus = null;
let themeBtn = null;

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
  `;

  contentEl = document.getElementById('view-container');
  sidebarStatus = document.getElementById('sidebar-status');
  themeBtn = document.getElementById('btn-theme');
  const refreshBtn = document.getElementById('btn-refresh');

  document.querySelectorAll('[data-view]').forEach((el) => {
    navLinks[el.dataset.view] = el;
    el.addEventListener('click', () => setActiveView(el.dataset.view));
  });

  themeBtn.addEventListener('click', () => {
    const themes = ['light', 'dark', 'system'];
    const next = themes[(themes.indexOf(state.theme) + 1) % themes.length];
    applyTheme(next);
    updateThemeIcon(next);
  });

  refreshBtn.addEventListener('click', () => setActiveView(state.activeView));

  applyTheme(loadTheme());
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

/* ── bootstrap ─────────────────────────────────────────────────────────── */

async function bootstrap() {
  initShell();

  // After any successful install/remove/update, refresh the current view
  // exactly once (components.js emits; this is the single subscriber).
  onPackagesChanged(() => setActiveView(state.activeView));

  try {
    const backends = await detectBackends();
    state.backends = backends;
    if (sidebarStatus) {
      sidebarStatus.textContent = `${backends.length} source${backends.length !== 1 ? 's' : ''} ready`;
    }
    if (backends.length === 0) {
      showToast('No supported package managers detected (apt, dnf, pacman, zypper, flatpak)', 'error');
    }
  } catch (err) {
    if (sidebarStatus) sidebarStatus.textContent = 'Detection failed';
    showToast(`Failed to detect package managers: ${String(err)}`, 'error');
  }

  setActiveView('browse');
}

bootstrap();
