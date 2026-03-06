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
import { createThread, getAuthorName } from './comments.js';

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
const CUSTOM_PROPS = ['mudbrickType', 'noteText', 'noteColor', 'linkType', 'linkURL', 'linkPage', 'commentThread'];

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

  // Sync font property inputs when a text annotation is selected
  function syncFontControls(obj) {
    if (!obj || obj.mudbrickType !== 'text') return;
    const sizeInput = document.getElementById('prop-font-size');
    const familySelect = document.getElementById('prop-font-family');
    if (sizeInput) sizeInput.value = Math.round(obj.fontSize / currentZoom);
    if (familySelect) {
      // Try to match one of the dropdown options
      const family = obj.fontFamily || '';
      const match = [...familySelect.options].find(o => family.includes(o.value.split(',')[0].trim()));
      if (match) familySelect.value = match.value;
    }
  }
  function onTextSelected(e) {
    const obj = e.selected?.[0];
    syncFontControls(obj);
    // Show font property rows when a text annotation is selected
    if (obj && obj.mudbrickType === 'text') {
      const propsSection = document.getElementById('panel-tool-props');
      const fontSizeRow = document.getElementById('prop-font-size-row');
      const fontFamilyRow = document.getElementById('prop-font-family-row');
      if (propsSection) propsSection.style.display = '';
      if (fontSizeRow) fontSizeRow.style.display = '';
      if (fontFamilyRow) fontFamilyRow.style.display = '';
    }
  }
  fabricCanvas.on('selection:created', onTextSelected);
  fabricCanvas.on('selection:updated', onTextSelected);
  fabricCanvas.on('selection:cleared', function () {
    // Hide font rows if not in text tool
    if (currentTool !== 'text') {
      const fontSizeRow = document.getElementById('prop-font-size-row');
      const fontFamilyRow = document.getElementById('prop-font-family-row');
      if (fontSizeRow) fontSizeRow.style.display = 'none';
      if (fontFamilyRow) fontFamilyRow.style.display = 'none';
      // Re-hide the props section if in select mode
      if (currentTool === 'select') {
        const propsSection = document.getElementById('panel-tool-props');
        if (propsSection) propsSection.style.display = 'none';
      }
    }
  });

  // Text creation: click to place IText
  fabricCanvas.on('mouse:down', handleCanvasClick);

  // Double-click on text annotations to re-enter edit mode (works from any tool).
  // Note: dblclick on empty space in select mode naturally reaches the text layer
  // because the wrapper defaults to pointer-events:none in select mode.
  fabricCanvas.on('mouse:dblclick', function (opt) {
    if (opt.target && opt.target.mudbrickType === 'text' && opt.target.type === 'i-text') {
      opt.target.set({ selectable: true, evented: true });
      fabricCanvas.setActiveObject(opt.target);
      opt.target.enterEditing();
      opt.target.setCursorByClick(opt.e);
    }
    // Double-click on link → follow it
    if (opt.target && opt.target.mudbrickType === 'link') {
      document.dispatchEvent(new CustomEvent('link-follow', { detail: { obj: opt.target } }));
    }
  });

  // When user finishes editing text (clicks away), auto-switch to select mode
  // so they can immediately reposition. Also clean up empty/placeholder text.
  fabricCanvas.on('text:editing:exited', function (opt) {
    const text = opt.target;
    if (!text) return;
    // Remove empty or placeholder text
    if (text.text.trim() === '' || text.text === 'Type here') {
      fabricCanvas.remove(text);
      return;
    }
    // Ensure the finished text is fully interactive
    text.set({ selectable: true, evented: true });
    // Auto-switch to select tool for immediate repositioning
    if (currentTool === 'text' && typeof onRequestToolSwitch === 'function') {
      onRequestToolSwitch('select');
    }
    // Keep the text selected and wrapper interactive so the user can
    // immediately move/resize without an extra click
    fabricCanvas.setActiveObject(text);
    fabricCanvas.renderAll();
    const wrapperEl = document.getElementById('fabric-canvas-wrapper');
    if (wrapperEl) wrapperEl.style.pointerEvents = 'auto';
  });

  // In select mode, pointer-events default to 'none' so clicks pass through
  // to the text layer / PDF canvas. We dynamically enable pointer-events on
  // the wrapper ONLY when the cursor hovers over a Fabric annotation object,
  // and keep it enabled during drag interactions.
  _setupSelectHover();

  return fabricCanvas;
}

