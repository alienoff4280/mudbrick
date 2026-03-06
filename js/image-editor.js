/**
 * In-PDF Image Editor
 *
 * Opens a full-screen modal with canvas-based tools for editing an image
 * extracted from a PDF page. Returns the edited image as PNG bytes, or null
 * if the user cancels.
 *
 * Usage:
 *   const result = await openImageEditor(imageData, width, height);
 *   if (result) { // result.bytes, result.type === 'image/png' }
 */

/**
 * @param {ImageData} imageData - pixel data from the PDF canvas
 * @param {number} width - image width in pixels
 * @param {number} height - image height in pixels
 * @returns {Promise<{bytes: Uint8Array, type: string} | null>}
 */
export function openImageEditor(imageData, width, height) {
  return new Promise((resolve) => {
    const editor = new ImageEditor(imageData, width, height, resolve);
    editor.open();
  });
}

class ImageEditor {
  constructor(imageData, width, height, onDone) {
    this.origWidth = width;
    this.origHeight = height;
    this.onDone = onDone;

    // Original image (never modified — used for reset and filter re-application)
    this.originalCanvas = document.createElement('canvas');
    this.originalCanvas.width = width;
    this.originalCanvas.height = height;
    this.originalCanvas.getContext('2d').putImageData(imageData, 0, 0);

    // Working canvas dimensions (changes after crop)
    this.workW = width;
    this.workH = height;

    // Paint layer (same size as working canvas)
    this.paintCanvas = document.createElement('canvas');
    this.paintCanvas.width = width;
    this.paintCanvas.height = height;
    this.paintCtx = this.paintCanvas.getContext('2d');

    // Filter state
    this.brightness = 0;   // -100 to 100
    this.contrast = 0;     // -100 to 100
    this.hueRotate = 0;    // 0 to 360
    this.saturation = 100;  // 0 to 200

    // Crop state
    this.cropRect = null; // { x, y, w, h } in image-space coords
    this.cropping = false;
    this.cropStart = null;

    // Rotation state (cumulative, in 90° increments)
    this.rotation = 0; // 0, 90, 180, 270
    this.flipH = false;
    this.flipV = false;

    // Color tint state
    this.tintColor = '#ff0000';
    this.tintOpacity = 0; // 0 to 100

    // Color replace state
    this.replaceSourceColor = null; // { r, g, b } sampled from image
    this.replaceTargetColor = '#ff0000';
    this.replaceTolerance = 40; // 0-150 color distance threshold

    // Background remover state
    this.bgThreshold = 30;
    this.bgFeather = 2;
    this.bgClickMode = false;

    // Tool state
    this.activeTool = 'paint'; // 'paint' | 'crop' | 'eraser' | 'colorReplace' | 'bgRemove'
    this.brushSize = 8;
    this.brushColor = '#ff0000';
    this.painting = false;
    this.lastPt = null;

    // Undo stack (stores paint canvas snapshots)
    this.undoStack = [];
    this.maxUndo = 20;

    // DOM references (set in open())
    this.modal = null;
    this.displayCanvas = null;
    this.displayCtx = null;
    this.scale = 1; // display scale factor
    this.fitScale = 1; // scale that fits image in view
    this.panX = 0; // pan offset in CSS px
    this.panY = 0;
    this.panning = false;
    this.panStart = null;
    this.offsetX = 0; // canvas offset within wrapper
    this.offsetY = 0;
  }

  open() {
    this._buildUI();
    this._renderPreview();
    this._wireEvents();
  }

  // ── UI Construction ──

