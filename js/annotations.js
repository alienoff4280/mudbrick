/**
 * Mudbrick — Annotations (Phase 4)
 * Fabric.js overlay: draw, highlight, text, shapes, stamps, visual cover.
 *
 * Architecture:
 * - One Fabric.js canvas instance that overlays the PDF canvas
 * - Per-page annotation serialization via toJSON/loadFromJSON
 * - Annotations stored in PDF coordinate space (scale 1.0)
 * - Transformed to screen space when rendering at current zoom
 */

import { pushState, undo as historyUndo, redo as historyRedo, canUndo, canRedo, clearHistory } from './history.js';

const getFabric = () => window.fabric;

/* ═══════════════════ State ═══════════════════ */

let fabricCanvas = null;
let currentTool = 'select';
let currentPage = 0;
let currentZoom = 1.0;
let toolOptions = {
  color: '#000000',
  strokeWidth: 2,
  fontSize: 16,
  opacity: 1,
  highlightColor: '#ffff00',
};

// Per-page annotation storage: { pageNum: fabricJSON }
const pageAnnotations = {};

// Custom properties to persist in JSON
const CUSTOM_PROPS = ['mudbrickType', 'noteText', 'noteColor'];

// Suppress auto-save during page transitions
let suppressAutoSave = false;

/* ═══════════════════ Initialization ═══════════════════ */

/**
 * Initialize Fabric.js overlay canvas.
 * Must be called once after DOM is ready.
 */
export function initAnnotations(canvasId = 'fabric-canvas') {
  const fabric = getFabric();
  if (!fabric) {
    console.warn('Fabric.js not loaded');
    return;
  }

  fabricCanvas = new fabric.Canvas(canvasId, {
    selection: true,
    preserveObjectStacking: true,
    renderOnAddRemove: true,
  });

  // Default cursor
  fabricCanvas.defaultCursor = 'default';
  fabricCanvas.hoverCursor = 'move';

  // Listen for object modifications (for future undo/redo)
  fabricCanvas.on('object:added', () => autoSave());
  fabricCanvas.on('object:modified', () => autoSave());
  fabricCanvas.on('object:removed', () => autoSave());

  // Text creation: click to place IText
  fabricCanvas.on('mouse:down', handleCanvasClick);

  return fabricCanvas;
}

export function getCanvas() { return fabricCanvas; }

/* ═══════════════════ Tool Switching ═══════════════════ */

/**
 * Set active annotation tool.
 * Tools: select, hand, text, draw, highlight, shape, stamp, cover
 */
