/**
 * package-hub UI state & shared helpers
 */

export const state = {
  theme: 'dark',
  backends: [],
  packages: [],
  installed: [],
  updates: [],
  activeView: 'browse',
  activeBackend: null,
  activeCategory: null,
  searchQuery: '',
  loading: false,
  installing: new Set(),
};

/* ── escape HTML ───────────────────────────────────────────────────────── */

export function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* ── toast notifications ───────────────────────────────────────────────── */

let toastContainer = null;

export function showToast(message, type = 'info') {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Dismiss">✕</button>
  `;
  toast.querySelector('.toast-close').onclick = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translatex(120px)';
    setTimeout(() => toast.remove(), 300);
  };

  toastContainer.appendChild(toast);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    if (toast.isConnected) {
      toast.style.opacity = '0';
      toast.style.transform = 'translatex(120px)';
      setTimeout(() => toast.remove(), 300);
    }
  }, 5000);
}

/* ── theme ─────────────────────────────────────────────────────────────── */

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    root.setAttribute('data-theme', system);
    root.classList.toggle('dark', system === 'dark');
  } else {
    root.setAttribute('data-theme', theme);
    root.classList.toggle('dark', theme === 'dark');
  }
}