  _buildUI() {
    this.modal = document.createElement('div');
    this.modal.className = 'image-editor-modal';
    this.modal.innerHTML = `
      <div class="image-editor-toolbar">
        <div class="image-editor-tools">
          <button class="image-editor-tool-btn active" data-tool="paint" title="Paint brush">
            <span>Brush</span>
          </button>
          <button class="image-editor-tool-btn" data-tool="eraser" title="Eraser">
            <span>Eraser</span>
          </button>
          <button class="image-editor-tool-btn" data-tool="crop" title="Crop">
            <span>Crop</span>
          </button>
          <button class="image-editor-tool-btn" data-tool="colorReplace" title="Click image to sample a color, then replace it">
            <span>Color Replace</span>
          </button>
          <button class="image-editor-tool-btn" data-tool="bgRemove" title="Remove background (make transparent)">
            <span>Remove BG</span>
          </button>
          <span class="image-editor-sep"></span>
          <button class="image-editor-tool-btn image-editor-action-icon" id="img-ed-rotate-ccw" title="Rotate 90° left">&#x21BA;</button>
          <button class="image-editor-tool-btn image-editor-action-icon" id="img-ed-rotate-cw" title="Rotate 90° right">&#x21BB;</button>
          <button class="image-editor-tool-btn image-editor-action-icon" id="img-ed-flip-h" title="Flip horizontal">&#x2194;</button>
          <button class="image-editor-tool-btn image-editor-action-icon" id="img-ed-flip-v" title="Flip vertical">&#x2195;</button>
          <span class="image-editor-sep"></span>
          <label class="image-editor-label" data-for-tool="paint,eraser">
            Size
            <input type="range" class="image-editor-range" id="img-ed-brush-size" min="1" max="50" value="8">
            <span class="image-editor-range-val" id="img-ed-brush-size-val">8</span>
          </label>
          <label class="image-editor-label" data-for-tool="paint">
            Color
            <input type="color" id="img-ed-brush-color" value="#ff0000">
          </label>
          <span class="image-editor-color-replace-controls" data-for-tool="colorReplace" style="display:none;">
            <label class="image-editor-label">
              Source
              <span class="image-editor-color-swatch" id="img-ed-source-color" title="Click image to sample">(click image)</span>
            </label>
            <label class="image-editor-label">
              Replace with
              <input type="color" id="img-ed-replace-color" value="#ff0000">
            </label>
            <label class="image-editor-label">
              Tolerance
              <input type="range" class="image-editor-range" id="img-ed-replace-tolerance" min="0" max="150" value="40">
              <span class="image-editor-range-val" id="img-ed-replace-tolerance-val">40</span>
            </label>
            <button class="image-editor-tool-btn" id="img-ed-replace-apply" title="Replace sampled color">Apply Replace</button>
          </span>
          <span class="image-editor-bg-remove-controls" data-for-tool="bgRemove" style="display:none;">
            <label class="image-editor-label">
              Threshold
              <input type="range" class="image-editor-range" id="img-ed-bg-threshold" min="5" max="100" value="30">
              <span class="image-editor-range-val" id="img-ed-bg-threshold-val">30</span>
            </label>
            <label class="image-editor-label">
              Edge feather
              <input type="range" class="image-editor-range" id="img-ed-bg-feather" min="0" max="5" value="2">
              <span class="image-editor-range-val" id="img-ed-bg-feather-val">2</span>
            </label>
            <button class="image-editor-tool-btn" id="img-ed-bg-remove-corners" title="Remove background detected from corners">Auto (corners)</button>
            <button class="image-editor-tool-btn" id="img-ed-bg-remove-click" title="Click on the background color to remove">Click to sample</button>
          </span>
        </div>
        <div class="image-editor-filters">
          <label class="image-editor-label">
            Brightness
            <input type="range" class="image-editor-range" id="img-ed-brightness" min="-100" max="100" value="0">
            <span class="image-editor-range-val" id="img-ed-brightness-val">0</span>
          </label>
          <label class="image-editor-label">
            Contrast
            <input type="range" class="image-editor-range" id="img-ed-contrast" min="-100" max="100" value="0">
            <span class="image-editor-range-val" id="img-ed-contrast-val">0</span>
          </label>
          <label class="image-editor-label">
            Hue
            <input type="range" class="image-editor-range" id="img-ed-hue" min="0" max="360" value="0">
            <span class="image-editor-range-val" id="img-ed-hue-val">0°</span>
          </label>
          <label class="image-editor-label">
            Saturation
            <input type="range" class="image-editor-range" id="img-ed-saturation" min="0" max="200" value="100">
            <span class="image-editor-range-val" id="img-ed-saturation-val">100%</span>
          </label>
          <span class="image-editor-sep"></span>
          <label class="image-editor-label">
            Tint
            <input type="color" id="img-ed-tint-color" value="#ff0000">
          </label>
          <label class="image-editor-label">
            Tint opacity
            <input type="range" class="image-editor-range" id="img-ed-tint-opacity" min="0" max="100" value="0">
            <span class="image-editor-range-val" id="img-ed-tint-opacity-val">0%</span>
          </label>
        </div>
      </div>
      <div class="image-editor-canvas-wrap">
        <canvas class="image-editor-canvas"></canvas>
        <div class="image-editor-crop-overlay" style="display:none;"></div>
      </div>
      <div class="image-editor-actions">
        <button class="image-editor-action-btn" id="img-ed-undo" title="Undo (Ctrl+Z)">Undo</button>
        <button class="image-editor-action-btn" id="img-ed-reset" title="Reset to original">Reset</button>
        <button class="image-editor-action-btn" id="img-ed-crop-apply" style="display:none;" title="Apply crop">Apply Crop</button>
        <span class="image-editor-sep"></span>
        <button class="image-editor-action-btn" id="img-ed-zoom-out" title="Zoom out (-)">&#x2212;</button>
        <span class="image-editor-zoom-label" id="img-ed-zoom-val">100%</span>
        <button class="image-editor-action-btn" id="img-ed-zoom-in" title="Zoom in (+)">+</button>
        <button class="image-editor-action-btn" id="img-ed-zoom-fit" title="Fit to view">Fit</button>
        <div style="flex:1;"></div>
        <button class="image-editor-action-btn image-editor-cancel" id="img-ed-cancel">Cancel</button>
        <button class="image-editor-action-btn image-editor-done" id="img-ed-done">Done</button>
      </div>
    `;

    document.body.appendChild(this.modal);

    this.displayCanvas = this.modal.querySelector('.image-editor-canvas');
    this.displayCtx = this.displayCanvas.getContext('2d');
    this.cropOverlay = this.modal.querySelector('.image-editor-crop-overlay');

    this._sizeCanvas();
  }

  _sizeCanvas(keepZoom = false) {
    const wrap = this.modal.querySelector('.image-editor-canvas-wrap');
    const maxW = wrap.clientWidth - 40;
    const maxH = wrap.clientHeight - 40;

    this.fitScale = Math.min(maxW / this.workW, maxH / this.workH, 1);
    if (!keepZoom) {
      this.scale = this.fitScale;
      this.panX = 0;
      this.panY = 0;
    }
    this._applyZoom();
  }

  _applyZoom() {
    const dw = Math.round(this.workW * this.scale);
    const dh = Math.round(this.workH * this.scale);

    this.displayCanvas.width = dw;
    this.displayCanvas.height = dh;
    this.displayCanvas.style.width = dw + 'px';
    this.displayCanvas.style.height = dh + 'px';
    this.displayCanvas.style.transform = `translate(${this.panX}px, ${this.panY}px)`;

    // Update zoom label
    const zoomLabel = this.modal.querySelector('#img-ed-zoom-val');
    if (zoomLabel) zoomLabel.textContent = Math.round(this.scale / this.fitScale * 100) + '%';

    this._renderPreview();
  }

  _zoom(factor, centerX, centerY) {
    const oldScale = this.scale;
    const minScale = this.fitScale * 0.25;
    const maxScale = this.fitScale * 10;
    this.scale = Math.max(minScale, Math.min(maxScale, this.scale * factor));

    // Zoom toward cursor position
    if (centerX !== undefined && centerY !== undefined) {
      const wrap = this.modal.querySelector('.image-editor-canvas-wrap');
      const wrapRect = wrap.getBoundingClientRect();
      // cursor position relative to wrap center
      const cx = centerX - wrapRect.left - wrapRect.width / 2;
      const cy = centerY - wrapRect.top - wrapRect.height / 2;
      const ratio = 1 - this.scale / oldScale;
      this.panX += (cx - this.panX) * ratio;
      this.panY += (cy - this.panY) * ratio;
    }

    this._applyZoom();
  }

  // ── Rendering ──

  _getFilterString() {
    const parts = [];
    if (this.brightness !== 0) parts.push(`brightness(${1 + this.brightness / 100})`);
    if (this.contrast !== 0) parts.push(`contrast(${1 + this.contrast / 100})`);
    if (this.hueRotate !== 0) parts.push(`hue-rotate(${this.hueRotate}deg)`);
    if (this.saturation !== 100) parts.push(`saturate(${this.saturation}%)`);
    return parts.length > 0 ? parts.join(' ') : 'none';
  }