export function setTool(toolName, options = {}) {
  if (!fabricCanvas) return;
  const fabric = getFabric();

  currentTool = toolName;
  Object.assign(toolOptions, options);

  // Reset drawing mode
  fabricCanvas.isDrawingMode = false;
  fabricCanvas.selection = true;
  fabricCanvas.defaultCursor = 'default';
  fabricCanvas.forEachObject(o => { o.selectable = true; o.evented = true; });

  const wrapper = document.getElementById('fabric-canvas-wrapper');

  switch (toolName) {
    case 'select':
      // Let clicks pass through to text-layer for text selection;
      // fabric canvas stays visible for annotation display.
      wrapper.style.pointerEvents = 'none';
      fabricCanvas.hoverCursor = 'move';
      break;

    case 'hand':
      wrapper.style.pointerEvents = 'none'; // let scroll through
      break;

    case 'draw':
      wrapper.style.pointerEvents = 'auto';
      fabricCanvas.isDrawingMode = true;
      fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(fabricCanvas);
      fabricCanvas.freeDrawingBrush.color = toolOptions.color;
      fabricCanvas.freeDrawingBrush.width = toolOptions.strokeWidth * currentZoom;
      fabricCanvas.defaultCursor = 'crosshair';
      break;

    case 'highlight':
      wrapper.style.pointerEvents = 'auto';
      fabricCanvas.isDrawingMode = true;
      fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(fabricCanvas);
      fabricCanvas.freeDrawingBrush.color = hexToRgba(toolOptions.highlightColor, 0.35);
      fabricCanvas.freeDrawingBrush.width = 20 * currentZoom;
      fabricCanvas.defaultCursor = 'crosshair';

      // Mark highlight paths so we can identify them
      fabricCanvas.on('path:created', markHighlightPath);
      break;

    case 'text':
      wrapper.style.pointerEvents = 'auto';
      fabricCanvas.selection = false;
      fabricCanvas.defaultCursor = 'text';
      fabricCanvas.forEachObject(o => { o.selectable = false; o.evented = false; });
      break;

    case 'shape':
      wrapper.style.pointerEvents = 'auto';
      fabricCanvas.selection = false;
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.forEachObject(o => { o.selectable = false; o.evented = false; });
      break;

    case 'stamp':
      wrapper.style.pointerEvents = 'auto';
      fabricCanvas.selection = false;
      fabricCanvas.defaultCursor = 'pointer';
      fabricCanvas.forEachObject(o => { o.selectable = false; o.evented = false; });
      break;

    case 'cover':
      wrapper.style.pointerEvents = 'auto';
      fabricCanvas.selection = false;
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.forEachObject(o => { o.selectable = false; o.evented = false; });
      break;

    case 'redact':
      wrapper.style.pointerEvents = 'auto';
      fabricCanvas.selection = false;
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.forEachObject(o => { o.selectable = false; o.evented = false; });
      break;

    case 'sticky-note':
      wrapper.style.pointerEvents = 'auto';
      fabricCanvas.selection = false;
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.forEachObject(o => { o.selectable = false; o.evented = false; });
      break;

    case 'underline':
      wrapper.style.pointerEvents = 'auto';
      fabricCanvas.isDrawingMode = true;
      fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(fabricCanvas);
      fabricCanvas.freeDrawingBrush.color = toolOptions.underlineColor || toolOptions.color || '#1565c0';
      fabricCanvas.freeDrawingBrush.width = 2 * currentZoom;
      fabricCanvas.defaultCursor = 'text';
      fabricCanvas.on('path:created', markUnderlinePath);
      break;

    case 'strikethrough':
      wrapper.style.pointerEvents = 'auto';
      fabricCanvas.isDrawingMode = true;
      fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(fabricCanvas);
      fabricCanvas.freeDrawingBrush.color = toolOptions.strikethroughColor || '#d32f2f';
      fabricCanvas.freeDrawingBrush.width = 2 * currentZoom;
      fabricCanvas.defaultCursor = 'text';
      fabricCanvas.on('path:created', markStrikethroughPath);
      break;

    default:
      wrapper.style.pointerEvents = 'none';
  }

  // Remove path:created listeners if switching away from those tools
  if (toolName !== 'highlight') {
    fabricCanvas.off('path:created', markHighlightPath);
  }
  if (toolName !== 'underline') {
    fabricCanvas.off('path:created', markUnderlinePath);
  }
  if (toolName !== 'strikethrough') {
    fabricCanvas.off('path:created', markStrikethroughPath);
  }
}

function markHighlightPath(e) {
  if (e.path) {
    e.path.mudbrickType = 'highlight';
    e.path.selectable = false;
    e.path.evented = false;
  }
}

function markUnderlinePath(e) {
  if (e.path) {
    e.path.mudbrickType = 'underline';
  }
}

function markStrikethroughPath(e) {
  if (e.path) {
    e.path.mudbrickType = 'strikethrough';
  }
}

/* ═══════════════════ Canvas Click Handler ═══════════════════ */

let shapeStartPoint = null;
let shapePreview = null;

function handleCanvasClick(opt) {
  if (!fabricCanvas) return;
  const fabric = getFabric();
  const pointer = fabricCanvas.getPointer(opt.e);

  switch (currentTool) {
    case 'text':
      // Don't add text if clicking on existing text object
      if (opt.target) return;
      addText(pointer.x, pointer.y);
      break;

    case 'shape':
      if (!shapeStartPoint) {
        // Start shape drawing
        shapeStartPoint = { x: pointer.x, y: pointer.y };
        startShapePreview(pointer);
      }
      break;

    case 'stamp':
      addStamp(pointer.x, pointer.y);
      break;

    case 'cover':
      if (!shapeStartPoint) {
        shapeStartPoint = { x: pointer.x, y: pointer.y };
        startCoverPreview(pointer);
      }
      break;

    case 'redact':
      if (!shapeStartPoint) {
        shapeStartPoint = { x: pointer.x, y: pointer.y };
        startRedactPreview(pointer);
      }
      break;

    case 'sticky-note':
      if (!opt.target) {
        addStickyNote(pointer.x, pointer.y);
      }
      break;
  }
}

