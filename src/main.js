/**
 * package-hub — main application entry.
 * Wires navigation, state, Tauri commands, and event streaming together.
 */

import { state, showStatus, renderStatusBanner, escapeHtml } from './ui.js';
import { renderBrowse, renderInstalled, renderUpdates, renderSettings, applyTheme } from './views.js';
import {
  detectBackends,
  onInstallOutput,
  onRemoveOutput,
  onUpdateOutput,
  onOperationComplete,
} from './api.js';

const app = document.getElementById('app');
const navLinks = {};
let contentEl = null;
let statusBannerEl = null;
let installLogEl = null;
let installPanelEl = null;

/**
 * Initialize the application shell.
 */
function initShell() {
  app.innerHTML = `
    <div class="flex h-screen flex-col dark:bg-neutral-950 overflow-hidden">
      <!-- Native titlebar area (window controls handled by OS) -->
      <header class="flex-shrink-0 h-16 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-6 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-accent-600 flex items-center justify-center text-white font-bold text-lg">
            P
          </div>
          <span class="font-semibold text-neutral-900 dark:text-neutral-100 text-sm">package-hub</span>
        </div>
        <div class="flex items-center gap-2">
          <button id="btn-theme" class="btn-ghost p-1.5 text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800" aria-label="Toggle theme">
            🌓
          </button>
          <button id="btn-refresh" class="btn-ghost p-1.5 text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800" aria-label="Refresh">
            ⟳
          </button>
        </div>
      </header>

      <div class="flex-1 flex overflow-hidden">
        <!-- Sidebar -->
        <aside class="flex-shrink-0 w-60 border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 flex flex-col">
          <nav class="flex-1 px-4 py-4 space-y-1">
            <a href="#browse" class="nav-item flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors" data-view="browse">
              📦 Browse
            </a>
            <a href="#installed" class="nav-item flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors" data-view="installed">
              📥 Installed
            </a>
            <a href="#updates" class="nav-item flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors" data-view="updates">
              🔄 Updates
            </a>
            <a href="#settings" class="nav-item flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors" data-view="settings">
              ⚙️ Settings
            </a>
          </nav>
          <div class="p-4 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800">
            <div class="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">Status</div>
            <div id="status-indicator" class="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">Ready</div>
          </div>
        </aside>

        <!-- Main content -->
        <main class="flex-1 overflow-y-auto bg-neutral-50 dark:bg-neutral-950 p-6 lg:p-8 relative">
          <!-- Status banner -->
          <div id="status-banner" class="fixed top-0 left-0 right-0 px-6 py-3 text-sm font-medium text-center z-50 hidden"></div>

          <!-- Install log panel (slides in during operations) -->
          <div id="install-panel" class="fixed inset-x-0 bottom-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 p-4 z-40 hidden transform translate-y-full transition-transform duration-200">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Install output</h3>
              <button id="btn-hide-log" class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">Hide</button>
            </div>
            <div id="install-log" class="h-32 overflow-y-auto font-mono text-xs text-neutral-500 dark:text-neutral-300 bg-neutral-50 dark:bg-neutral-800/50 p-2 rounded border border-neutral-200 dark:border-neutral-700"></div>
          </div>

          <div id="view-container" class="min-h-full"></div>
        </main>
      </div>
    </div>
  `;

  contentEl = document.getElementById('view-container');
  statusBannerEl = document.getElementById('status-banner');
  installPanelEl = document.getElementById('install-panel');
  installLogEl = document.getElementById('install-log');

  // Cache nav links
  document.querySelectorAll('[data-view]').forEach((el) => {
    navLinks[el.dataset.view] = el;
  });

  // Navigation click handlers
  Object.entries(navLinks).forEach(([view, el]) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      setActiveView(view);
    });
  });

  // Theme toggle
  document.getElementById('btn-theme').addEventListener('click', () => {
    const themes = ['light', 'dark', 'system'];
    const current = state.theme;
    const next = themes[(themes.indexOf(current) + 1) % themes.length];
    state.theme = next;
    applyTheme(next);
    updateThemeIcon(next);
  });

  // Refresh
  document.getElementById('btn-refresh').addEventListener('click', () => {
    setActiveView(state.activeView);
  });

  // Hide install log
  document.getElementById('btn-hide-log').addEventListener('click', () => {
    installPanelEl.classList.add('hidden');
    installPanelEl.classList.add('translate-y-full');
  });

  // Apply initial theme
  applyTheme(state.theme);
  updateThemeIcon(state.theme);
}

