/**
 * package-hub UI components
 * Reusable, styled, accessible building blocks.
 */

import { state, showToast, escapeHtml } from './ui.js';

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

/* ── helpers ─────────────────────────────────────────────────────────────── */

export function el(tag, className = '', html = '') {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html) e.innerHTML = html;
  return e;
}

export function btn(label, className, onclick) {
  const b = el('button', className, escapeHtml(label));
  b.type = 'button';
  if (onclick) b.onclick = onclick;
  return b;
}

/* ── avatar: category-colored letter badge ─────────────────────────────── */

export function avatar(category, letter) {
  const color = CAT_COLORS[category] || 'var(--text-muted)';
  const icon = CAT_ICONS[category] || '📦';
  const a = el('div', 'app-avatar');
  a.style.background = `linear-gradient(135deg, ${color}, ${color}dd)`;
  a.textContent = icon;
  return a;
}

/* ── app card ──────────────────────────────────────────────────────────── */

export function createAppCard(pkg, { onInstall, onRemove, onUpdate, onDetail }) {
  const card = el('article', 'app-card');
  card.dataset.source = pkg.source;
  card.dataset.name = pkg.name;

  const isInstalled = pkg.installed;
  const hasUpdate = pkg.update_available;

  /* Left: avatar + meta */
  const left = el('div', 'app-card-left');
  left.appendChild(avatar(pkg.category || 'system', pkg.name.charAt(0)));

  const meta = el('div', 'app-card-meta');
  const name = el('h3', 'app-card-name', escapeHtml(pkg.name));
  const source = el('span', 'app-card-source', sourceLabel(pkg.source));
  meta.appendChild(name);
  meta.appendChild(source);
  left.appendChild(meta);

  /* Right: actions */
  const right = el('div', 'app-card-actions');

  const detailBtn = el('button', 'icon-btn detail-btn', '↗');
  detailBtn.title = 'Details';
  detailBtn.onclick = () => onDetail && onDetail(pkg);

  let actionBtn;
  if (isInstalled) {
    actionBtn = el('button', 'btn-primary app-action-btn', 'Remove');
    actionBtn.onclick = async () => {
      if (state.installing.has(pkg.name)) return;
      if (!confirm(`Remove "${escapeHtml(pkg.name)}"?`)) return;
      try {
        state.installing.add(pkg.name);
        setBtnState(actionBtn, true, 'Removing…');
        await onRemove(pkg.source, pkg.name);
        showToast(`"${escapeHtml(pkg.name)}" removed`, 'success');
        if (onDetail) onDetail(null); // close detail if open
      } catch (err) {
        showToast(`Remove failed: ${escapeHtml(String(err))}`, 'error');
      } finally {
        state.installing.delete(pkg.name);
        setBtnState(actionBtn, false, 'Remove');
      }
    };
  } else {
    const label = hasUpdate ? 'Update' : 'Install';
    actionBtn = el('button', 'btn-primary app-action-btn', label);
    actionBtn.onclick = async () => {
      if (state.installing.has(pkg.name)) return;
      try {
        state.installing.add(pkg.name);
        setBtnState(actionBtn, true, hasUpdate ? 'Updating…' : 'Installing…');
        await onInstall(pkg.source, pkg.name);
        showToast(`"${escapeHtml(pkg.name)}" installed`, 'success');
      } catch (err) {
        showToast(`Install failed: ${escapeHtml(String(err))}`, 'error');
      } finally {
        state.installing.delete(pkg.name);
        setBtnState(actionBtn, false, label);
      }
    };
  }

  right.appendChild(detailBtn);
  right.appendChild(actionBtn);

  card.appendChild(left);
  card.appendChild(right);

  return card;
}

/* ── app list row (for installed / updates) ───────────────────────────── */

export function createAppRow(pkg, { onRemove, onUpdate }) {
  const row = el('div', 'app-row');

  const left = el('div', 'app-row-left');
  left.appendChild(avatar(pkg.category || 'system', pkg.name.charAt(0)));

  const info = el('div', 'app-row-info');
  const name = el('div', 'app-row-name', escapeHtml(pkg.name));
  const sub = el('div', 'app-row-sub');
  sub.textContent = `${pkg.version ? `v${escapeHtml(pkg.version)}` + '  •  ' : ''}${sourceLabel(pkg.source)}`;
  info.appendChild(name);
  info.appendChild(sub);
  left.appendChild(info);

  const right = el('div', 'app-row-actions');

  if (pkg.update_available) {
    const u = el('button', 'btn-ghost app-action-btn', 'Update');
    u.onclick = async () => {
      if (state.installing.has(pkg.name)) return;
      try {
        state.installing.add(pkg.name);
        setBtnState(u, true, 'Updating…');
        await onUpdate(pkg.source);
        showToast(`"${escapeHtml(pkg.name)}" updated`, 'success');
      } catch (err) {
        showToast(`Update failed: ${escapeHtml(String(err))}`, 'error');
      } finally {
        state.installing.delete(pkg.name);
        setBtnState(u, false, 'Update');
      }
    };
    right.appendChild(u);
  }

  const r = el('button', 'btn-danger app-action-btn', 'Remove');
  r.onclick = async () => {
    if (state.installing.has(pkg.name)) return;
    if (!confirm(`Remove "${escapeHtml(pkg.name)}"?`)) return;
    try {
      state.installing.add(pkg.name);
      setBtnState(r, true, 'Removing…');
      await onRemove(pkg.source, pkg.name);
      showToast(`"${escapeHtml(pkg.name)}" removed`, 'success');
    } catch (err) {
      showToast(`Remove failed: ${escapeHtml(String(err))}`, 'error');
    } finally {
      state.installing.delete(pkg.name);
      setBtnState(r, false, 'Remove');
    }
  };
  right.appendChild(r);

  row.appendChild(left);
  row.appendChild(right);
  return row;
}