/* ═══════════════════ Text Tool ═══════════════════ */

function addText(x, y) {
  const fabric = getFabric();
  const text = new fabric.IText('Type here', {
    left: x,
    top: y,
    fontFamily: 'Helvetica, Arial, sans-serif',
    fontSize: toolOptions.fontSize * currentZoom,
    fill: toolOptions.color,
    mudbrickType: 'text',
  });
  fabricCanvas.add(text);
  fabricCanvas.setActiveObject(text);
  text.enterEditing();
  text.selectAll();
}

/* ═══════════════════ Shape Tool ═══════════════════ */

function startShapePreview(pointer) {
  const fabric = getFabric();

  // Listen for mouse move and up
  fabricCanvas.on('mouse:move', onShapeMove);
  fabricCanvas.on('mouse:up', onShapeUp);
}

function onShapeMove(opt) {
  const fabric = getFabric();
  const pointer = fabricCanvas.getPointer(opt.e);

  if (shapePreview) {
    fabricCanvas.remove(shapePreview);
  }

  const left = Math.min(shapeStartPoint.x, pointer.x);
  const top = Math.min(shapeStartPoint.y, pointer.y);
  const width = Math.abs(pointer.x - shapeStartPoint.x);
  const height = Math.abs(pointer.y - shapeStartPoint.y);

  const shapeType = toolOptions.shapeType || 'rect';

  if (shapeType === 'rect') {
    shapePreview = new fabric.Rect({
      left, top, width, height,
      fill: 'transparent',
      stroke: toolOptions.color,
      strokeWidth: toolOptions.strokeWidth * currentZoom,
      selectable: false,
      evented: false,
    });
  } else if (shapeType === 'circle') {
    const rx = width / 2;
    const ry = height / 2;
    shapePreview = new fabric.Ellipse({
      left, top, rx, ry,
      fill: 'transparent',
      stroke: toolOptions.color,
      strokeWidth: toolOptions.strokeWidth * currentZoom,
      selectable: false,
      evented: false,
    });
  } else if (shapeType === 'line') {
    shapePreview = new fabric.Line(
      [shapeStartPoint.x, shapeStartPoint.y, pointer.x, pointer.y],
      {
        stroke: toolOptions.color,
        strokeWidth: toolOptions.strokeWidth * currentZoom,
        selectable: false,
        evented: false,
      }
    );
  } else if (shapeType === 'arrow') {
    // Arrow = line + triangle head
    shapePreview = createArrow(shapeStartPoint, pointer);
  }

  if (shapePreview) {
    fabricCanvas.add(shapePreview);
    fabricCanvas.renderAll();
  }
}

function onShapeUp(opt) {
  fabricCanvas.off('mouse:move', onShapeMove);
  fabricCanvas.off('mouse:up', onShapeUp);

  if (shapePreview) {
    // Make the final shape selectable
    shapePreview.set({ selectable: true, evented: true });
    shapePreview.mudbrickType = 'shape';
    fabricCanvas.setActiveObject(shapePreview);
    fabricCanvas.renderAll();
  }

  shapeStartPoint = null;
  shapePreview = null;
}

function createArrow(from, to) {
  const fabric = getFabric();
  const headLen = 15 * currentZoom;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.atan2(dy, dx);

  const line = new fabric.Line([from.x, from.y, to.x, to.y], {
    stroke: toolOptions.color,
    strokeWidth: toolOptions.strokeWidth * currentZoom,
  });

  const head = new fabric.Triangle({
    left: to.x,
    top: to.y,
    originX: 'center',
    originY: 'center',
    angle: (angle * 180 / Math.PI) + 90,
    width: headLen,
    height: headLen,
    fill: toolOptions.color,
  });

  const group = new fabric.Group([line, head], {
    selectable: false,
    evented: false,
  });

  return group;
}

/* ═══════════════════ Visual Cover (Redact) ═══════════════════ */

function startCoverPreview(pointer) {
  fabricCanvas.on('mouse:move', onCoverMove);
  fabricCanvas.on('mouse:up', onCoverUp);
}

