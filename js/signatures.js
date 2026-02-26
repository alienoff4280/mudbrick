/**
 * Mudbrick — Signatures (Phase 2, W3.2)
 * Draw / Type / Upload visual signature modal.
 *
 * All three modes produce a data-URL PNG that gets placed
 * as a fabric.Image with mudbrickType: 'signature'.
 *
 * Saved signatures persist in localStorage for reuse.
 */

import { insertImage } from './annotations.js';

const getFabric = () => window.fabric;

/* ═══════════════════ State ═══════════════════ */

const STORAGE_KEY = 'mudbrick_saved_signatures';

let drawCanvas = null;      // small Fabric canvas for draw tab
let activeTab = 'draw';     // draw | type | upload
let uploadedDataUrl = null;  // from file input

/* ═══════════════════ Public API ═══════════════════ */

/**
 * Open the signature modal.
 */
export function openSignatureModal() {
  const backdrop = document.getElementById('signature-modal-backdrop');
  if (!backdrop) return;
  backdrop.classList.remove('hidden');

  // Default to draw tab
  switchTab('draw');
  loadSavedList();
}

/**
 * Close the signature modal.
 */
export function closeSignatureModal() {
  const backdrop = document.getElementById('signature-modal-backdrop');
  if (backdrop) backdrop.classList.add('hidden');

  // Clean up draw canvas
  if (drawCanvas) {
    drawCanvas.dispose();
    drawCanvas = null;
  }
  uploadedDataUrl = null;
}

/* ═══════════════════ Tab Switching ═══════════════════ */

function switchTab(tab) {
  activeTab = tab;
  const tabs = document.querySelectorAll('#signature-modal-backdrop .sig-tab');
  const panes = document.querySelectorAll('#signature-modal-backdrop .sig-pane');

  tabs.forEach(t => t.classList.toggle('active', t.dataset.sigTab === tab));
  panes.forEach(p => p.classList.toggle('hidden', p.dataset.sigPane !== tab));

  if (tab === 'draw') {
    initDrawCanvas();
  }
}

/* ═══════════════════ Draw Tab ═══════════════════ */

function initDrawCanvas() {
  const fabric = getFabric();
  if (!fabric) return;

  // Clean previous
  if (drawCanvas) { drawCanvas.dispose(); drawCanvas = null; }

  const el = document.getElementById('sig-draw-canvas');
  if (!el) return;

  // Reset the HTML canvas size
  el.width = 420;
  el.height = 160;

  drawCanvas = new fabric.Canvas('sig-draw-canvas', {
    isDrawingMode: true,
    width: 420,
    height: 160,
    backgroundColor: '#ffffff',
  });

  drawCanvas.freeDrawingBrush = new fabric.PencilBrush(drawCanvas);
  drawCanvas.freeDrawingBrush.color = '#1a1a2e';
  drawCanvas.freeDrawingBrush.width = 2.5;
}

function clearDrawCanvas() {
  if (!drawCanvas) return;
  drawCanvas.clear();
  drawCanvas.backgroundColor = '#ffffff';
  drawCanvas.renderAll();
}

function getDrawDataUrl() {
  if (!drawCanvas || drawCanvas.getObjects().length === 0) return null;
  return drawCanvas.toDataURL({ format: 'png', multiplier: 2 });
}

/* ═══════════════════ Type Tab ═══════════════════ */

function getTypeDataUrl() {
  const input = document.getElementById('sig-type-input');
  const fontSelect = document.getElementById('sig-type-font');
  if (!input || !input.value.trim()) return null;

  const text = input.value.trim();
  const font = fontSelect ? fontSelect.value : 'Dancing Script';

  // Render text to an offscreen canvas
  const offscreen = document.createElement('canvas');
  const ctx = offscreen.getContext('2d');

  // Measure text
  ctx.font = `48px "${font}", cursive`;
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width + 40; // padding
  const textHeight = 80;

  offscreen.width = textWidth;
  offscreen.height = textHeight;

  // Draw white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, textWidth, textHeight);

  // Draw text
  ctx.font = `48px "${font}", cursive`;
  ctx.fillStyle = '#1a1a2e';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 20, textHeight / 2);

  return offscreen.toDataURL('image/png');
}

/* ═══════════════════ Upload Tab ═══════════════════ */

function handleUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    uploadedDataUrl = ev.target.result;
    const preview = document.getElementById('sig-upload-preview');
    if (preview) {
      preview.src = uploadedDataUrl;
      preview.classList.remove('hidden');
    }
  };
  reader.onerror = () => {
    console.warn('Failed to read signature file');
  };
  reader.readAsDataURL(file);
}

/* ═══════════════════ Insert Signature ═══════════════════ */

async function insertSignature() {
  let dataUrl = null;

  switch (activeTab) {
    case 'draw':
      dataUrl = getDrawDataUrl();
      break;
    case 'type':
      dataUrl = getTypeDataUrl();
      break;
    case 'upload':
      dataUrl = uploadedDataUrl;
      break;
  }

  if (!dataUrl) {
    alert('Please create or upload a signature first.');
    return;
  }

  // Place on annotation canvas
  await insertImage(dataUrl, 'signature');

  // Auto-save if user wants
  closeSignatureModal();
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ═══════════════════ Save / Load Signatures ═══════════════════ */

function saveCurrentSignature() {
  let dataUrl = null;

  switch (activeTab) {
    case 'draw':
      dataUrl = getDrawDataUrl();
      break;
    case 'type':
      dataUrl = getTypeDataUrl();
      break;
    case 'upload':
      dataUrl = uploadedDataUrl;
      break;
  }

  if (!dataUrl) {
    alert('Please create or upload a signature first.');
    return;
  }

  const saved = getSavedSignatures();
  const name = `Signature ${saved.length + 1}`;
  saved.push({ name, dataUrl, created: Date.now() });

  // Limit to 10 saved signatures
  if (saved.length > 10) saved.shift();

  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  loadSavedList();
}

function getSavedSignatures() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function loadSavedList() {
  const container = document.getElementById('sig-saved-list');
  if (!container) return;

  const saved = getSavedSignatures();
  if (saved.length === 0) {
    container.innerHTML = '<p style="color:var(--mb-text-muted);font-size:12px;margin:0;">No saved signatures yet.</p>';
    return;
  }

  container.innerHTML = saved.map((s, i) => `
    <div class="sig-saved-item" data-sig-index="${i}" style="display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--mb-border);border-radius:var(--mb-radius-sm);cursor:pointer;background:var(--mb-surface);">
      <img src="${s.dataUrl}" style="height:28px;max-width:120px;object-fit:contain;" alt="${escapeHtml(s.name)}">
      <button class="sig-saved-delete" data-sig-del="${i}" style="background:none;border:none;color:var(--mb-text-muted);cursor:pointer;font-size:14px;padding:0 2px;" title="Delete">&times;</button>
    </div>
  `).join('');

  // Click to use saved signature
  container.querySelectorAll('.sig-saved-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.classList.contains('sig-saved-delete')) return;
      const idx = parseInt(el.dataset.sigIndex);
      if (idx < 0 || idx >= saved.length) return;
      const sig = saved[idx];
      if (sig) {
        await insertImage(sig.dataUrl, 'signature');
        closeSignatureModal();
      }
    });
  });

  // Delete saved signature
  container.querySelectorAll('.sig-saved-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.sigDel);
      saved.splice(idx, 1);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      loadSavedList();
    });
  });
}

/* ═══════════════════ Wire Events ═══════════════════ */

/**
 * Initialize signature modal event listeners.
 * Called once from app.js after DOM ready.
 */
export function initSignatureEvents() {
  // Tab switching
  document.querySelectorAll('#signature-modal-backdrop .sig-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.sigTab));
  });

  // Clear draw
  const clearBtn = document.getElementById('sig-draw-clear');
  if (clearBtn) clearBtn.addEventListener('click', clearDrawCanvas);

  // Upload input
  const uploadInput = document.getElementById('sig-upload-input');
  if (uploadInput) uploadInput.addEventListener('change', handleUpload);

  // Insert button
  const insertBtn = document.getElementById('btn-sig-insert');
  if (insertBtn) insertBtn.addEventListener('click', insertSignature);

  // Save button
  const saveBtn = document.getElementById('btn-sig-save');
  if (saveBtn) saveBtn.addEventListener('click', saveCurrentSignature);

  // Close modal
  document.querySelectorAll('[data-close-modal="signature"]').forEach(btn => {
    btn.addEventListener('click', closeSignatureModal);
  });
}