export function getCanvas() { return fabricCanvas; }

/* ═══════════════════ Select-mode hover detection ═══════════════════ */

/**
 * In select mode the fabric wrapper defaults to pointer-events:none so clicks
 * pass through to the text layer / PDF canvas.  We listen on `document` for
 * mousemove and check whether the cursor is over any Fabric annotation object.
 * If so, we enable pointer-events on the wrapper so Fabric can handle
 * hover/click/drag.  When the cursor leaves all annotations, we disable again.
 */
let _selectInteracting = false;

function _setupSelectHover() {
  const wrapperEl = document.getElementById('fabric-canvas-wrapper');
  if (!wrapperEl) return;

  // Toggle pointer-events based on whether cursor is over an annotation
  document.addEventListener('mousemove', function (e) {
    if (currentTool !== 'select') return;
    if (_selectInteracting) return;            // mid-drag, keep enabled
    if (document.querySelector('.text-edit-active')) return;

    const over = _isOverFabricObject(e.clientX, e.clientY);
    wrapperEl.style.pointerEvents = over ? 'auto' : 'none';
  });

  // While mouse is held down on an annotation, keep wrapper interactive
  // (so dragging / resizing works even if cursor leaves object bounds)
  fabricCanvas.on('mouse:down', function () {
    if (currentTool === 'select') _selectInteracting = true;
  });
  document.addEventListener('mouseup', function () {
    if (!_selectInteracting) return;
    _selectInteracting = false;
    // Next mousemove will re-evaluate
  });
}

/**
 * Check whether (clientX, clientY) is within any Fabric object's bounding box.
 */
function _isOverFabricObject(clientX, clientY) {
  if (!fabricCanvas) return false;
  const objects = fabricCanvas.getObjects();
  if (objects.length === 0) return false;

  const canvasEl = fabricCanvas.upperCanvasEl || fabricCanvas.getElement();
  const rect = canvasEl.getBoundingClientRect();

  // Quick bounds check
  if (clientX < rect.left || clientX > rect.right ||
      clientY < rect.top  || clientY > rect.bottom) return false;

  const pad = 6; // small padding for easier targeting
  for (const obj of objects) {
    if (!obj.visible) continue;
    const b = obj.getBoundingRect();
    const l = rect.left + b.left - pad;
    const t = rect.top  + b.top  - pad;
    if (clientX >= l && clientX <= l + b.width + pad * 2 &&
        clientY >= t && clientY <= t + b.height + pad * 2) {
      return true;
    }
  }
  return false;
}

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

  // Always remove path:created listeners before re-binding to prevent accumulation
  fabricCanvas.off('path:created', markHighlightPath);
  fabricCanvas.off('path:created', markUnderlinePath);
  fabricCanvas.off('path:created', markStrikethroughPath);

  // Remove shape/cover/redact mouse listeners to prevent leaks
  fabricCanvas.off('mouse:move', onShapeMove);
  fabricCanvas.off('mouse:up', onShapeUp);
  fabricCanvas.off('mouse:move', onCoverMove);
  fabricCanvas.off('mouse:up', onCoverUp);
  fabricCanvas.off('mouse:move', onRedactMove);
  fabricCanvas.off('mouse:up', onRedactUp);

  // Clean up any in-progress shape/cover/redact preview
  if (shapePreview) {
    fabricCanvas.remove(shapePreview);
    shapePreview = null;
  }
  shapeStartPoint = null;

  // Reset drawing mode
  fabricCanvas.isDrawingMode = false;
  fabricCanvas.selection = true;
  fabricCanvas.defaultCursor = 'default';
  fabricCanvas.forEachObject(o => { o.selectable = true; o.evented = true; });

  const wrapper = document.getElementById('fabric-canvas-wrapper');

  switch (toolName) {
    case 'select':
      // Default: pass-through so clicks reach text layer / PDF canvas.
      // Dynamically enabled when cursor hovers over an annotation (see _setupSelectHover).
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
      // Keep text annotations interactive (for re-editing/moving) while
      // disabling other objects so they don't interfere with text placement
      fabricCanvas.forEachObject(o => {
        if (o.mudbrickType === 'text') {
          o.selectable = true;
          o.evented = true;
        } else {
          o.selectable = false;
          o.evented = false;
        }
      });
      break;

    case 'shape':
      wrapper.style.pointerEvents = 'auto';
      fabricCanvas.selection = false;
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.forEachObject(o => {
        // Allow existing shapes to be selected/resized
        if (o.mudbrickType === 'shape') {
          o.selectable = true;
          o.evented = true;
        } else {
          o.selectable = false;
          o.evented = false;
        }
      });
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
      if (!window._redactWarningShown) {
        document.dispatchEvent(new CustomEvent('redact-warning'));
        window._redactWarningShown = true;
      }
      break;

    case 'sticky-note':
      wrapper.style.pointerEvents = 'auto';
      fabricCanvas.selection = false;
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.forEachObject(o => { o.selectable = false; o.evented = false; });
      break;

    case 'link':
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
    e.path.set({ selectable: false, evented: false });
    e.path.mudbrickType = 'underline';
  }
}