function onCoverMove(opt) {
  const fabric = getFabric();
  const pointer = fabricCanvas.getPointer(opt.e);

  if (shapePreview) {
    fabricCanvas.remove(shapePreview);
  }

  const left = Math.min(shapeStartPoint.x, pointer.x);
  const top = Math.min(shapeStartPoint.y, pointer.y);
  const width = Math.abs(pointer.x - shapeStartPoint.x);
  const height = Math.abs(pointer.y - shapeStartPoint.y);

  shapePreview = new fabric.Rect({
    left, top, width, height,
    fill: '#000000',
    stroke: 'none',
    opacity: 1,
    selectable: false,
    evented: false,
    mudbrickType: 'cover',
  });

  fabricCanvas.add(shapePreview);
  fabricCanvas.renderAll();
}

function onCoverUp() {
  fabricCanvas.off('mouse:move', onCoverMove);
  fabricCanvas.off('mouse:up', onCoverUp);

  if (shapePreview) {
    shapePreview.set({ selectable: true, evented: true });
    fabricCanvas.setActiveObject(shapePreview);
    fabricCanvas.renderAll();
  }

  shapeStartPoint = null;
  shapePreview = null;
}

/* ═══════════════════ Visual Redact ═══════════════════ */

function startRedactPreview(pointer) {
  fabricCanvas.on('mouse:move', onRedactMove);
  fabricCanvas.on('mouse:up', onRedactUp);
}

function onRedactMove(opt) {
  const fabric = getFabric();
  const pointer = fabricCanvas.getPointer(opt.e);

  if (shapePreview) {
    fabricCanvas.remove(shapePreview);
  }

  const left = Math.min(shapeStartPoint.x, pointer.x);
  const top = Math.min(shapeStartPoint.y, pointer.y);
  const width = Math.abs(pointer.x - shapeStartPoint.x);
  const height = Math.abs(pointer.y - shapeStartPoint.y);

  // Semi-transparent red rect in editor; becomes solid black on export
  shapePreview = new fabric.Rect({
    left, top, width, height,
    fill: 'rgba(204, 0, 0, 0.3)',
    stroke: '#cc0000',
    strokeWidth: 1,
    selectable: false,
    evented: false,
    mudbrickType: 'redact',
  });

  fabricCanvas.add(shapePreview);
  fabricCanvas.renderAll();
}

function onRedactUp() {
  fabricCanvas.off('mouse:move', onRedactMove);
  fabricCanvas.off('mouse:up', onRedactUp);

  if (shapePreview) {
    shapePreview.set({ selectable: true, evented: true });
    fabricCanvas.setActiveObject(shapePreview);
    fabricCanvas.renderAll();
  }

  shapeStartPoint = null;
  shapePreview = null;
}

/* ═══════════════════ Sticky Notes ═══════════════════ */

const NOTE_COLORS = {
  yellow: '#fff9c4',
  green:  '#c8e6c9',
  blue:   '#bbdefb',
  pink:   '#f8bbd0',
  orange: '#ffe0b2',
};

function addStickyNote(x, y) {
  const fabric = getFabric();
  const color = toolOptions.noteColor || 'yellow';
  const fill = NOTE_COLORS[color] || NOTE_COLORS.yellow;
  const size = 28 * currentZoom;

  const rect = new fabric.Rect({
    width: size,
    height: size,
    fill: fill,
    stroke: '#b0a000',
    strokeWidth: 1,
    rx: 2,
    ry: 2,
    shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.15)', blur: 4, offsetX: 1, offsetY: 2 }),
  });

  // Small icon hint in the center
  const icon = new fabric.Text('📝', {
    fontSize: size * 0.45,
    originX: 'center',
    originY: 'center',
    left: size / 2,
    top: size / 2,
  });

  const group = new fabric.Group([rect, icon], {
    left: x - size / 2,
    top: y - size / 2,
    mudbrickType: 'sticky-note',
    noteText: '',
    noteColor: color,
  });

  fabricCanvas.add(group);
  fabricCanvas.setActiveObject(group);
  fabricCanvas.renderAll();

  // Notify listeners (properties panel) that a new sticky note was placed
  if (typeof onStickyNoteSelected === 'function') {
    onStickyNoteSelected(group);
  }
}

