/**
 * Mudbrick — Utilities
 * File I/O, drag-drop, toast notifications, helpers.
 */

/* ── Toast Notifications ── */

export function toast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('exiting');
    el.addEventListener('animationend', () => el.remove());
  }, duration);
}

/* ── Loading Overlay ── */

export function showLoading(message = 'Processing…') {
  const el = document.getElementById('loading-overlay');
  const txt = document.getElementById('loading-text');
  if (txt) txt.textContent = message;
  el.classList.remove('hidden');
}

export function hideLoading() {
  const el = document.getElementById('loading-overlay');
  el.classList.add('hidden');
  const txt = document.getElementById('loading-text');
  if (txt) txt.textContent = 'Processing…';
}

/* ── File Reading ── */

export function readFileAsArrayBuffer(file) {
  return file.arrayBuffer().then(buf => new Uint8Array(buf));
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/* ── Drag-and-Drop ── */

export function initDragDrop(dropZoneId, onFile) {
  const zone = document.getElementById(dropZoneId);
  if (!zone) return;

  // Prevent browser default file open
  const preventDefault = e => e.preventDefault();
  document.addEventListener('dragover', preventDefault);
  document.addEventListener('drop', preventDefault);

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', e => {
    // Only remove if actually leaving the zone (not entering a child)
    if (!zone.contains(e.relatedTarget)) {
      zone.classList.remove('drag-over');
    }
  });

  zone.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('drag-over');

    const files = Array.from(e.dataTransfer.files);
    const supported = files.filter(f =>
      f.type === 'application/pdf' ||
      f.name.toLowerCase().endsWith('.pdf') ||
      f.type.startsWith('image/') ||
      /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(f.name)
    );

    if (supported.length > 0) {
      onFile(supported);
    } else {
      toast('Please drop a PDF or image file.', 'warning');
    }
  });

  // Click to open file picker
  zone.addEventListener('click', e => {
    // Don't trigger if clicking a button inside the zone
    if (e.target.tagName === 'BUTTON') return;
    const input = zone.querySelector('input[type="file"]') ||
                  document.getElementById('file-input');
    if (input) input.click();
  });
}

/* ── Download Helper ── */

export function downloadBlob(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── Debounce ── */

export function debounce(fn, ms = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/* ── Parse Page Ranges ── */
// "1-3, 5, 7-12" → [[0,1,2], [4], [6,7,8,9,10,11]]  (0-indexed)

export function parsePageRanges(input, totalPages) {
  const ranges = [];
  const parts = input.split(',').map(s => s.trim()).filter(Boolean);

  for (const part of parts) {
    const match = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (match) {
      const start = parseInt(match[1]) - 1;
      const end = parseInt(match[2]) - 1;
      if (start < 0 || end >= totalPages || start > end) return null;
      const range = [];
      for (let i = start; i <= end; i++) range.push(i);
      ranges.push(range);
    } else {
      const page = parseInt(part) - 1;
      if (isNaN(page) || page < 0 || page >= totalPages) return null;
      ranges.push([page]);
    }
  }

  return ranges.length > 0 ? ranges : null;
}
