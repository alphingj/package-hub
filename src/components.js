/**
 * package-hub UI components
 * Reusable, styled, accessible building blocks.
 */

import { state, showToast, emitPackagesChanged, escapeHtml } from './ui.js';

const CAT_COLORS = {
  dev: 'var(--cat-dev)',
  graphics: 'var(--cat-graphics)',
  games: 'var(--cat-games)',
  office: 'var(--cat-office)',
  internet: 'var(--cat-internet)',
  system: 'var(--cat-system)',
  media: 'var(--cat-media)',
  edu: 'var(--cat-edu)',
};

const CAT_ICONS = {
  dev: '💻',
  graphics: '🎨',
  games: '🎮',
  office: '📄',
  internet: '🌐',
  system: '⚙️',
  media: '🎵',
  edu: '🎓',
};

export function el(tag, className = '') {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

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

/** Per-operation in-flight key: source:name, so identical names from
 *  different sources never collide. */
function opKey(pkg) {
  return `${pkg.source}:${pkg.name}`;
}

/* ── avatar: category-colored badge ────────────────────────────────────── */

export function avatar(category) {
  const color = CAT_COLORS[category] || 'var(--text-muted)';
  const icon = CAT_ICONS[category] || '📦';
  const a = el('div', 'app-avatar');
  a.style.background = `linear-gradient(135deg, ${color}, ${color}dd)`;
  a.textContent = icon;
  return a;
}

/* ── shared operation wrapper: spinner + toast + refresh, no duplicates ── */

async function runOp(btnEl, busyLabel, doneLabel, work, successMsg, errorPrefix) {
  btnEl.disabled = true;
  btnEl.classList.add('btn-loading');
  btnEl.setAttribute('data-label', doneLabel);
  btnEl.textContent = busyLabel;
  try {
    await work();
    showToast(successMsg, 'success');
    emitPackagesChanged();
  } catch (err) {
    showToast(`${errorPrefix}: ${String(err)}`, 'error');
  } finally {
    btnEl.disabled = false;
    btnEl.classList.remove('btn-loading');
    btnEl.textContent = btnEl.getAttribute('data-label') || doneLabel;
  }
}

/* ── app card ──────────────────────────────────────────────────────────── */

export function createAppCard(pkg, handlers) {
  const { onInstall, onRemove, onDetail } = handlers;
  const card = el('article', 'app-card');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `View details for ${pkg.name}`);

  const isInstalled = pkg.installed;

  const left = el('div', 'app-card-left');
  left.appendChild(avatar(pkg.category));
  const meta = el('div', 'app-card-meta');
  const name = el('h3', 'app-card-name');
  name.textContent = pkg.name;
  const sub = el('div', 'app-card-sub');
  if (pkg.description) {
    sub.textContent = pkg.description;
  }
  const source = el('span', 'app-card-source', sourceLabel(pkg.source));
  meta.append(name, sub, source);
  left.appendChild(meta);

  const right = el('div', 'app-card-actions');

  const detailBtn = el('button', 'icon-btn detail-btn', '↗');
  detailBtn.title = 'Details';
  detailBtn.setAttribute('aria-label', `Details for ${pkg.name}`);
  detailBtn.onclick = (e) => {
    e.stopPropagation();
    onDetail(pkg);
  };
  right.appendChild(detailBtn);

  const actionBtn = el('button', 'btn-primary app-action-btn', isInstalled ? 'Remove' : 'Install');
  actionBtn.onclick = (e) => {
    e.stopPropagation();
    if (state.installing.has(opKey(pkg))) return;
    if (isInstalled && !confirm(`Remove "${pkg.name}"?`)) return;
    state.installing.add(opKey(pkg));
    runOp(
      actionBtn,
      isInstalled ? 'Removing…' : 'Installing…',
      isInstalled ? 'Remove' : 'Install',
      () => (isInstalled ? onRemove(pkg.source, pkg.name) : onInstall(pkg.source, pkg.name)),
      isInstalled ? `${pkg.name} removed` : `${pkg.name} installed`,
      isInstalled ? 'Remove failed' : 'Install failed',
    );
  };
  right.appendChild(actionBtn);

  // Whole card opens the detail modal (buttons stopPropagation above).
  card.onclick = () => onDetail(pkg);
  card.onkeydown = (e) => {
    if (e.key === 'Enter' && e.target === card) onDetail(pkg);
  };

  card.append(left, right);
  return card;
}