/**
 * Get all sticky notes for all pages.
 * Returns array of { pageNum, index, noteText, noteColor }
 */
export function getAllStickyNotes() {
  const notes = [];
  for (const [pageNum, json] of Object.entries(pageAnnotations)) {
    if (!json || !json.objects) continue;
    json.objects.forEach((obj, idx) => {
      if (obj.mudbrickType === 'sticky-note') {
        notes.push({
          pageNum: Number(pageNum),
          index: idx,
          noteText: obj.noteText || '',
          noteColor: obj.noteColor || 'yellow',
        });
      }
    });
  }
  return notes;
}

/**
 * Update the noteText for the currently selected sticky note.
 */
export function updateSelectedNoteText(text) {
  if (!fabricCanvas) return;
  const active = fabricCanvas.getActiveObject();
  if (active && active.mudbrickType === 'sticky-note') {
    active.noteText = text;
    autoSave();
  }
}

// Callback for sticky note selection (set by app.js)
let onStickyNoteSelected = null;
export function setOnStickyNoteSelected(fn) {
  onStickyNoteSelected = fn;
}

/* ═══════════════════ Stamps ═══════════════════ */

const STAMPS = {
  approved: { text: 'APPROVED', color: '#27ae60' },
  rejected: { text: 'REJECTED', color: '#c0392b' },
  draft: { text: 'DRAFT', color: '#7f8c8d' },
  confidential: { text: 'CONFIDENTIAL', color: '#e74c3c' },
  final: { text: 'FINAL', color: '#2980b9' },
};

function addStamp(x, y) {
  const fabric = getFabric();
  const stampType = toolOptions.stampType || 'approved';
  const stamp = STAMPS[stampType] || STAMPS.approved;
  const size = 24 * currentZoom;

  const text = new fabric.Text(stamp.text, {
    left: x,
    top: y,
    originX: 'center',
    originY: 'center',
    fontFamily: 'Helvetica, Arial, sans-serif',
    fontSize: size,
    fontWeight: 'bold',
    fill: 'transparent',
    stroke: stamp.color,
    strokeWidth: 1.5 * currentZoom,
    angle: -15,
    mudbrickType: 'stamp',
  });

  // Add border rect around stamp
  const padding = 8 * currentZoom;
  const rect = new fabric.Rect({
    left: x,
    top: y,
    originX: 'center',
    originY: 'center',
    width: text.width + padding * 2,
    height: text.height + padding * 2,
    fill: 'transparent',
    stroke: stamp.color,
    strokeWidth: 2 * currentZoom,
    rx: 4 * currentZoom,
    ry: 4 * currentZoom,
    angle: -15,
  });

  const group = new fabric.Group([rect, text], {
    left: x,
    top: y,
    originX: 'center',
    originY: 'center',
    mudbrickType: 'stamp',
  });

  fabricCanvas.add(group);
  fabricCanvas.setActiveObject(group);
}

/* ═══════════════════ Per-Page Save/Restore ═══════════════════ */

/**
 * Save current canvas annotations for the given page.
 * Stores in PDF coordinate space (divided by zoom).
 */
export function savePageAnnotations(pageNum) {
  if (!fabricCanvas) return;
  if (fabricCanvas.getObjects().length === 0) {
    delete pageAnnotations[pageNum];
    return;
  }
  pageAnnotations[pageNum] = fabricCanvas.toJSON(CUSTOM_PROPS);
}

/**
 * Load annotations for the given page.
 * Call after resizeOverlay so dimensions are correct.
 */
export function loadPageAnnotations(pageNum) {
  if (!fabricCanvas) return;

  // Suppress auto-save during clear/load to prevent overwriting saved annotations
  suppressAutoSave = true;
  fabricCanvas.clear();
  currentPage = pageNum;

  const json = pageAnnotations[pageNum];
  if (json) {
    fabricCanvas.loadFromJSON(json, () => {
      suppressAutoSave = false;
      fabricCanvas.renderAll();
      // Push initial state for undo baseline on this page
      if (!canUndo(pageNum)) pushState(pageNum, json);
    });
  } else {
    suppressAutoSave = false;
    // Push empty state as baseline
    if (!canUndo(pageNum)) pushState(pageNum, fabricCanvas.toJSON(CUSTOM_PROPS));
  }
}