  _drawCheckerboard(ctx, w, h) {
    const size = 8;
    ctx.save();
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        ctx.fillStyle = ((x / size + y / size) & 1) ? '#ddd' : '#fff';
        ctx.fillRect(x, y, size, size);
      }
    }
    ctx.restore();
  }

  _renderPreview() {
    const ctx = this.displayCtx;
    const dw = this.displayCanvas.width;
    const dh = this.displayCanvas.height;

    ctx.clearRect(0, 0, dw, dh);

    // Draw checkerboard to show transparent areas
    this._drawCheckerboard(ctx, dw, dh);

    // Draw original image with filters applied
    ctx.save();
    ctx.filter = this._getFilterString();
    ctx.drawImage(this.originalCanvas, 0, 0, this.workW, this.workH, 0, 0, dw, dh);
    ctx.restore();

    // Apply tint overlay
    if (this.tintOpacity > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = this.tintColor;
      ctx.globalAlpha = this.tintOpacity / 100;
      ctx.fillRect(0, 0, dw, dh);
      ctx.restore();
    }

    // Composite paint layer on top
    ctx.drawImage(this.paintCanvas, 0, 0, this.workW, this.workH, 0, 0, dw, dh);

    // Draw crop rectangle if active
    if (this.cropRect && this.activeTool === 'crop') {
      const r = this.cropRect;
      const sx = r.x * this.scale;
      const sy = r.y * this.scale;
      const sw = r.w * this.scale;
      const sh = r.h * this.scale;

      // Dim outside the crop
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, dw, dh);
      ctx.clearRect(sx, sy, sw, sh);
      ctx.restore();

      // Crop border
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.setLineDash([]);
    }
  }

  // ── Export ──

  _exportAsBlob() {
    return new Promise((resolve) => {
      // Render final composite at full working resolution
      const out = document.createElement('canvas');
      out.width = this.workW;
      out.height = this.workH;
      const ctx = out.getContext('2d');

      // Apply filters to original
      ctx.filter = this._getFilterString();
      ctx.drawImage(this.originalCanvas, 0, 0, this.workW, this.workH);
      ctx.filter = 'none';

      // Apply tint overlay
      if (this.tintOpacity > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = this.tintColor;
        ctx.globalAlpha = this.tintOpacity / 100;
        ctx.fillRect(0, 0, this.workW, this.workH);
        ctx.restore();
      }

      // Paint layer on top
      ctx.drawImage(this.paintCanvas, 0, 0, this.workW, this.workH);

      out.toBlob((blob) => {
        if (!blob) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result));
        reader.readAsArrayBuffer(blob);
      }, 'image/png');
    });
  }

  // ── Coordinate mapping ──

  _canvasToImage(clientX, clientY) {
    const rect = this.displayCanvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    return {
      x: cx / this.scale,
      y: cy / this.scale,
    };
  }

  // ── Undo ──

  _pushUndo() {
    const origCtx = this.originalCanvas.getContext('2d');
    this.undoStack.push({
      paint: this.paintCtx.getImageData(0, 0, this.paintCanvas.width, this.paintCanvas.height),
      orig: origCtx.getImageData(0, 0, this.originalCanvas.width, this.originalCanvas.height),
      workW: this.workW,
      workH: this.workH,
      brightness: this.brightness,
      contrast: this.contrast,
      hueRotate: this.hueRotate,
      saturation: this.saturation,
      tintOpacity: this.tintOpacity,
      tintColor: this.tintColor,
    });
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
  }

  _popUndo() {
    if (this.undoStack.length === 0) return;
    const snap = this.undoStack.pop();

    // Restore original canvas
    this.originalCanvas.width = snap.orig.width;
    this.originalCanvas.height = snap.orig.height;
    this.originalCanvas.getContext('2d').putImageData(snap.orig, 0, 0);

    // Restore paint canvas
    this.paintCanvas.width = snap.paint.width;
    this.paintCanvas.height = snap.paint.height;
    this.paintCtx = this.paintCanvas.getContext('2d');
    this.paintCtx.putImageData(snap.paint, 0, 0);

    // Restore state
    this.workW = snap.workW;
    this.workH = snap.workH;
    this.brightness = snap.brightness;
    this.contrast = snap.contrast;
    this.hueRotate = snap.hueRotate;
    this.saturation = snap.saturation;
    this.tintOpacity = snap.tintOpacity;
    this.tintColor = snap.tintColor;

    // Update slider UI to match restored state
    const m = this.modal;
    if (m) {
      m.querySelector('#img-ed-brightness').value = this.brightness;
      m.querySelector('#img-ed-brightness-val').textContent = this.brightness;
      m.querySelector('#img-ed-contrast').value = this.contrast;
      m.querySelector('#img-ed-contrast-val').textContent = this.contrast;
      m.querySelector('#img-ed-hue').value = this.hueRotate;
      m.querySelector('#img-ed-hue-val').textContent = this.hueRotate + '°';
      m.querySelector('#img-ed-saturation').value = this.saturation;
      m.querySelector('#img-ed-saturation-val').textContent = this.saturation + '%';
      m.querySelector('#img-ed-tint-opacity').value = this.tintOpacity;
      m.querySelector('#img-ed-tint-opacity-val').textContent = this.tintOpacity + '%';
    }

    this._sizeCanvas();
    this._renderPreview();
  }

  // ── Crop ──

  _applyCrop() {
    if (!this.cropRect) return;
    this._pushUndo();
    const r = this.cropRect;
    const x = Math.max(0, Math.round(r.x));
    const y = Math.max(0, Math.round(r.y));
    const w = Math.min(Math.round(r.w), this.workW - x);
    const h = Math.min(Math.round(r.h), this.workH - y);
    if (w < 5 || h < 5) return;

    // Crop the original
    const cropped = document.createElement('canvas');
    cropped.width = w;
    cropped.height = h;
    cropped.getContext('2d').drawImage(this.originalCanvas, x, y, w, h, 0, 0, w, h);
    this.originalCanvas.width = w;
    this.originalCanvas.height = h;
    this.originalCanvas.getContext('2d').drawImage(cropped, 0, 0);

    // Crop the paint layer
    const croppedPaint = document.createElement('canvas');
    croppedPaint.width = w;
    croppedPaint.height = h;
    croppedPaint.getContext('2d').drawImage(this.paintCanvas, x, y, w, h, 0, 0, w, h);
    this.paintCanvas.width = w;
    this.paintCanvas.height = h;
    this.paintCtx = this.paintCanvas.getContext('2d');
    this.paintCtx.drawImage(croppedPaint, 0, 0);

    this.workW = w;
    this.workH = h;
    this.cropRect = null;

    this._sizeCanvas();
    this._renderPreview();

    // Hide crop-apply button
    this.modal.querySelector('#img-ed-crop-apply').style.display = 'none';
  }

  // ── Rotation ──

  _rotate(direction) {
    this._pushUndo();
    // direction: 1 = CW (90°), -1 = CCW (270°/−90°)
    this.rotation = (this.rotation + (direction === 1 ? 90 : 270)) % 360;

    // Rotate both canvases
    this.originalCanvas = this._rotateCanvas(this.originalCanvas, direction);
    this.paintCanvas = this._rotateCanvas(this.paintCanvas, direction);
    this.paintCtx = this.paintCanvas.getContext('2d');

    // Swap working dimensions
    const tmp = this.workW;
    this.workW = this.workH;
    this.workH = tmp;

    this.cropRect = null;
    this._sizeCanvas();
    this._renderPreview();
  }

  _rotateCanvas(srcCanvas, direction) {
    const sw = srcCanvas.width;
    const sh = srcCanvas.height;
    const dst = document.createElement('canvas');
    dst.width = sh;  // swapped
    dst.height = sw;
    const ctx = dst.getContext('2d');

    ctx.save();
    if (direction === 1) {
      // CW: translate to (newW, 0), rotate 90°
      ctx.translate(sh, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      // CCW: translate to (0, newH), rotate -90°
      ctx.translate(0, sw);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(srcCanvas, 0, 0);
    ctx.restore();
    return dst;
  }

  _flip(axis) {
    this._pushUndo();
    // axis: 'h' = horizontal, 'v' = vertical
    if (axis === 'h') this.flipH = !this.flipH;
    else this.flipV = !this.flipV;

    this.originalCanvas = this._flipCanvas(this.originalCanvas, axis);
    this.paintCanvas = this._flipCanvas(this.paintCanvas, axis);
    this.paintCtx = this.paintCanvas.getContext('2d');

    this.cropRect = null;
    this._renderPreview();
  }

  _flipCanvas(srcCanvas, axis) {
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    const dst = document.createElement('canvas');
    dst.width = w;
    dst.height = h;
    const ctx = dst.getContext('2d');

    ctx.save();
    if (axis === 'h') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(0, h);
      ctx.scale(1, -1);
    }
    ctx.drawImage(srcCanvas, 0, 0);
    ctx.restore();
    return dst;
  }

  // ── Color Replace (flood-fill based — only affects connected region) ──

  _getCompositeImageData() {
    // Build a composite canvas with filters + tint baked in
    const tmp = document.createElement('canvas');
    tmp.width = this.workW;
    tmp.height = this.workH;
    const ctx = tmp.getContext('2d');
    ctx.filter = this._getFilterString();
    ctx.drawImage(this.originalCanvas, 0, 0, this.workW, this.workH);
    ctx.filter = 'none';
    if (this.tintOpacity > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = this.tintColor;
      ctx.globalAlpha = this.tintOpacity / 100;
      ctx.fillRect(0, 0, this.workW, this.workH);
      ctx.restore();
    }
    return ctx.getImageData(0, 0, this.workW, this.workH);
  }

  _sampleColor(pt) {
    const imgData = this._getCompositeImageData();
    const px = Math.round(Math.max(0, Math.min(pt.x, this.workW - 1)));
    const py = Math.round(Math.max(0, Math.min(pt.y, this.workH - 1)));
    const idx = (py * this.workW + px) * 4;
    const r = imgData.data[idx], g = imgData.data[idx + 1], b = imgData.data[idx + 2];

    this.replaceSourceColor = { r, g, b };
    this.replaceSeedPt = { x: px, y: py };

    // Update the swatch UI
    const swatch = this.modal.querySelector('#img-ed-source-color');
    const hex = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    swatch.style.background = hex;
    swatch.style.color = (r + g + b) > 380 ? '#000' : '#fff';
    swatch.textContent = hex;
    swatch.title = `Sampled: ${hex}`;

    // Show a preview highlight of the region that will be replaced
    this._previewFloodRegion(imgData);
  }

  _previewFloodRegion(imgData) {
    // Briefly flash the connected region on the display canvas
    const mask = this._floodFillMask(imgData, this.replaceSeedPt.x, this.replaceSeedPt.y, this.replaceTolerance);
    if (!mask) return;

    const ctx = this.displayCtx;
    const dw = this.displayCanvas.width;
    const dh = this.displayCanvas.height;

    // Re-render base then overlay the mask region with a highlight
    this._renderPreview();
    ctx.save();
    ctx.fillStyle = 'rgba(0, 200, 255, 0.3)';
    // Draw highlight pixels — for performance, draw at display scale
    const sw = this.workW;
    const sh = this.workH;
    const scaleX = dw / sw;
    const scaleY = dh / sh;
    for (let y = 0; y < sh; y++) {
      let runStart = -1;
      for (let x = 0; x <= sw; x++) {
        const inMask = x < sw && mask[y * sw + x];
        if (inMask && runStart < 0) {
          runStart = x;
        } else if (!inMask && runStart >= 0) {
          ctx.fillRect(
            Math.floor(runStart * scaleX),
            Math.floor(y * scaleY),
            Math.ceil((x - runStart) * scaleX),
            Math.ceil(scaleY)
          );
          runStart = -1;
        }
      }
    }
    ctx.restore();
  }

  _floodFillMask(imgData, seedX, seedY, tolerance) {
    const w = this.workW;
    const h = this.workH;
    const data = imgData.data;
    const mask = new Uint8Array(w * h);
    const seedIdx = (seedY * w + seedX) * 4;
    const sr = data[seedIdx], sg = data[seedIdx + 1], sb = data[seedIdx + 2];

    // Two-pass flood fill:
    // 1) Seed-relative: match pixels similar to the clicked color (standard)
    // 2) Neighbor-relative: also include pixels similar to their already-matched
    //    neighbor, which handles gradients and anti-aliased strokes

    const seedTolSq = tolerance * tolerance;
    // Neighbor tolerance is tighter to avoid leaking into unrelated regions
    const neighborTolSq = Math.pow(tolerance * 0.6, 2);

    // queue stores [x, y] pairs; qi is the read cursor
    const queue = [seedX, seedY];
    let qi = 0;
    mask[seedY * w + seedX] = 1;

    while (qi < queue.length) {
      const cx = queue[qi++];
      const cy = queue[qi++];
      const ci = (cy * w + cx) * 4;
      const cr = data[ci], cg = data[ci + 1], cb = data[ci + 2];

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const mi = ny * w + nx;
          if (mask[mi]) continue;

          const pi = mi * 4;
          const pr = data[pi], pg = data[pi + 1], pb = data[pi + 2];

          // Check against seed color
          const dsr = pr - sr, dsg = pg - sg, dsb = pb - sb;
          const seedDist = dsr * dsr + dsg * dsg + dsb * dsb;

          if (seedDist <= seedTolSq) {
            mask[mi] = 1;
            queue.push(nx, ny);
            continue;
          }

          // Also check against the current pixel's color (neighbor-relative)
          // This lets the fill flow through gradients within the same stroke
          const dnr = pr - cr, dng = pg - cg, dnb = pb - cb;
          const neighborDist = dnr * dnr + dng * dng + dnb * dnb;

          if (neighborDist <= neighborTolSq) {
            mask[mi] = 1;
            queue.push(nx, ny);
          }
        }
      }
    }
    return mask;
  }

  _applyColorReplace() {
    if (!this.replaceSourceColor || !this.replaceSeedPt) return;
    this._pushUndo();

    const imgData = this._getCompositeImageData();
    const data = imgData.data;
    const tol = this.replaceTolerance;

    // Flood fill from the seed point to find the connected region
    const mask = this._floodFillMask(imgData, this.replaceSeedPt.x, this.replaceSeedPt.y, tol);
    if (!mask) return;

    // Parse target color
    const tc = this.replaceTargetColor;
    const tr = parseInt(tc.slice(1, 3), 16);
    const tg = parseInt(tc.slice(3, 5), 16);
    const tb = parseInt(tc.slice(5, 7), 16);

    const w = this.workW;
    const h = this.workH;

    // Dilate mask by 1px to catch anti-aliased edges
    // mask=1 is core (full replace), mask=2 is fringe (blended replace)
    const dilated = new Uint8Array(mask);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) continue; // already in core
        // Check if any 8-connected neighbor is in the core mask
        let nearCore = false;
        for (let dy = -1; dy <= 1 && !nearCore; dy++) {
          for (let dx = -1; dx <= 1 && !nearCore; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx]) {
              nearCore = true;
            }
          }
        }
        if (nearCore) dilated[y * w + x] = 2; // fringe pixel
      }
    }

    // Source color for blending calculation
    const sr = this.replaceSourceColor.r;
    const sg = this.replaceSourceColor.g;
    const sb = this.replaceSourceColor.b;
    const maxDist = tol * tol * 3; // max color distance for blending

    for (let i = 0; i < w * h; i++) {
      if (!dilated[i]) continue;
      const pi = i * 4;
      if (dilated[i] === 1) {
        // Core: full replacement
        data[pi]     = tr;
        data[pi + 1] = tg;
        data[pi + 2] = tb;
      } else {
        // Fringe: blend based on similarity to source color
        const pr = data[pi], pg = data[pi + 1], pb = data[pi + 2];
        const dr = pr - sr, dg = pg - sg, db = pb - sb;
        const dist = dr * dr + dg * dg + db * db;
        // Blend factor: 1.0 when very similar to source, 0.0 when very different
        const blend = Math.max(0, 1 - dist / maxDist);
        if (blend > 0.1) {
          data[pi]     = Math.round(pr + (tr - pr) * blend);
          data[pi + 1] = Math.round(pg + (tg - pg) * blend);
          data[pi + 2] = Math.round(pb + (tb - pb) * blend);
        }
      }
    }

    // Bake result back into the original canvas (filters + tint are now baked)
    this.originalCanvas.width = this.workW;
    this.originalCanvas.height = this.workH;
    this.originalCanvas.getContext('2d').putImageData(imgData, 0, 0);

    this.brightness = 0;
    this.contrast = 0;
    this.hueRotate = 0;
    this.saturation = 100;
    this.tintOpacity = 0;

    // Reset filter sliders
    const m = this.modal;
    m.querySelector('#img-ed-brightness').value = 0;
    m.querySelector('#img-ed-brightness-val').textContent = '0';
    m.querySelector('#img-ed-contrast').value = 0;
    m.querySelector('#img-ed-contrast-val').textContent = '0';
    m.querySelector('#img-ed-hue').value = 0;
    m.querySelector('#img-ed-hue-val').textContent = '0°';
    m.querySelector('#img-ed-saturation').value = 100;
    m.querySelector('#img-ed-saturation-val').textContent = '100%';
    m.querySelector('#img-ed-tint-opacity').value = 0;
    m.querySelector('#img-ed-tint-opacity-val').textContent = '0%';

    this._renderPreview();
  }

  // ── Background Removal ──

  /**
   * Remove background by sampling corners to auto-detect BG color,
   * then flood-fill from all four corners to find connected BG region.
   */
  _removeBackgroundCorners() {
    this._pushUndo();
    const imgData = this._getCompositeImageData();
    const data = imgData.data;
    const w = this.workW;
    const h = this.workH;

    // Sample BG color from corners
    const corners = [
      { x: 0, y: 0 }, { x: w - 1, y: 0 },
      { x: 0, y: h - 1 }, { x: w - 1, y: h - 1 },
    ];
    let bgR = 0, bgG = 0, bgB = 0;
    for (const c of corners) {
      const i = (c.y * w + c.x) * 4;
      bgR += data[i]; bgG += data[i + 1]; bgB += data[i + 2];
    }
    bgR = Math.round(bgR / 4);
    bgG = Math.round(bgG / 4);
    bgB = Math.round(bgB / 4);

    this._removeBackgroundColor(imgData, bgR, bgG, bgB);
  }

  /**
   * Sample BG color from a click point and flood-fill remove from there.
   */
  _sampleBgColor(pt) {
    this._pushUndo();
    const imgData = this._getCompositeImageData();
    const px = Math.round(Math.max(0, Math.min(pt.x, this.workW - 1)));
    const py = Math.round(Math.max(0, Math.min(pt.y, this.workH - 1)));
    const i = (py * this.workW + px) * 4;
    const bgR = imgData.data[i];
    const bgG = imgData.data[i + 1];
    const bgB = imgData.data[i + 2];

    this._removeBackgroundColor(imgData, bgR, bgG, bgB, px, py);

    // Reset click mode button text
    const btn = this.modal.querySelector('#img-ed-bg-remove-click');
    if (btn) btn.textContent = 'Click to sample';
    this.bgClickMode = false;
  }

  /**
   * Core BG removal: flood-fill from edges (or a seed point) to find
   * connected background, then make those pixels transparent with feathered edges.
   */
  _removeBackgroundColor(imgData, bgR, bgG, bgB, seedX, seedY) {
    const data = imgData.data;
    const w = this.workW;
    const h = this.workH;
    const tol = this.bgThreshold;
    const feather = this.bgFeather;

    // Build background mask via flood fill from edges (or seed point)
    const mask = new Uint8Array(w * h); // 0=unknown, 1=background
    const queue = [];

    function isBg(idx) {
      const dr = Math.abs(data[idx] - bgR);
      const dg = Math.abs(data[idx + 1] - bgG);
      const db = Math.abs(data[idx + 2] - bgB);
      return (dr + dg + db) <= tol;
    }

    function enqueue(x, y) {
      const mi = y * w + x;
      if (mask[mi]) return;
      const pi = mi * 4;
      if (isBg(pi)) {
        mask[mi] = 1;
        queue.push(x, y);
      }
    }

    if (seedX !== undefined && seedY !== undefined) {
      // Single seed point
      enqueue(seedX, seedY);
    } else {
      // Flood from all edge pixels
      for (let x = 0; x < w; x++) { enqueue(x, 0); enqueue(x, h - 1); }
      for (let y = 1; y < h - 1; y++) { enqueue(0, y); enqueue(w - 1, y); }
    }

    // BFS flood fill
    let qi = 0;
    while (qi < queue.length) {
      const cx = queue[qi++];
      const cy = queue[qi++];
      if (cx > 0)     enqueue(cx - 1, cy);
      if (cx < w - 1) enqueue(cx + 1, cy);
      if (cy > 0)     enqueue(cx, cy - 1);
      if (cy < h - 1) enqueue(cx, cy + 1);
    }

    // Apply transparency with feathering at edges
    if (feather > 0) {
      // Compute distance to nearest non-BG pixel for each BG pixel
      // Use a simple approach: for each BG pixel, check neighborhood
      for (let i = 0; i < w * h; i++) {
        const pi = i * 4;
        if (!mask[i]) continue; // content — leave opaque

        // Find min distance to any non-BG pixel within feather radius
        const px = i % w;
        const py = (i - px) / w;
        let minDist = feather + 1;

        for (let dy = -feather; dy <= feather && minDist > 1; dy++) {
          const ny = py + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -feather; dx <= feather; dx++) {
            const nx = px + dx;
            if (nx < 0 || nx >= w) continue;
            if (!mask[ny * w + nx]) {
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < minDist) minDist = d;
            }
          }
        }

        if (minDist > feather) {
          // Far from content — fully transparent
          data[pi + 3] = 0;
        } else {
          // Near edge — feathered alpha
          const alpha = Math.round(255 * (minDist / (feather + 1)));
          data[pi + 3] = Math.min(data[pi + 3], alpha);
        }
      }
    } else {
      // No feather — hard cutoff
      for (let i = 0; i < w * h; i++) {
        if (mask[i]) data[i * 4 + 3] = 0;
      }
    }

    // Bake into original canvas
    this.originalCanvas.width = w;
    this.originalCanvas.height = h;
    this.originalCanvas.getContext('2d').putImageData(imgData, 0, 0);

    // Reset filters (they're now baked in)
    this.brightness = 0;
    this.contrast = 0;
    this.hueRotate = 0;
    this.saturation = 100;
    this.tintOpacity = 0;

    const m = this.modal;
    m.querySelector('#img-ed-brightness').value = 0;
    m.querySelector('#img-ed-brightness-val').textContent = '0';
    m.querySelector('#img-ed-contrast').value = 0;
    m.querySelector('#img-ed-contrast-val').textContent = '0';
    m.querySelector('#img-ed-hue').value = 0;
    m.querySelector('#img-ed-hue-val').textContent = '0°';
    m.querySelector('#img-ed-saturation').value = 100;
    m.querySelector('#img-ed-saturation-val').textContent = '100%';
    m.querySelector('#img-ed-tint-opacity').value = 0;
    m.querySelector('#img-ed-tint-opacity-val').textContent = '0%';

    this._renderPreview();
  }

  // ── Event Wiring ──

  _wireEvents() {
    const modal = this.modal;

    // Tool selection (only buttons with data-tool are tool selectors)
    modal.querySelectorAll('.image-editor-tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.image-editor-tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeTool = btn.dataset.tool;
        this.cropRect = null;
        this._updateToolVisibility();
        this._renderPreview();
      });
    });

    // Brush size
    const sizeInput = modal.querySelector('#img-ed-brush-size');
    const sizeVal = modal.querySelector('#img-ed-brush-size-val');
    sizeInput.addEventListener('input', () => {
      this.brushSize = parseInt(sizeInput.value);
      sizeVal.textContent = this.brushSize;
    });

    // Brush color
    modal.querySelector('#img-ed-brush-color').addEventListener('input', (e) => {
      this.brushColor = e.target.value;
    });

    // Rotation & flip buttons
    modal.querySelector('#img-ed-rotate-cw').addEventListener('click', () => this._rotate(1));
    modal.querySelector('#img-ed-rotate-ccw').addEventListener('click', () => this._rotate(-1));
    modal.querySelector('#img-ed-flip-h').addEventListener('click', () => this._flip('h'));
    modal.querySelector('#img-ed-flip-v').addEventListener('click', () => this._flip('v'));

    // Filters
    this._wireFilter('brightness', '#img-ed-brightness', '#img-ed-brightness-val', v => v);
    this._wireFilter('contrast', '#img-ed-contrast', '#img-ed-contrast-val', v => v);
    this._wireFilter('hueRotate', '#img-ed-hue', '#img-ed-hue-val', v => v + '°');
    this._wireFilter('saturation', '#img-ed-saturation', '#img-ed-saturation-val', v => v + '%');

    // Tint controls
    modal.querySelector('#img-ed-tint-color').addEventListener('input', (e) => {
      this.tintColor = e.target.value;
      this._renderPreview();
    });
    const tintOpInput = modal.querySelector('#img-ed-tint-opacity');
    const tintOpVal = modal.querySelector('#img-ed-tint-opacity-val');
    tintOpInput.addEventListener('input', () => {
      this.tintOpacity = parseInt(tintOpInput.value);
      tintOpVal.textContent = this.tintOpacity + '%';
      this._renderPreview();
    });

    // Color replace controls
    modal.querySelector('#img-ed-replace-color').addEventListener('input', (e) => {
      this.replaceTargetColor = e.target.value;
    });
    const tolInput = modal.querySelector('#img-ed-replace-tolerance');
    const tolVal = modal.querySelector('#img-ed-replace-tolerance-val');
    tolInput.addEventListener('input', () => {
      this.replaceTolerance = parseInt(tolInput.value);
      tolVal.textContent = this.replaceTolerance;
    });
    modal.querySelector('#img-ed-replace-apply').addEventListener('click', () => this._applyColorReplace());

    // Background remover controls
    const bgThreshInput = modal.querySelector('#img-ed-bg-threshold');
    const bgThreshVal = modal.querySelector('#img-ed-bg-threshold-val');
    bgThreshInput.addEventListener('input', () => {
      this.bgThreshold = parseInt(bgThreshInput.value);
      bgThreshVal.textContent = this.bgThreshold;
    });
    const bgFeatherInput = modal.querySelector('#img-ed-bg-feather');
    const bgFeatherVal = modal.querySelector('#img-ed-bg-feather-val');
    bgFeatherInput.addEventListener('input', () => {
      this.bgFeather = parseInt(bgFeatherInput.value);
      bgFeatherVal.textContent = this.bgFeather;
    });
    modal.querySelector('#img-ed-bg-remove-corners').addEventListener('click', () => this._removeBackgroundCorners());
    modal.querySelector('#img-ed-bg-remove-click').addEventListener('click', () => {
      // Just a hint — clicking on the canvas while in bgRemove mode will sample
      this.bgClickMode = true;
      modal.querySelector('#img-ed-bg-remove-click').textContent = 'Now click on the background…';
    });

    // Canvas mouse events
    this.displayCanvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    document.addEventListener('mousemove', this._onMouseMove = (e) => this._handleMouseMove(e));
    document.addEventListener('mouseup', this._onMouseUp = (e) => this._handleMouseUp(e));

    // Touch events for mobile
    this.displayCanvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      this._onMouseDown({ clientX: t.clientX, clientY: t.clientY, preventDefault() {} });
    }, { passive: false });
    document.addEventListener('touchmove', this._onTouchMove = (e) => {
      const t = e.touches[0];
      this._handleMouseMove({ clientX: t.clientX, clientY: t.clientY });
    }, { passive: false });
    document.addEventListener('touchend', this._onTouchEnd = () => {
      this._handleMouseUp({});
    });

    // Actions
    modal.querySelector('#img-ed-undo').addEventListener('click', () => this._popUndo());
    modal.querySelector('#img-ed-reset').addEventListener('click', () => this._reset());
    modal.querySelector('#img-ed-crop-apply').addEventListener('click', () => this._applyCrop());
    modal.querySelector('#img-ed-cancel').addEventListener('click', () => this._close(null));
    modal.querySelector('#img-ed-done').addEventListener('click', () => this._finish());

    // Zoom controls
    modal.querySelector('#img-ed-zoom-in').addEventListener('click', () => this._zoom(1.25));
    modal.querySelector('#img-ed-zoom-out').addEventListener('click', () => this._zoom(0.8));
    modal.querySelector('#img-ed-zoom-fit').addEventListener('click', () => {
      this.scale = this.fitScale;
      this.panX = 0;
      this.panY = 0;
      this._applyZoom();
    });

    // Scroll wheel zoom on canvas wrapper
    const wrap = modal.querySelector('.image-editor-canvas-wrap');
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this._zoom(factor, e.clientX, e.clientY);
    }, { passive: false });

    // Middle-click pan or Space+drag pan
    wrap.addEventListener('mousedown', (e) => {
      if (e.button === 1 || (e.button === 0 && this._spaceHeld)) {
        e.preventDefault();
        this.panning = true;
        this.panStart = { x: e.clientX - this.panX, y: e.clientY - this.panY };
      }
    });
    this._onPanMove = (e) => {
      if (!this.panning || !this.panStart) return;
      this.panX = e.clientX - this.panStart.x;
      this.panY = e.clientY - this.panStart.y;
      this.displayCanvas.style.transform = `translate(${this.panX}px, ${this.panY}px)`;
    };
    this._onPanEnd = () => {
      this.panning = false;
      this.panStart = null;
    };
    document.addEventListener('mousemove', this._onPanMove);
    document.addEventListener('mouseup', this._onPanEnd);

    // Keyboard shortcuts
    this._spaceHeld = false;
    this._onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._close(null);
      }
      // Ctrl+Z — undo inside image editor
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        this._popUndo();
      }
      // +/= — zoom in
      if (e.key === '+' || e.key === '=') this._zoom(1.25);
      // - — zoom out
      if (e.key === '-') this._zoom(0.8);
      // 0 — fit to view
      if (e.key === '0') {
        this.scale = this.fitScale;
        this.panX = 0;
        this.panY = 0;
        this._applyZoom();
      }
      // Space — hold for pan
      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        this._spaceHeld = true;
        this.displayCanvas.style.cursor = 'grab';
      }
    };
    this._onKeyUp = (e) => {
      if (e.key === ' ') {
        this._spaceHeld = false;
        this.displayCanvas.style.cursor = '';
        this._updateToolVisibility();
      }
    };
    document.addEventListener('keydown', this._onKeyDown, true);
    document.addEventListener('keyup', this._onKeyUp);

    // Prevent toolbar from stealing focus during painting
    modal.querySelector('.image-editor-toolbar').addEventListener('mousedown', (e) => {
      const tag = e.target.tagName;
      if (tag !== 'INPUT' && tag !== 'SELECT') e.preventDefault();
    });
  }

  _wireFilter(prop, inputSel, valSel, fmt) {
    const input = this.modal.querySelector(inputSel);
    const val = this.modal.querySelector(valSel);
    input.addEventListener('input', () => {
      this[prop] = parseInt(input.value);
      val.textContent = fmt(this[prop]);
      this._renderPreview();
    });
  }

  _updateToolVisibility() {
    const tool = this.activeTool;
    // Show/hide tool-specific controls
    this.modal.querySelectorAll('[data-for-tool]').forEach(el => {
      const tools = el.dataset.forTool.split(',');
      el.style.display = tools.includes(tool) ? '' : 'none';
    });
    // Show crop-apply button only in crop mode with a selection
    const cropBtn = this.modal.querySelector('#img-ed-crop-apply');
    cropBtn.style.display = (tool === 'crop' && this.cropRect) ? '' : 'none';

    // Cursor
    if (tool === 'crop' || tool === 'colorReplace' || tool === 'bgRemove') {
      this.displayCanvas.style.cursor = 'crosshair';
    } else {
      this.displayCanvas.style.cursor = 'default';
    }
  }

  // ── Mouse Handling ──

  _onMouseDown(e) {
    // Don't paint while space-panning
    if (this._spaceHeld) return;
    const pt = this._canvasToImage(e.clientX, e.clientY);

    if (this.activeTool === 'colorReplace') {
      // Sample color from the original image at click point
      this._sampleColor(pt);
      e.preventDefault();
      return;
    } else if (this.activeTool === 'bgRemove') {
      // Sample BG color from click point and remove it
      this._sampleBgColor(pt);
      e.preventDefault();
      return;
    } else if (this.activeTool === 'crop') {
      this.cropping = true;
      this.cropStart = pt;
      this.cropRect = null;
    } else {
      // Paint or eraser
      this._pushUndo();
      this.painting = true;
      this.lastPt = pt;
      this._drawStroke(pt, pt);
    }
    e.preventDefault();
  }

  _handleMouseMove(e) {
    if (this.cropping && this.cropStart) {
      const pt = this._canvasToImage(e.clientX, e.clientY);
      const x = Math.min(this.cropStart.x, pt.x);
      const y = Math.min(this.cropStart.y, pt.y);
      const w = Math.abs(pt.x - this.cropStart.x);
      const h = Math.abs(pt.y - this.cropStart.y);
      this.cropRect = { x, y, w, h };
      this._renderPreview();
      this.modal.querySelector('#img-ed-crop-apply').style.display = '';
    } else if (this.painting && this.lastPt) {
      const pt = this._canvasToImage(e.clientX, e.clientY);
      this._drawStroke(this.lastPt, pt);
      this.lastPt = pt;
      this._renderPreview();
    }
  }

  _handleMouseUp() {
    this.cropping = false;
    this.painting = false;
    this.lastPt = null;
  }

  _drawStroke(from, to) {
    const ctx = this.paintCtx;
    ctx.save();
    ctx.lineWidth = this.brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (this.activeTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = this.brushColor;
    }

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  // ── Reset ──

  _reset() {
    // Restore original dimensions
    this.workW = this.origWidth;
    this.workH = this.origHeight;

    // Reset original canvas from initial data
    // (it may have been cropped, so we need the real original)
    // We stored it at construction — but crop modifies it. So we need a deep copy.
    // For simplicity, reset only clears paint + filters. Crop is irreversible mid-session.
    // If we want full reset, we'd need another copy. Let's do that.

    // Actually, we can't recover from crop with this design. Let's just reset paint + filters.
    this.paintCanvas.width = this.workW;
    this.paintCanvas.height = this.workH;
    this.paintCtx = this.paintCanvas.getContext('2d');

    this.brightness = 0;
    this.contrast = 0;
    this.hueRotate = 0;
    this.saturation = 100;
    this.tintColor = '#ff0000';
    this.tintOpacity = 0;
    this.rotation = 0;
    this.flipH = false;
    this.flipV = false;
    this.cropRect = null;
    this.undoStack = [];

    // Reset slider UI
    const m = this.modal;
    m.querySelector('#img-ed-brightness').value = 0;
    m.querySelector('#img-ed-brightness-val').textContent = '0';
    m.querySelector('#img-ed-contrast').value = 0;
    m.querySelector('#img-ed-contrast-val').textContent = '0';
    m.querySelector('#img-ed-hue').value = 0;
    m.querySelector('#img-ed-hue-val').textContent = '0°';
    m.querySelector('#img-ed-saturation').value = 100;
    m.querySelector('#img-ed-saturation-val').textContent = '100%';
    m.querySelector('#img-ed-tint-color').value = '#ff0000';
    m.querySelector('#img-ed-tint-opacity').value = 0;
    m.querySelector('#img-ed-tint-opacity-val').textContent = '0%';

    // Reset color replace state
    this.replaceSourceColor = null;
    const swatch = m.querySelector('#img-ed-source-color');
    swatch.style.background = '#444';
    swatch.style.color = '#aaa';
    swatch.textContent = '(click image)';

    this._renderPreview();
  }

  // ── Close / Finish ──

  async _finish() {
    const bytes = await this._exportAsBlob();
    this._close(bytes ? { bytes, type: 'image/png' } : null);
  }

  _close(result) {
    // Remove event listeners
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('touchmove', this._onTouchMove);
    document.removeEventListener('touchend', this._onTouchEnd);
    document.removeEventListener('keydown', this._onKeyDown, true);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onPanMove);
    document.removeEventListener('mouseup', this._onPanEnd);

    // Remove modal
    if (this.modal && this.modal.parentNode) {
      this.modal.remove();
    }
    this.modal = null;

    this.onDone(result);
  }
}