/* ── app list row (installed / updates) ────────────────────────────────── */

export function createAppRow(pkg, handlers) {
  const { onRemove, onUpdate, onUpdateAll } = handlers;
  const row = el('div', 'app-row');

  const left = el('div', 'app-row-left');
  left.appendChild(avatar(pkg.category));
  const info = el('div', 'app-row-info');
  const name = el('div', 'app-row-name');
  name.textContent = pkg.name;
  const sub = el('div', 'app-row-sub');
  sub.textContent = `${pkg.version ? `v${pkg.version}` + '  •  ' : ''}${sourceLabel(pkg.source)}`;
  info.append(name, sub);
  left.appendChild(info);

  const right = el('div', 'app-row-actions');

  if (pkg.update_available && onUpdate) {
    const u = el('button', 'btn-ghost app-action-btn', 'Update');
    u.onclick = () => {
      if (state.installing.has(opKey(pkg))) return;
      state.installing.add(opKey(pkg));
      // Per-package update — NOT a full-source upgrade.
      runOp(u, 'Updating…', 'Update', () => onUpdate(pkg.source, pkg.name), `${pkg.name} updated`, 'Update failed');
    };
    right.appendChild(u);
  }

  if (pkg.update_available && onUpdateAll) {
    const ua = el('button', 'btn-ghost app-action-btn', 'Update all');
    ua.title = `Update every ${sourceLabel(pkg.source)} package`;
    ua.onclick = () => {
      const allKey = `all:${pkg.source}`;
      if (state.installing.has(allKey)) return;
      state.installing.add(allKey);
      runOp(ua, 'Updating all…', 'Update all', () => onUpdateAll(pkg.source), `All ${sourceLabel(pkg.source)} updates applied`, 'Update all failed');
    };
    right.appendChild(ua);
  }

  const r = el('button', 'btn-danger app-action-btn', 'Remove');
  r.onclick = () => {
    if (state.installing.has(opKey(pkg))) return;
    if (!confirm(`Remove "${pkg.name}"?`)) return;
    state.installing.add(opKey(pkg));
    runOp(r, 'Removing…', 'Remove', () => onRemove(pkg.source, pkg.name), `${pkg.name} removed`, 'Remove failed');
  };
  right.appendChild(r);

  row.append(left, right);
  return row;
}

/* ── empty state ───────────────────────────────────────────────────────── */

export function createEmptyState(icon, title, subtitle, actionLabel, actionCb) {
  const wrap = el('div', 'empty-state');
  const ic = el('div', 'empty-icon', icon);
  const h = el('h3', 'empty-title');
  h.textContent = title;
  const p = el('p', 'empty-sub');
  p.textContent = subtitle;
  wrap.append(ic, h, p);
  if (actionLabel && actionCb) {
    const b = el('button', 'btn-primary empty-action');
    b.textContent = actionLabel;
    b.onclick = actionCb;
    wrap.appendChild(b);
  }
  return wrap;
}

/* ── loading state ─────────────────────────────────────────────────────── */

export function createLoadingState() {
  const wrap = el('div', 'loading-state');
  wrap.innerHTML = `<div class="spinner"></div>`;
  const p = el('p', 'loading-text');
  p.textContent = 'Loading…';
  wrap.appendChild(p);
  return wrap;
}

/* ── per-source warning banner ─────────────────────────────────────────── */

export function createSourceErrors(errors) {
  if (!errors || errors.length === 0) return null;
  const wrap = el('div', 'warn-banner');
  const names = errors.map((e) => e.source).join(', ');
  const strong = el('strong');
  strong.textContent = `${names} unavailable`;
  const detail = document.createElement('span');
  detail.textContent = ` — ${errors[0].error}`;
  detail.className = 'warn-detail';
  wrap.append(strong, detail);
  return wrap;
}

/* ── detail modal ──────────────────────────────────────────────────────── */