function autoSave() {
  if (suppressAutoSave) return;
  if (currentPage > 0) {
    const json = fabricCanvas.toJSON(CUSTOM_PROPS);
    pageAnnotations[currentPage] = json;
    pushState(currentPage, json);
  }
}

export function getAnnotations() {
  return pageAnnotations;
}

export function hasAnnotations() {
  return Object.keys(pageAnnotations).some(k => {
    const json = pageAnnotations[k];
    return json && json.objects && json.objects.length > 0;
  });
}

/* ═══════════════════ Resize & Zoom ═══════════════════ */

/**
 * Resize Fabric canvas to match the PDF viewport dimensions.
 * Called whenever zoom changes or page changes.
 */
export function resizeOverlay(width, height, zoom) {
  if (!fabricCanvas) return;
  currentZoom = zoom || 1.0;

  fabricCanvas.setWidth(width);
  fabricCanvas.setHeight(height);
  fabricCanvas.renderAll();
}

/* ═══════════════════ Tool Options Update ═══════════════════ */

export function updateToolOptions(opts) {
  Object.assign(toolOptions, opts);

  // Update active brush if in drawing mode
  if (fabricCanvas && fabricCanvas.isDrawingMode && fabricCanvas.freeDrawingBrush) {
    if (currentTool === 'draw') {
      fabricCanvas.freeDrawingBrush.color = toolOptions.color;
      fabricCanvas.freeDrawingBrush.width = toolOptions.strokeWidth * currentZoom;
    } else if (currentTool === 'highlight') {
      fabricCanvas.freeDrawingBrush.color = hexToRgba(toolOptions.highlightColor, 0.35);
    }
  }
}

export function getToolOptions() {
  return { ...toolOptions };
}

/* ═══════════════════ Delete Selected ═══════════════════ */

export function deleteSelected() {
  if (!fabricCanvas) return;
  const active = fabricCanvas.getActiveObjects();
  if (active.length === 0) return;

  active.forEach(obj => fabricCanvas.remove(obj));
  fabricCanvas.discardActiveObject();
  fabricCanvas.renderAll();
}

/* ═══════════════════ Image Insertion ═══════════════════ */

/**
 * Insert an image onto the current annotation canvas.
 * @param {string} dataUrl - Base64 data URL of the image
 * @param {string} [name] - Optional filename for reference
 * @returns {Promise<void>}
 */
export function insertImage(dataUrl, name = 'image') {
  return new Promise((resolve, reject) => {
    if (!fabricCanvas) { reject(new Error('Canvas not initialized')); return; }
    const fabric = getFabric();

    fabric.Image.fromURL(dataUrl, (img) => {
      if (!img) { reject(new Error('Failed to load image')); return; }

      // Scale image to fit within the canvas (max 50% of canvas dimension)
      const maxW = fabricCanvas.width * 0.5;
      const maxH = fabricCanvas.height * 0.5;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);

      img.set({
        left: fabricCanvas.width / 2,
        top: fabricCanvas.height / 2,
        originX: 'center',
        originY: 'center',
        scaleX: scale,
        scaleY: scale,
        mudbrickType: 'image',
      });

      fabricCanvas.add(img);
      fabricCanvas.setActiveObject(img);
      fabricCanvas.renderAll();
      resolve();
    }, { crossOrigin: 'anonymous' });
  });
}

/* ═══════════════════ Undo / Redo ═══════════════════ */

/**
 * Undo the last annotation action on the current page.
 */
export function undoAnnotation() {
  if (!fabricCanvas || currentPage <= 0) return;
  const prevState = historyUndo(currentPage);
  if (!prevState) return;

  suppressAutoSave = true;
  fabricCanvas.loadFromJSON(prevState, () => {
    suppressAutoSave = false;
    fabricCanvas.renderAll();
    pageAnnotations[currentPage] = prevState;
  });
}

/**
 * Redo the last undone annotation action on the current page.
 */
export function redoAnnotation() {
  if (!fabricCanvas || currentPage <= 0) return;
  const nextState = historyRedo(currentPage);
  if (!nextState) return;

  suppressAutoSave = true;
  fabricCanvas.loadFromJSON(nextState, () => {
    suppressAutoSave = false;
    fabricCanvas.renderAll();
    pageAnnotations[currentPage] = nextState;
  });
}