function updateThemeIcon(theme) {
  const btn = document.getElementById('btn-theme');
  const icons = { light: '🌙', dark: '☀️', system: '🌓' };
  btn.textContent = icons[theme] || '🌓';
}

/**
 * Set the active navigation view and render it.
 */
function setActiveView(view) {
  state.activeView = view;

  // Update nav active states
  Object.entries(navLinks).forEach(([v, el]) => {
    const isActive = v === view;
    el.classList.toggle('bg-accent-600', isActive);
    el.classList.toggle('text-white', isActive);
    el.classList.toggle('text-neutral-600', !isActive);
    el.classList.toggle('dark:text-neutral-300', !isActive);
    el.classList.toggle('dark:text-white', isActive);
    el.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  // Render view
  renderStatusBanner();
  switch (view) {
    case 'browse':
      renderBrowse(contentEl);
      break;
    case 'installed':
      renderInstalled(contentEl);
      break;
    case 'updates':
      renderUpdates(contentEl);
      break;
    case 'settings':
      renderSettings(contentEl);
      break;
  }
}

/**
 * Show the install log panel and append a line.
 */
function showInstallLog(line) {
  installPanelEl.classList.remove('hidden');
  installPanelEl.classList.remove('translate-y-full');
  const div = document.createElement('div');
  div.textContent = line;
  installLogEl.appendChild(div);
  installLogEl.scrollTop = installLogEl.scrollHeight;
}

function clearInstallLog() {
  installLogEl.innerHTML = '';
}

/**
 * Wire up Tauri event listeners for streaming output.
 */
async function wireEvents() {
  const unlistenInstall = await onInstallOutput((payload) => {
    const { package: pkgName, line } = payload;
    showInstallLog(`[${pkgName}] ${line}`);
  });

  const unlistenRemove = await onRemoveOutput((payload) => {
    const { package: pkgName, line } = payload;
    showInstallLog(`[${pkgName}] ${line}`);
  });

  const unlistenUpdate = await onUpdateOutput((payload) => {
    showInstallLog(`[update] ${payload.line}`);
  });

  await onOperationComplete('install-complete', (payload) => {
    const { package: pkgName, success } = payload;
    if (success) {
      showStatus('success', `"${escapeHtml(pkgName)}" installed`);
    } else {
      showStatus('error', `"${escapeHtml(pkgName)}" install failed`);
    }
    // Refresh current view to reflect changes
    setTimeout(() => setActiveView(state.activeView), 800);
  });

  await onOperationComplete('remove-complete', (payload) => {
    const { package: pkgName, success } = payload;
    if (success) {
      showStatus('success', `"${escapeHtml(pkgName)}" removed`);
    } else {
      showStatus('error', `"${escapeHtml(pkgName)}" removal failed`);
    }
    setTimeout(() => setActiveView(state.activeView), 800);
  });

  await onOperationComplete('update-complete', (payload) => {
    if (payload.success) {
      showStatus('success', 'Updates applied');
    } else {
      showStatus('error', `Update failed: ${escapeHtml(String(payload.error || ''))}`);
    }
    setTimeout(() => setActiveView(state.activeView), 800);
  });

  // We intentionally keep listeners alive for the app lifetime.
  // No need to call unlisten* here.
}

/**
 * Bootstrap: detect backends, then show the browse view.
 */
async function bootstrap() {
  initShell();

  const statusIndicator = document.getElementById('status-indicator');
  statusIndicator.textContent = 'Detecting package managers…';

  try {
    const backends = await detectBackends();
    state.backends = backends;
    statusIndicator.textContent = `${backends.length} source${backends.length !== 1 ? 's' : ''} ready`;
    showStatus('info', `Detected ${backends.length} package source${backends.length !== 1 ? 's' : ''}`);
  } catch (err) {
    statusIndicator.textContent = 'Detection failed';
    showStatus('error', `Failed to detect package managers: ${escapeHtml(err.message || String(err))}`);
  }

  await wireEvents();
  setActiveView('browse');
}

bootstrap();