export function createDetailModal(pkg, { onInstall, onRemove, onUpdate }) {
  const modal = el('div', 'detail-modal');
  const isInstalled = pkg.installed;
  const hasUpdate = pkg.update_available;
  const catColor = CAT_COLORS[pkg.category] || 'var(--text-muted)';

  modal.innerHTML = `
    <div class="detail-backdrop"></div>
    <div class="detail-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(pkg.name)} details">
      <button class="detail-close" aria-label="Close details">✕</button>

      <div class="detail-header">
        <div class="detail-avatar" style="background: linear-gradient(135deg, ${catColor}, ${catColor}dd);">
          ${CAT_ICONS[pkg.category] || '📦'}
        </div>
        <div class="detail-meta">
          <span class="detail-source">${sourceLabel(pkg.source)}</span>
          <h1 class="detail-name">${escapeHtml(pkg.name)}</h1>
          <span class="detail-badge ${isInstalled ? 'badge-installed' : 'badge-available'}">
            ${isInstalled ? 'Installed' : 'Available'}
          </span>
        </div>
      </div>

      <div class="detail-body">
        <div class="detail-section">
          <h4 class="detail-section-title">Version</h4>
          <p class="detail-text">${pkg.version ? escapeHtml(pkg.version) : '—'}</p>
        </div>
        <div class="detail-section">
          <h4 class="detail-section-title">Description</h4>
          <p class="detail-text detail-desc">${escapeHtml(pkg.description || 'No description available.')}</p>
        </div>
        ${hasUpdate ? `
          <div class="detail-section">
            <h4 class="detail-section-title" style="color: var(--warning)">Update available</h4>
            <p class="detail-text">A newer version can be installed.</p>
          </div>
        ` : ''}
      </div>

      <div class="detail-actions"></div>
    </div>
  `;

  /* Build action buttons explicitly — each with its own correct handler.
     Fixes the old bug where "Update" actually removed the package. */
  const actions = modal.querySelector('.detail-actions');
  const closeBtn = modal.querySelector('.detail-close');

  const makeBtn = (cls, label) => {
    const b = el('button', cls);
    b.textContent = label;
    return b;
  };

  if (!isInstalled) {
    const installBtn = makeBtn('btn-primary detail-btn-wide', 'Install');
    installBtn.onclick = () => {
      if (state.installing.has(opKey(pkg))) return;
      state.installing.add(opKey(pkg));
      runOp(installBtn, 'Installing…', 'Install', () => onInstall(pkg.source, pkg.name), `${pkg.name} installed`, 'Install failed')
        .finally(close);
    };
    actions.appendChild(installBtn);
  } else {
    if (hasUpdate) {
      const updateBtn = makeBtn('btn-primary detail-btn-wide', 'Update');
      updateBtn.onclick = () => {
        if (state.installing.has(opKey(pkg))) return;
        state.installing.add(opKey(pkg));
        runOp(updateBtn, 'Updating…', 'Update', () => onUpdate(pkg.source, pkg.name), `${pkg.name} updated`, 'Update failed')
          .finally(close);
      };
      actions.appendChild(updateBtn);
    }
    const removeBtn = makeBtn('btn-danger detail-btn-wide', 'Remove');
    removeBtn.onclick = () => {
      if (state.installing.has(opKey(pkg))) return;
      if (!confirm(`Remove "${pkg.name}"?`)) return;
      state.installing.add(opKey(pkg));
      runOp(removeBtn, 'Removing…', 'Remove', () => onRemove(pkg.source, pkg.name), `${pkg.name} removed`, 'Remove failed')
        .finally(close);
    };
    actions.appendChild(removeBtn);
  }

  /* Close behaviors: backdrop click, ✕ button, Escape key. */
  const backdrop = modal.querySelector('.detail-backdrop');
  const close = () => {
    document.removeEventListener('keydown', onKey);
    modal.classList.remove('open');
    setTimeout(() => modal.remove(), 300);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    /* rudimentary focus trap */
    if (e.key === 'Tab') {
      const focusables = modal.querySelectorAll('button');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  backdrop.onclick = close;
  closeBtn.onclick = close;
  document.addEventListener('keydown', onKey);

  document.body.appendChild(modal);
  requestAnimationFrame(() => {
    modal.classList.add('open');
    closeBtn.focus();
  });
  return modal;
}