function markStrikethroughPath(e) {
  if (e.path) {
    e.path.set({ selectable: false, evented: false });
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
    case 'text': {
      // Don't add text if clicking on existing object
      if (opt.target) return;
      // Don't add text if another text is currently being edited
      // (this click is exiting that edit, not requesting a new text)
      const activeObj = fabricCanvas.getActiveObject();
      if (activeObj && activeObj.isEditing) return;
      addText(pointer.x, pointer.y);
      break;
    }

    case 'shape':
      if (!shapeStartPoint && !opt.target) {
        // Start shape drawing only on empty canvas area
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

    case 'link':
      if (!shapeStartPoint) {
        shapeStartPoint = { x: pointer.x, y: pointer.y };
        startLinkPreview(pointer);
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
    commentThread: createThread(),
    selectable: true,
    evented: true,
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
    shapePreview = createArrow(shapeStartPoint, pointer);
  } else if (shapeType === 'triangle') {
    shapePreview = new fabric.Polygon(
      [{ x: left + width / 2, y: top }, { x: left + width, y: top + height }, { x: left, y: top + height }],
      {
        fill: 'transparent',
        stroke: toolOptions.color,
        strokeWidth: toolOptions.strokeWidth * currentZoom,
        selectable: false,
        evented: false,
      }
    );
  } else if (shapeType === 'diamond') {
    shapePreview = new fabric.Polygon(
      [{ x: left + width / 2, y: top }, { x: left + width, y: top + height / 2 }, { x: left + width / 2, y: top + height }, { x: left, y: top + height / 2 }],
      {
        fill: 'transparent',
        stroke: toolOptions.color,
        strokeWidth: toolOptions.strokeWidth * currentZoom,
        selectable: false,
        evented: false,
      }
    );
  } else if (shapeType === 'star') {
    const cx = left + width / 2, cy = top + height / 2;
    const outerR = Math.min(width, height) / 2;
    const innerR = outerR * 0.4;
    const pts = [];
    for (let i = 0; i < 5; i++) {
      const outerA = (Math.PI / 2 * 3) + (i * 2 * Math.PI / 5);
      pts.push({ x: cx + Math.cos(outerA) * outerR, y: cy + Math.sin(outerA) * outerR });
      const innerA = outerA + Math.PI / 5;
      pts.push({ x: cx + Math.cos(innerA) * innerR, y: cy + Math.sin(innerA) * innerR });
    }
    shapePreview = new fabric.Polygon(pts, {
      fill: 'transparent',
      stroke: toolOptions.color,
      strokeWidth: toolOptions.strokeWidth * currentZoom,
      selectable: false,
      evented: false,
    });
  } else if (shapeType === 'checkmark') {
    shapePreview = new fabric.Polyline(
      [{ x: left, y: top + height * 0.6 }, { x: left + width * 0.35, y: top + height }, { x: left + width, y: top }],
      {
        fill: 'transparent',
        stroke: toolOptions.color,
        strokeWidth: (toolOptions.strokeWidth + 1) * currentZoom,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        selectable: false,
        evented: false,
      }
    );
  } else if (shapeType === 'xmark') {
    const line1 = new fabric.Line([left, top, left + width, top + height], {
      stroke: toolOptions.color,
      strokeWidth: (toolOptions.strokeWidth + 1) * currentZoom,
      strokeLineCap: 'round',
    });
    const line2 = new fabric.Line([left + width, top, left, top + height], {
      stroke: toolOptions.color,
      strokeWidth: (toolOptions.strokeWidth + 1) * currentZoom,
      strokeLineCap: 'round',
    });
    shapePreview = new fabric.Group([line1, line2], {
      selectable: false,
      evented: false,
    });
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

/* ═══════════════════ Link Tool ═══════════════════ */

function startLinkPreview(pointer) {
  fabricCanvas.on('mouse:move', onLinkMove);
  fabricCanvas.on('mouse:up', onLinkUp);
}

function onLinkMove(opt) {
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
    fill: 'rgba(0, 100, 255, 0.08)',
    stroke: '#0066cc',
    strokeWidth: 1,
    strokeDashArray: [4, 3],
    selectable: false,
    evented: false,
    mudbrickType: 'link',
    linkType: 'url',
    linkURL: '',
    linkPage: 1,
  });

  fabricCanvas.add(shapePreview);
  fabricCanvas.renderAll();
}

function onLinkUp() {
  fabricCanvas.off('mouse:move', onLinkMove);
  fabricCanvas.off('mouse:up', onLinkUp);

  if (shapePreview) {
    shapePreview.set({ selectable: true, evented: true });
    fabricCanvas.setActiveObject(shapePreview);
    fabricCanvas.renderAll();
    // Dispatch event to open link editor in app.js
    document.dispatchEvent(new CustomEvent('link-created', { detail: { obj: shapePreview } }));
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

  // Clamp to canvas boundaries
  const clampedLeft = Math.max(0, Math.min(x - size / 2, fabricCanvas.width - size));
  const clampedTop = Math.max(0, Math.min(y - size / 2, fabricCanvas.height - size));
  const group = new fabric.Group([rect, icon], {
    left: clampedLeft,
    top: clampedTop,
    mudbrickType: 'sticky-note',
    noteText: '',
    noteColor: color,
    commentThread: createThread(),
  });

  fabricCanvas.add(group);
  fabricCanvas.setActiveObject(group);
  fabricCanvas.renderAll();

  // Make the note immediately selectable
  group.set({ selectable: true, evented: true });

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

// Callback for tool switch requests (e.g., auto-switch to select after text editing)
let onRequestToolSwitch = null;
export function setOnRequestToolSwitch(fn) {
  onRequestToolSwitch = fn;
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

  // Ensure text dimensions are computed before sizing the rect
  text.set({ left: 0, top: 0 });
  text.initDimensions();

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
    commentThread: createThread(),
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
  const json = fabricCanvas.toJSON(CUSTOM_PROPS);
  // Store canvas dimensions alongside so export can properly scale coordinates
  json._canvasWidth = fabricCanvas.width;
  json._canvasHeight = fabricCanvas.height;
  pageAnnotations[pageNum] = json;
}

/**
 * Directly inject a Fabric object JSON into a page's annotation store
 * without needing to navigate to that page first.
 * Used by multi-page operations like redaction.
 */
export function addAnnotationToPage(pageNum, objJSON) {
  if (!pageAnnotations[pageNum]) {
    pageAnnotations[pageNum] = { version: '5.3.0', objects: [] };
  }
  pageAnnotations[pageNum].objects.push(objJSON);
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
      fabricCanvas.renderAll();
      // Always push undo baseline so user can revert to the loaded state
      if (!canUndo(pageNum)) pushState(pageNum, json);
      // Release suppression only after load is fully complete
      suppressAutoSave = false;
    });
  } else {
    // Push empty state as baseline
    if (!canUndo(pageNum)) pushState(pageNum, fabricCanvas.toJSON(CUSTOM_PROPS));
    suppressAutoSave = false;
  }
}

// Auto-save debounce: 500ms after the last modification on a page
let _autoSaveTimer = null;
const AUTO_SAVE_DELAY_MS = 500;

// Track which pages have pending unsaved changes
const _dirtyPages = new Set();

function autoSave() {
  if (suppressAutoSave) return;
  if (currentPage <= 0) return;

  // Mark this page as dirty immediately
  _dirtyPages.add(currentPage);

  // Debounce: cancel any pending save and schedule a new one
  if (_autoSaveTimer !== null) clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => {
    _autoSaveTimer = null;
    _flushDirtyPages();
  }, AUTO_SAVE_DELAY_MS);
}

