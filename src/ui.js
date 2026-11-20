/**
 * package-hub UI state & shared helpers
 */

export const state = {
  theme: 'dark',
  backends: [],
  installed: [],
  updates: [],
  activeView: 'browse',
  activeCategory: null,
  activeSource: null,
  searchQuery: '',
  installing: new Set(),
};

const THEME_KEY = 'package-hub-theme';

export function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'dark';
  } catch {
    return 'dark';
  }
}

/* ── escape HTML (quotes included, safe for attributes) ────────────────── */

export function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/* ── toast notifications ───────────────────────────────────────────────── */

let toastContainer = null;

/**
 * Show a toast. `message` is plain text — it is rendered via textContent,
 * so callers must NOT pre-escape it.
 */
export function showToast(message, type = 'info') {
  if (!toastContainer || !toastContainer.isConnected) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const msg = document.createElement('span');
  msg.className = 'toast-message';
  msg.textContent = message;

  const close = document.createElement('button');
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '✕';
  close.onclick = () => dismiss(toast);

  toast.append(msg, close);
  toastContainer.appendChild(toast);

  setTimeout(() => dismiss(toast), 5000);
}

function dismiss(toast) {
  if (!toast.isConnected) return;
  toast.style.opacity = '0';
  toast.style.transform = 'translatex(120px)';
  setTimeout(() => toast.remove(), 300);
}

/* ── theme ─────────────────────────────────────────────────────────────── */

export function applyTheme(theme) {
  state.theme = theme;
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable — theme just won't persist */
  }
}

/* ── operation pub/sub: views refresh after any successful op ──────────── */

const changeListeners = new Set();

export function onPackagesChanged(cb) {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

export function emitPackagesChanged() {
  changeListeners.forEach((cb) => cb());
}