/* ── button state helper ───────────────────────────────────────────────── */

function setBtnState(btn, loading, label) {
  btn.disabled = loading;
  btn.textContent = label;
  if (loading) {
    btn.classList.add('btn-loading');
  } else {
    btn.classList.remove('btn-loading');
  }
}

/* ── empty state ───────────────────────────────────────────────────────── */

export function createEmptyState(icon, title, subtitle, actionLabel, actionCb) {
  const wrap = el('div', 'empty-state');
  wrap.innerHTML = `
    <div class="empty-icon">${icon}</div>
    <h3 class="empty-title">${escapeHtml(title)}</h3>
    <p class="empty-sub">${escapeHtml(subtitle)}</p>
  `;
  if (actionLabel && actionCb) {
    const b = el('button', 'btn-primary empty-action', escapeHtml(actionLabel));
    b.onclick = actionCb;
    wrap.appendChild(b);
  }
  return wrap;
}

/* ── loading state ─────────────────────────────────────────────────────── */

export function createLoadingState() {
  const wrap = el('div', 'loading-state');
  wrap.innerHTML = `
    <div class="spinner"></div>
    <p class="loading-text">Loading…</p>
  `;
  return wrap;
}

/* ── detail modal ──────────────────────────────────────────────────────── */

export function createDetailModal(pkg, { onInstall, onRemove, onUpdate, onClose }) {
  const modal = el('div', 'detail-modal');
  const isInstalled = pkg.installed;
  const hasUpdate = pkg.update_available;
  const catColor = CAT_COLORS[pkg.category || 'system'] || 'var(--text-muted)';

  modal.innerHTML = `
    <div class="detail-backdrop"></div>
    <div class="detail-panel">
      <button class="detail-close" aria-label="Close details">✕</button>

      <div class="detail-header">
        <div class="detail-avatar" style="background: linear-gradient(135deg, ${catColor}, ${catColor}dd);">
          ${CAT_ICONS[pkg.category || 'system'] || '📦'}
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
          <h4 class="detail-section-title">Source</h4>
          <p class="detail-text">${sourceLabel(pkg.source)}</p>
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

      <div class="detail-actions">
        ${isInstalled
          ? `
            ${hasUpdate ? `<button class="btn-primary detail-btn-wide">Update</button>` : ''}
            <button class="btn-danger detail-btn-wide">Remove</button>
          `
          : `<button class="btn-primary detail-btn-wide">Install</button>`
        }
      </div>
    </div>
  `;

  const backdrop = modal.querySelector('.detail-backdrop');
  const closeBtn = modal.querySelector('.detail-close');
  const primaryBtn = modal.querySelector('.btn-primary');
  const dangerBtn = modal.querySelector('.btn-danger');

  const close = () => {
    modal.classList.remove('open');
    setTimeout(() => modal.remove(), 300);
    if (onClose) onClose();
  };

  backdrop.onclick = close;
  closeBtn.onclick = close;

  if (primaryBtn) {
    const label = isInstalled && hasUpdate ? 'Update' : isInstalled ? 'Remove' : 'Install';
    primaryBtn.textContent = label;
    primaryBtn.className = `btn-primary detail-btn-wide ${isInstalled ? 'btn-danger' : ''}`;
    primaryBtn.onclick = async () => {
      if (state.installing.has(pkg.name)) return;
      try {
        state.installing.add(pkg.name);
        primaryBtn.disabled = true;
        primaryBtn.textContent = isInstalled ? 'Removing…' : (hasUpdate ? 'Updating…' : 'Installing…');
        if (isInstalled) {
          await onRemove(pkg.source, pkg.name);
          showToast(`"${escapeHtml(pkg.name)}" removed`, 'success');
        } else {
          await onInstall(pkg.source, pkg.name);
          showToast(`"${escapeHtml(pkg.name)}" installed`, 'success');
        }
        close();
      } catch (err) {
        showToast(`Operation failed: ${escapeHtml(String(err))}`, 'error');
      } finally {
        state.installing.delete(pkg.name);
        primaryBtn.disabled = false;
        primaryBtn.textContent = label;
        primaryBtn.className = `btn-primary detail-btn-wide ${isInstalled ? 'btn-danger' : ''}`;
      }
    };
  }

  if (dangerBtn && !isInstalled) {
    dangerBtn.style.display = 'none';
  }

  document.body.appendChild(modal);
  // Force reflow then open
  requestAnimationFrame(() => modal.classList.add('open'));
  return modal;
}

/* ── source label ──────────────────────────────────────────────────────── */

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