/** Serialize all dirty pages and push to undo history */
function _flushDirtyPages() {
  if (!fabricCanvas) return;
  for (const pageNum of _dirtyPages) {
    // Only serialize the currently active page from the live canvas;
    // other dirty pages were already captured in pageAnnotations when we
    // navigated away (savePageAnnotations is called on page leave).
    if (pageNum === currentPage) {
      const json = fabricCanvas.toJSON(CUSTOM_PROPS);
      json._canvasWidth = fabricCanvas.width;
      json._canvasHeight = fabricCanvas.height;
      pageAnnotations[pageNum] = json;
      pushState(pageNum, json);
    }
    // For non-current pages the annotation was already stored — just push history
    else if (pageAnnotations[pageNum]) {
      pushState(pageNum, pageAnnotations[pageNum]);
    }
  }
  _dirtyPages.clear();
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

/**
 * Clear all stored annotations across all pages and reset the canvas.
 * Called after baking annotations into the PDF (save in-place).
 */
export function clearAllAnnotations() {
  for (const key of Object.keys(pageAnnotations)) {
    delete pageAnnotations[key];
  }
  if (fabricCanvas) {
    fabricCanvas.clear();
    fabricCanvas.renderAll();
  }
  clearHistory();
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
    } else if (currentTool === 'underline' || currentTool === 'strikethrough') {
      if (opts.color) {
        fabricCanvas.freeDrawingBrush.color = opts.color;
      }
    }
  }

  // Apply font property changes to the active text annotation (if any)
  if (fabricCanvas && (opts.fontSize || opts.fontFamily || opts.color)) {
    const active = fabricCanvas.getActiveObject();
    if (active && active.mudbrickType === 'text' && active.type === 'i-text') {
      if (opts.fontSize) active.set('fontSize', opts.fontSize * currentZoom);
      if (opts.fontFamily) active.set('fontFamily', opts.fontFamily);
      if (opts.color) active.set('fill', opts.color);
      fabricCanvas.renderAll();
      autoSave();
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
      const maxW = Math.max(fabricCanvas.width * 0.5, 100);
      const maxH = Math.max(fabricCanvas.height * 0.5, 100);
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
  _clipboard = null; // Clear immediately to signal pending copy
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