export { canUndo, canRedo };

/* ═══════════════════ Z-Ordering ═══════════════════ */

export function bringToFront() {
  if (!fabricCanvas) return;
  const objs = fabricCanvas.getActiveObjects();
  objs.forEach(o => fabricCanvas.bringToFront(o));
  fabricCanvas.discardActiveObject();
  fabricCanvas.renderAll();
}

export function sendToBack() {
  if (!fabricCanvas) return;
  const objs = fabricCanvas.getActiveObjects();
  objs.forEach(o => fabricCanvas.sendToBack(o));
  fabricCanvas.discardActiveObject();
  fabricCanvas.renderAll();
}

export function bringForward() {
  if (!fabricCanvas) return;
  const objs = fabricCanvas.getActiveObjects();
  objs.forEach(o => fabricCanvas.bringForward(o));
  fabricCanvas.renderAll();
}

export function sendBackward() {
  if (!fabricCanvas) return;
  const objs = fabricCanvas.getActiveObjects();
  objs.forEach(o => fabricCanvas.sendBackward(o));
  fabricCanvas.renderAll();
}

/* ═══════════════════ Copy / Paste / Duplicate ═══════════════════ */

let _clipboard = null; // internal clipboard (serialized JSON)

export function copySelected() {
  if (!fabricCanvas) return;
  const active = fabricCanvas.getActiveObject();
  if (!active) return;
  active.clone(cloned => {
    _clipboard = cloned;
  }, CUSTOM_PROPS);
}

export function pasteClipboard() {
  if (!fabricCanvas || !_clipboard) return;
  _clipboard.clone(cloned => {
    fabricCanvas.discardActiveObject();
    cloned.set({
      left: cloned.left + 20,
      top: cloned.top + 20,
      evented: true,
    });
    if (cloned.type === 'activeSelection') {
      cloned.canvas = fabricCanvas;
      cloned.forEachObject(o => fabricCanvas.add(o));
      cloned.setCoords();
    } else {
      fabricCanvas.add(cloned);
    }
    fabricCanvas.setActiveObject(cloned);
    fabricCanvas.renderAll();
  }, CUSTOM_PROPS);
}

export function duplicateSelected() {
  if (!fabricCanvas) return;
  const active = fabricCanvas.getActiveObject();
  if (!active) return;
  active.clone(cloned => {
    fabricCanvas.discardActiveObject();
    cloned.set({
      left: cloned.left + 20,
      top: cloned.top + 20,
      evented: true,
    });
    if (cloned.type === 'activeSelection') {
      cloned.canvas = fabricCanvas;
      cloned.forEachObject(o => fabricCanvas.add(o));
      cloned.setCoords();
    } else {
      fabricCanvas.add(cloned);
    }
    fabricCanvas.setActiveObject(cloned);
    fabricCanvas.renderAll();
  }, CUSTOM_PROPS);
}

/* ═══════════════════ Lock / Unlock ═══════════════════ */

export function lockSelected() {
  if (!fabricCanvas) return;
  fabricCanvas.getActiveObjects().forEach(o => {
    o.set({ lockMovementX: true, lockMovementY: true, lockRotation: true, lockScalingX: true, lockScalingY: true, hasControls: false });
  });
  fabricCanvas.renderAll();
}

export function unlockSelected() {
  if (!fabricCanvas) return;
  fabricCanvas.getActiveObjects().forEach(o => {
    o.set({ lockMovementX: false, lockMovementY: false, lockRotation: false, lockScalingX: false, lockScalingY: false, hasControls: true });
  });
  fabricCanvas.renderAll();
}

/** Check if the active selection is locked */
export function isSelectionLocked() {
  if (!fabricCanvas) return false;
  const active = fabricCanvas.getActiveObject();
  return active ? !!active.lockMovementX : false;
}

/* ═══════════════════ Dispose ═══════════════════ */

export function dispose() {
  if (fabricCanvas) {
    fabricCanvas.dispose();
    fabricCanvas = null;
  }
}

/* ═══════════════════ Helpers ═══════════════════ */

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
