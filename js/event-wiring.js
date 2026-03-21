/**
 * Mudbrick — Event Wiring
 * Extracted from app.js: wireEvents, handleKeyboard, selectTool.
 *
 * This module wires ALL UI events (clicks, keyboard, drag-drop, etc.)
 * to their respective handlers. Feature handlers that remain in app.js
 * are accessed through the _appCallbacks object set via setEventCallbacks().
 */

import State from './state.js';
import { DOM, $ } from './dom-refs.js';
import {
  renderCurrentPage, setZoom, zoomIn, zoomOut,
  fitWidth, fitPage, setZoomThrottled, setPendingScrollRestore,
} from './renderer.js';
import { goToPage, prevPage, nextPage, firstPage, lastPage } from './navigation.js';
import { closeDropdown, hideContextMenu, showContextMenu, showAnnotationContextMenu } from './menus.js';

// Annotation imports
import {
  setTool, savePageAnnotations, deleteSelected,
  updateToolOptions, getCanvas, getAnnotations,
  copySelected, pasteClipboard, duplicateSelected,
  updateSelectedNoteText,
} from './annotations.js';

// Feature module imports used directly in wireEvents
import { getNextZoom } from './pdf-engine.js';
import {
  toast, showLoading, hideLoading, debounce, downloadBlob, parsePageRanges,
} from './utils.js';
import { rotatePage, deletePage, reorderPages, insertBlankPage } from './pdf-edit.js';
import { openSignatureModal, closeSignatureModal } from './signatures.js';
import {
  runOCR, hasOCRResults, getOCRTextEntries, enableCorrectionMode,
  disableCorrectionMode, exportOCRText, getOCRStats,
} from './ocr.js';
import {
  detectFormFields, detectFormFieldsPdfJs,
} from './forms.js';
import {
  augmentTextIndex, isFindOpen,
} from './find.js';
import { followLink, normalizeURL } from './links.js';
import {
  getAuthorName, setAuthorName, addReply, setThreadStatus,
  exportThreadsXFDF,
} from './comments.js';
import {
  isTextEditActive,
  enterImageEditMode, exitImageEditMode, isImageEditActive,
  extractImagePositions,
} from './text-edit.js';
import { setLabelRange, clearLabels } from './page-labels.js';
import { announceToScreenReader, cycleRegion } from './a11y.js';
import { showTip } from './onboarding.js';

/* ── Callback bridge to app.js feature handlers ── */

let _appCallbacks = {};

/**
 * Register callbacks for functions that remain in app.js.
 * Must be called before wireEvents().
 */
export function setEventCallbacks(cbs) {
  _appCallbacks = cbs;
}

/* ═══════════════════ wireEvents ═══════════════════ */

export function wireEvents() {
  // File open
  const openBtn = $('open-file-btn') || $('btn-open');
  if (openBtn) openBtn.addEventListener('click', () => DOM.fileInput.click());
  DOM.fileInput.addEventListener('change', e => {
    if (e.target.files.length) _appCallbacks.handleFiles?.(Array.from(e.target.files));
    e.target.value = ''; // reset so same file can be reopened
  });

  // Draggable floating toolbar
  {
    const ftbar = $('floating-toolbar');
    let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

    ftbar.addEventListener('mousedown', e => {
      // Don't drag if clicking a tool button
      if (e.target.closest('.float-btn')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = ftbar.getBoundingClientRect();
      const parentRect = ftbar.offsetParent.getBoundingClientRect();
      origLeft = rect.left - parentRect.left;
      origTop = rect.top - parentRect.top;
      ftbar.classList.add('is-dragging');
      // Remove centering transform on first drag
      ftbar.style.transform = 'none';
      ftbar.style.left = origLeft + 'px';
      ftbar.style.top = origTop + 'px';
      ftbar.style.bottom = 'auto';
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      ftbar.style.left = (origLeft + dx) + 'px';
      ftbar.style.top = (origTop + dy) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      ftbar.classList.remove('is-dragging');
    });
  }

  // Hand-tool panning + middle-click panning (click-and-drag to scroll canvas-area)
  {
    let panning = false, panStartX = 0, panStartY = 0, scrollStartX = 0, scrollStartY = 0;

    DOM.canvasArea.addEventListener('mousedown', e => {
      const isHand = State.activeTool === 'hand' && e.button === 0;
      const isMiddle = e.button === 1; // middle-click pans regardless of tool
      if (!isHand && !isMiddle) return;
      // Don't interfere with sidebar or toolbar clicks
      if (e.target.closest('#sidebar') || e.target.closest('#floating-toolbar')) return;
      panning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      scrollStartX = DOM.canvasArea.scrollLeft;
      scrollStartY = DOM.canvasArea.scrollTop;
      DOM.canvasArea.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!panning) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      DOM.canvasArea.scrollLeft = scrollStartX - dx;
      DOM.canvasArea.scrollTop = scrollStartY - dy;
    });

    document.addEventListener('mouseup', () => {
      if (!panning) return;
      panning = false;
      DOM.canvasArea.style.cursor = '';
    });
  }

  // Undo / Redo
  DOM.btnUndo.addEventListener('click', () => _appCallbacks.handleUndo?.());
  DOM.btnRedo.addEventListener('click', () => _appCallbacks.handleRedo?.());

  // Edit Text
  DOM.btnEditText.addEventListener('click', () => _appCallbacks.handleEditText?.());

  // Double-click on text layer — detect if click hit an image or text
  DOM.textLayer.addEventListener('dblclick', async (e) => {
    if (!State.pdfDoc || isTextEditActive()) return;
    if (isImageEditActive()) return;

    // If the click landed directly on a text span, prioritize text editing
    const clickedEl = e.target;
    if (clickedEl && clickedEl.tagName === 'SPAN' && clickedEl.closest('#text-layer') &&
        clickedEl.textContent.trim().length > 0) {
      _appCallbacks.handleEditText?.();
      return;
    }

    // Check if the click landed on an image region
    const rect = DOM.pageContainer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    try {
      const page = await State.pdfDoc.getPage(State.currentPage);
      const images = await extractImagePositions(page, State._viewport);
      const hitImage = images.find(img =>
        clickX >= img.left && clickX <= img.left + img.width &&
        clickY >= img.top && clickY <= img.top + img.height
      );

      if (hitImage) {
        // Enter image edit mode — this creates overlay divs with dblclick handlers
        const ok = await enterImageEditMode(State.currentPage, State.pdfDoc, State._viewport, DOM.textLayer);
        if (!ok) return;
        DOM.btnEditImage.classList.add('active');

        // Find the overlay that matches the hit image and trigger its dblclick
        const overlays = DOM.textLayer.querySelectorAll('.image-edit-overlay');
        for (const ov of overlays) {
          const ovLeft = parseFloat(ov.style.left);
          const ovTop = parseFloat(ov.style.top);
          if (Math.abs(ovLeft - hitImage.left) < 5 && Math.abs(ovTop - hitImage.top) < 5) {
            ov.dispatchEvent(new MouseEvent('dblclick', { bubbles: false }));
            break;
          }
        }
        return;
      }
    } catch (err) {
      console.warn('Image detection on dblclick failed:', err);
    }

    // No image hit — enter text edit mode
    _appCallbacks.handleEditText?.();
  });

  // Edit Image
  if (DOM.btnEditImage) DOM.btnEditImage.addEventListener('click', () => _appCallbacks.handleEditImage?.());

  // Text edit toolbar (event delegation on page container)
  DOM.pageContainer.addEventListener('click', e => {
    if (e.target.classList.contains('text-edit-commit')) {
      _appCallbacks.handleCommitTextEdits?.();
    } else if (e.target.classList.contains('text-edit-cancel')) {
      _appCallbacks.handleCancelTextEdits?.();
    }
  });

  // Image edit toolbar (custom events dispatched from toolbar buttons)
  document.addEventListener('image-undo-changed', () => _appCallbacks.updateUndoRedoButtons?.());
  document.addEventListener('image-edit-commit', () => _appCallbacks.handleCommitImageEdits?.());
  document.addEventListener('image-edit-cancel', () => _appCallbacks.handleCancelImageEdits?.());

  // Page navigation
  if (DOM.btnFirst) DOM.btnFirst.addEventListener('click', firstPage);
  DOM.btnPrev.addEventListener('click', prevPage);
  DOM.btnNext.addEventListener('click', nextPage);
  if (DOM.btnLast) DOM.btnLast.addEventListener('click', lastPage);
  DOM.pageInput.addEventListener('change', () => {
    const val = parseInt(DOM.pageInput.value);
    if (!isNaN(val)) goToPage(val);
  });
  DOM.pageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = parseInt(DOM.pageInput.value);
      if (!isNaN(val)) goToPage(val);
      DOM.pageInput.blur();
    }
  });

  // Zoom (ribbon)
  $('btn-zoom-in').addEventListener('click', zoomIn);
  $('btn-zoom-out').addEventListener('click', zoomOut);
  $('btn-zoom-level').addEventListener('click', () => setZoom(1.0));
  $('btn-fit-width').addEventListener('click', fitWidth);
  $('btn-fit-page').addEventListener('click', fitPage);

  // Zoom (status bar)
  DOM.statusZoomIn.addEventListener('click', zoomIn);
  DOM.statusZoomOut.addEventListener('click', zoomOut);
  DOM.statusZoom.addEventListener('click', () => setZoom(1.0));

  // Ctrl+scroll zoom on canvas area — cursor-anchored, throttled to 60fps
  DOM.canvasArea.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const oldZoom = State.zoom;
      const next = getNextZoom(oldZoom, e.deltaY < 0 ? 1 : -1);
      if (next === oldZoom) return;

      // Cursor position relative to canvas-area viewport
      const rect = DOM.canvasArea.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      // Content-space point under cursor (zoom-independent)
      const pageX = (DOM.canvasArea.scrollLeft + clientX) / oldZoom;
      const pageY = (DOM.canvasArea.scrollTop + clientY) / oldZoom;

      setPendingScrollRestore({ type: 'point', pageX, pageY, clientX, clientY });
      setZoomThrottled(next);
    }
  }, { passive: false });

  // Merge modal
  $('btn-merge').addEventListener('click', () => _appCallbacks.openMergeModal?.());
  $('merge-drop-zone').addEventListener('click', () => $('merge-file-input').click());
  $('merge-file-input').addEventListener('change', e => {
    if (e.target.files.length) _appCallbacks.addMergeFiles?.(Array.from(e.target.files));
    e.target.value = '';
  });
  $('merge-drop-zone').addEventListener('dragover', e => e.preventDefault());
  $('merge-drop-zone').addEventListener('drop', e => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (files.length) _appCallbacks.addMergeFiles?.(files);
  });
  $('btn-merge-execute').addEventListener('click', () => _appCallbacks.executeMerge?.());

  // Split modal
  $('btn-split').addEventListener('click', () => _appCallbacks.openSplitModal?.());
  $('split-range-input').addEventListener('input', () => _appCallbacks.updateSplitPreview?.());
  $('btn-split-execute').addEventListener('click', () => _appCallbacks.executeSplit?.());

  // Close modals — delegates to dedicated close functions for complex modals,
  // uses generic closeModal() for simple backdrop-only ones so focus is restored.
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.dataset.closeModal;
      if (modal === 'merge') _appCallbacks.closeMergeModal?.();
      if (modal === 'split') _appCallbacks.closeSplitModal?.();
      if (modal === 'watermark') _appCallbacks.closeWatermarkModal?.();
      if (modal === 'bates') _appCallbacks.closeBatesModal?.();
      if (modal === 'hf') _appCallbacks.closeHfModal?.();
      if (modal === 'crop') _appCallbacks.closeCropModal?.();
      if (modal === 'signature') closeSignatureModal();
      if (modal === 'ocr') _appCallbacks.closeModal?.('ocr-modal-backdrop');
      if (modal === 'encrypt') _appCallbacks.closeModal?.('encrypt-modal-backdrop');
      if (modal === 'metadata') _appCallbacks.closeModal?.('metadata-modal-backdrop');
      if (modal === 'redact-search') _appCallbacks.closeModal?.('redact-search-modal-backdrop');
      if (modal === 'export-image') _appCallbacks.closeModal?.('export-image-modal-backdrop');
      if (modal === 'create-from-images') _appCallbacks.closeModal?.('create-from-images-modal-backdrop');
      if (modal === 'optimize') _appCallbacks.closeModal?.('optimize-modal-backdrop');
      if (modal === 'compare') _appCallbacks.closeModal?.('compare-modal-backdrop');
      if (modal === 'comment-summary') _appCallbacks.closeModal?.('comment-summary-modal-backdrop');
      if (modal === 'form-data') _appCallbacks.closeModal?.('form-data-modal-backdrop');
      if (modal === 'exhibit') _appCallbacks.closeModal?.('exhibit-modal-backdrop');
      if (modal === 'sanitize') _appCallbacks.closeModal?.('sanitize-modal-backdrop');
      if (modal === 'shortcuts') _appCallbacks.closeModal?.('shortcuts-modal-backdrop');
      if (modal === 'about') _appCallbacks.closeModal?.('about-modal-backdrop');
      if (modal === 'normalize') _appCallbacks.closeModal?.('normalize-modal-backdrop');
      if (modal === 'page-labels') {
        _appCallbacks.closeModal?.('page-labels-modal-backdrop');
        // Restore previously saved ranges on cancel
        clearLabels();
        const savedRanges = _appCallbacks.getSavedLabelRanges?.() || [];
        savedRanges.forEach(r => setLabelRange(r.startPage, r.endPage, r.format, r.prefix, r.startNum));
      }
      if (modal === 'replace-pages') _appCallbacks.closeModal?.('replace-pages-modal-backdrop');
      if (modal === 'print') _appCallbacks.closePrintModal?.();
      if (modal === 'export') _appCallbacks.closeExportModal?.();
    });
  });

  // Close modal on backdrop click (click on the overlay, not the dialog content)
  document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop') && !e.target.classList.contains('hidden')) {
      const closeBtn = e.target.querySelector('[data-close-modal]');
      if (closeBtn) closeBtn.click();
    }
  });

  // Annotation tool buttons (sync active state across all ribbon panels + flyout items)
  document.querySelectorAll('.tool-btn[data-tool], .mb-flyout-item[data-tool], .mb-rail-item[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      selectTool(btn.dataset.tool);
    });
  });

  // Floating toolbar tool buttons
  document.querySelectorAll('.float-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tool === 'image') {
        _appCallbacks.handleImageInsert?.();
      } else {
        selectTool(btn.dataset.tool);
      }
    });
  });

  // Sidebar tab switching — removed (sidebar replaced by flyout panels)
  // Sidebar toggle — removed (sidebar replaced by flyout panels)

  // Properties panel close
  $('btn-close-panel').addEventListener('click', () => _appCallbacks.togglePropertiesPanel?.(false));

  // --- Helper: apply a color/stroke change to the active selected object ---
  function applyToSelected(props) {
    const canvas = getCanvas();
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    if (props.color) {
      obj.set('stroke', props.color);
      if (obj.fill && obj.fill !== 'transparent') obj.set('fill', props.color);
      // For text objects update fill instead of stroke
      if (obj.mudbrickType === 'text') obj.set('fill', props.color);
      // For groups (arrow, xmark), update children
      if (obj._objects) {
        obj._objects.forEach(child => {
          if (child.stroke) child.set('stroke', props.color);
          if (child.fill && child.fill !== 'transparent') child.set('fill', props.color);
        });
      }
    }
    if (props.strokeWidth != null) {
      obj.set('strokeWidth', props.strokeWidth);
      if (obj._objects) {
        obj._objects.forEach(child => {
          if (child.stroke) child.set('strokeWidth', props.strokeWidth);
        });
      }
    }
    if (props.opacity != null) obj.set('opacity', props.opacity);
    if (props.fontSize != null) obj.set('fontSize', props.fontSize);
    if (props.fontFamily != null) obj.set('fontFamily', props.fontFamily);
    canvas.renderAll();
  }

  // --- Helper: sync panel UI from selected object ---
  function syncPanelFromObject(obj) {
    if (!obj) return;
    const color = obj.stroke || obj.fill || '#000000';
    // Update color swatches
    document.querySelectorAll('#panel-tool-props .color-swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color === color);
    });
    const cp = $('prop-color-picker');
    if (cp) cp.value = color;
    // Update opacity
    const os = $('prop-opacity');
    const ov = $('prop-opacity-value');
    if (os && obj.opacity != null) {
      os.value = Math.round(obj.opacity * 100);
      if (ov) ov.textContent = os.value + '%';
    }
    // Update stroke width
    const ss = $('prop-stroke-width');
    const sv = $('prop-stroke-width-value');
    if (ss && obj.strokeWidth != null) {
      ss.value = Math.round(obj.strokeWidth);
      if (sv) sv.textContent = ss.value + 'px';
    }
    // Update font size
    const fs = $('prop-font-size');
    if (fs && obj.fontSize != null) fs.value = obj.fontSize;
    // Update font family
    const ff = $('prop-font-family');
    if (ff && obj.fontFamily) ff.value = obj.fontFamily;
  }

  // Properties panel — color swatches
  document.querySelectorAll('#panel-tool-props .color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('#panel-tool-props .color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      updateToolOptions({ color: swatch.dataset.color });
      applyToSelected({ color: swatch.dataset.color });
    });
  });

  // Properties panel — color picker input
  const colorPicker = $('prop-color-picker');
  if (colorPicker) {
    colorPicker.addEventListener('input', () => {
      document.querySelectorAll('#panel-tool-props .color-swatch').forEach(s => s.classList.remove('active'));
      updateToolOptions({ color: colorPicker.value });
      applyToSelected({ color: colorPicker.value });
    });
  }

  // Properties panel — eyedropper
  const eyedropperBtn = $('prop-eyedropper');
  if (eyedropperBtn) {
    eyedropperBtn.addEventListener('click', () => {
      if (typeof window.EyeDropper === 'function') {
        const dropper = new window.EyeDropper();
        dropper.open().then(result => {
          const color = result.sRGBHex;
          document.querySelectorAll('#panel-tool-props .color-swatch').forEach(s => s.classList.remove('active'));
          if (colorPicker) colorPicker.value = color;
          updateToolOptions({ color });
          applyToSelected({ color });
        }).catch(() => {});
      } else {
        toast('EyeDropper not supported in this browser', 'info');
      }
    });
  }

  // Properties panel — opacity slider
  const opacitySlider = $('prop-opacity');
  const opacityValue = $('prop-opacity-value');
  if (opacitySlider && opacityValue) {
    opacitySlider.addEventListener('input', () => {
      opacityValue.textContent = opacitySlider.value + '%';
      const val = parseInt(opacitySlider.value) / 100;
      updateToolOptions({ opacity: val });
      applyToSelected({ opacity: val });
    });
  }

  // Properties panel — font size input
  const fontSizeInput = $('prop-font-size');
  if (fontSizeInput) {
    fontSizeInput.addEventListener('change', () => {
      const size = parseInt(fontSizeInput.value) || 16;
      updateToolOptions({ fontSize: size });
      applyToSelected({ fontSize: size });
    });
  }

  // Properties panel — font family dropdown
  const fontFamilySelect = $('prop-font-family');
  if (fontFamilySelect) {
    fontFamilySelect.addEventListener('change', () => {
      updateToolOptions({ fontFamily: fontFamilySelect.value });
      applyToSelected({ fontFamily: fontFamilySelect.value });
    });
  }

  // Properties panel — shape picker
  document.querySelectorAll('#shape-picker .shape-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#shape-picker .shape-pick').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateToolOptions({ shapeType: btn.dataset.shape });
    });
  });

  // Properties panel — stroke width slider
  const strokeSlider = $('prop-stroke-width');
  const strokeValue = $('prop-stroke-width-value');
  if (strokeSlider && strokeValue) {
    strokeSlider.addEventListener('input', () => {
      strokeValue.textContent = strokeSlider.value + 'px';
      const val = parseInt(strokeSlider.value);
      updateToolOptions({ strokeWidth: val });
      applyToSelected({ strokeWidth: val });
    });
  }

  // Dark mode
  $('btn-dark-mode').addEventListener('click', () => _appCallbacks.toggleDarkMode?.());

  // Ribbon tab switching — removed (ribbon replaced by icon rail + flyout panels)

  // Signature modal
  $('btn-signature').addEventListener('click', openSignatureModal);
  // Also wire sig-open-btn class (Annotate ribbon + floating toolbar duplicates)
  document.querySelectorAll('.sig-open-btn').forEach(btn => {
    btn.addEventListener('click', openSignatureModal);
  });

  // Watermark modal
  $('btn-watermark').addEventListener('click', () => _appCallbacks.openWatermarkModal?.());
  $('btn-watermark-execute').addEventListener('click', () => _appCallbacks.executeWatermark?.());
  $('watermark-opacity').addEventListener('input', () => {
    $('watermark-opacity-value').textContent = Math.round(parseFloat($('watermark-opacity').value) * 100) + '%';
  });

  // Watermark tab switching (text / image)
  $('watermark-tab-text')?.addEventListener('click', () => {
    $('watermark-tab-text').classList.add('active');
    $('watermark-tab-image').classList.remove('active');
    $('watermark-text-fields').classList.remove('hidden');
    $('watermark-image-fields').classList.add('hidden');
  });
  $('watermark-tab-image')?.addEventListener('click', () => {
    $('watermark-tab-image').classList.add('active');
    $('watermark-tab-text').classList.remove('active');
    $('watermark-image-fields').classList.remove('hidden');
    $('watermark-text-fields').classList.add('hidden');
  });
  // Image watermark controls
  $('watermark-image-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const thumb = $('watermark-image-thumb');
      thumb.src = URL.createObjectURL(file);
      $('watermark-image-preview').classList.remove('hidden');
    }
  });
  $('watermark-image-scale')?.addEventListener('input', (e) => {
    $('watermark-image-scale-value').textContent = Math.round(parseFloat(e.target.value) * 100) + '%';
  });
  $('watermark-image-opacity')?.addEventListener('input', (e) => {
    $('watermark-image-opacity-value').textContent = Math.round(parseFloat(e.target.value) * 100) + '%';
  });

  // Link tool events
  document.addEventListener('link-created', (e) => {
    const obj = e.detail.obj;
    _appCallbacks.showLinkPropsPanel?.(obj);
    _appCallbacks.togglePropertiesPanel?.(true);
  });
  document.addEventListener('link-follow', (e) => {
    const obj = e.detail.obj;
    followLink(obj, goToPage);
  });
  $('link-type-select')?.addEventListener('change', (e) => {
    _appCallbacks.toggleLinkTypeFields?.(e.target.value);
  });
  $('btn-link-save')?.addEventListener('click', () => {
    const linkObj = _appCallbacks.getSelectedLinkObj?.();
    if (!linkObj) return;
    linkObj.linkType = $('link-type-select').value;
    linkObj.linkURL = normalizeURL($('link-url-input').value);
    linkObj.linkPage = parseInt($('link-page-input').value) || 1;
    toast('Link saved', 'success');
  });
  $('btn-link-follow')?.addEventListener('click', () => {
    const linkObj = _appCallbacks.getSelectedLinkObj?.();
    if (linkObj) followLink(linkObj, goToPage);
  });
  $('btn-link-remove')?.addEventListener('click', () => {
    const linkObj = _appCallbacks.getSelectedLinkObj?.();
    if (!linkObj) return;
    const canvas = getCanvas();
    if (canvas) {
      canvas.remove(linkObj);
      canvas.renderAll();
    }
    _appCallbacks.hideLinkPropsPanel?.();
    toast('Link removed', 'info');
  });

  // Comment thread events
  $('btn-comment-reply')?.addEventListener('click', () => {
    const commentObj = _appCallbacks.getSelectedCommentObj?.();
    if (!commentObj?.commentThread) return;
    const input = $('comment-reply-input');
    const text = input.value.trim();
    if (!text) return;
    addReply(commentObj.commentThread, text);
    input.value = '';
    _appCallbacks.renderCommentReplies?.(commentObj.commentThread);
    savePageAnnotations(State.currentPage);
    _appCallbacks.refreshCommentsSidebar?.();
  });
  $('comment-reply-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-comment-reply')?.click();
  });
  $('comment-status')?.addEventListener('change', (e) => {
    const commentObj = _appCallbacks.getSelectedCommentObj?.();
    if (!commentObj?.commentThread) return;
    setThreadStatus(commentObj.commentThread, e.target.value);
    savePageAnnotations(State.currentPage);
    _appCallbacks.refreshCommentsSidebar?.();
  });
  $('comment-filter-status')?.addEventListener('change', () => _appCallbacks.refreshCommentsSidebar?.());
  $('btn-export-comments-xfdf')?.addEventListener('click', () => {
    const xml = exportThreadsXFDF(getAnnotations());
    const blob = new Blob([xml], { type: 'application/xml' });
    downloadBlob(blob, (State.fileName || 'document').replace(/\.pdf$/i, '') + '-comments.xfdf');
    toast('Comments exported as XFDF', 'success');
  });
  // Author name
  const authorInput = $('author-name-input');
  if (authorInput) {
    authorInput.value = getAuthorName();
    authorInput.addEventListener('change', () => setAuthorName(authorInput.value));
  }

  // Normalize Page Sizes modal
  $('btn-normalize-execute').addEventListener('click', () => _appCallbacks.executeNormalize?.());

  // Bates Numbering modal
  $('btn-bates').addEventListener('click', () => _appCallbacks.openBatesModal?.());
  $('btn-bates-execute').addEventListener('click', () => _appCallbacks.executeBates?.());
  // Live preview update on any Bates input change
  ['bates-prefix', 'bates-suffix', 'bates-start', 'bates-pad'].forEach(id => {
    $(id).addEventListener('input', () => _appCallbacks.updateBatesPreview?.());
  });
  // Toggle custom range visibility
  $('bates-page-range').addEventListener('change', () => {
    const custom = $('bates-custom-range');
    if ($('bates-page-range').value === 'custom') {
      custom.classList.remove('hidden');
    } else {
      custom.classList.add('hidden');
    }
  });

  // Headers & Footers modal
  $('btn-headers-footers').addEventListener('click', () => _appCallbacks.openHfModal?.());
  $('btn-hf-execute').addEventListener('click', () => _appCallbacks.executeHeadersFooters?.());
  // Track last-focused zone input for token insertion
  document.querySelectorAll('.hf-zone').forEach(input => {
    input.addEventListener('focus', () => { _appCallbacks.setLastFocusedHfZone?.(input); });
    input.addEventListener('input', () => _appCallbacks.updateHfPreview?.());
  });
  // Token buttons
  document.querySelectorAll('.hf-token-btn').forEach(btn => {
    btn.addEventListener('click', () => _appCallbacks.insertHfToken?.(btn.dataset.token));
  });
  // Toggle custom range
  $('hf-page-range').addEventListener('change', () => {
    const custom = $('hf-custom-range');
    if ($('hf-page-range').value === 'custom') {
      custom.classList.remove('hidden');
    } else {
      custom.classList.add('hidden');
    }
  });

  // Visual Crop
  $('btn-crop-page').addEventListener('click', () => _appCallbacks.openCropModal?.());
  $('btn-crop-execute').addEventListener('click', () => _appCallbacks.executeCrop?.());
  $('btn-crop-cancel').addEventListener('click', () => _appCallbacks.closeCropModal?.());
  _appCallbacks.initCropDragHandlers?.();
  // Preset buttons set crop from PDF-point values
  document.querySelectorAll('.crop-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const cropState = _appCallbacks.getCropState?.();
      if (!cropState?.active) return;
      _appCallbacks.setCropFromPreset?.(
        parseFloat(btn.dataset.top),
        parseFloat(btn.dataset.bottom),
        parseFloat(btn.dataset.left),
        parseFloat(btn.dataset.right),
      );
    });
  });

  // OCR modal
  $('btn-ocr').addEventListener('click', () => {
    $('ocr-modal-backdrop').classList.remove('hidden');
    $('ocr-progress-area').classList.add('hidden');
    $('btn-ocr-run').disabled = false;
    // Default to current page
    const radios = document.querySelectorAll('input[name="ocr-scope"]');
    radios[0].checked = true;
  });

  $('btn-ocr-run').addEventListener('click', async () => {
    if (!State.pdfDoc) return;

    // Determine page numbers
    const scope = document.querySelector('input[name="ocr-scope"]:checked').value;
    let pageNumbers = [];

    if (scope === 'current') {
      pageNumbers = [State.currentPage];
    } else if (scope === 'all') {
      pageNumbers = Array.from({ length: State.totalPages }, (_, i) => i + 1);
    } else if (scope === 'range') {
      const rangeStr = $('ocr-range-input').value.trim();
      if (!rangeStr) {
        toast('Enter a page range', 'warning');
        return;
      }
      const parsed = parsePageRanges(rangeStr, State.totalPages);
      if (!parsed || !parsed.length) {
        toast('Invalid page range', 'error');
        return;
      }
      // Flatten array-of-arrays and convert from 0-based to 1-based
      pageNumbers = parsed.flat().map(p => p + 1);
    }

    // Show progress
    $('ocr-progress-area').classList.remove('hidden');
    $('btn-ocr-run').disabled = true;

    try {
      const language = $('ocr-language')?.value || 'eng';
      await runOCR(State.pdfDoc, pageNumbers, (info) => {
        $('ocr-progress-label').textContent = info.status;
        $('ocr-progress-pct').textContent = Math.round(info.progress) + '%';
        $('ocr-progress-bar').style.width = info.progress + '%';
      }, { language });

      // Augment find text index with OCR results
      const ocrEntries = getOCRTextEntries();
      if (ocrEntries.length > 0) {
        augmentTextIndex(ocrEntries);
      }

      // Update status bar
      const ocrBadge = $('status-ocr');
      if (ocrBadge) {
        ocrBadge.textContent = `OCR ✓ (${pageNumbers.length} pg${pageNumbers.length !== 1 ? 's' : ''})`;
        ocrBadge.classList.remove('hidden');
      }

      // Show OCR stats in results area
      const stats = getOCRStats();
      if (stats) {
        $('ocr-results-area')?.classList.remove('hidden');
        const statsEl = $('ocr-stats');
        if (statsEl) {
          statsEl.textContent = `${stats.pagesProcessed} pages, ${stats.totalWords} words, ` +
            `${stats.avgConfidence}% avg confidence` +
            (stats.lowConfidenceWords ? `, ${stats.lowConfidenceWords} low-confidence words` : '');
        }
      }

      // Store embed preference
      State.ocrEmbedText = $('ocr-embed-text')?.checked ?? true;

      // Re-render current page to show OCR text layer
      await renderCurrentPage();

      toast(`OCR complete — ${pageNumbers.length} page${pageNumbers.length !== 1 ? 's' : ''} processed`, 'success');
    } catch (err) {
      toast('OCR failed: ' + err.message, 'error');
      console.error('OCR error:', err);
    } finally {
      $('btn-ocr-run').disabled = false;
    }
  });

  // OCR enhancement event listeners
  $('ocr-show-confidence')?.addEventListener('change', (e) => {
    DOM.textLayer?.classList.toggle('ocr-confidence-toggle', e.target.checked);
  });
  $('btn-ocr-export-text')?.addEventListener('click', () => {
    const text = exportOCRText();
    if (!text) { toast('No OCR results to export', 'warning'); return; }
    const blob = new Blob([text], { type: 'text/plain' });
    downloadBlob(blob, (State.fileName || 'document').replace(/\.pdf$/i, '') + '-ocr.txt');
    toast('OCR text exported', 'success');
  });
  $('btn-ocr-correct')?.addEventListener('click', () => {
    enableCorrectionMode(State.currentPage, DOM.textLayer);
    $('ocr-modal-backdrop')?.classList.add('hidden');
    toast('OCR correction mode active. Click on words to edit. Press Escape to exit.', 'info');
  });

  // Edit ribbon — Insert Blank Page
  $('btn-insert-blank').addEventListener('click', async () => {
    if (!State.pdfBytes) return;
    showLoading('Inserting page...');
    try {
      const newBytes = await insertBlankPage(State.pdfBytes, State.currentPage - 1);
      await _appCallbacks.reloadAfterEdit?.(newBytes);
      toast('Blank page inserted', 'success');
    } catch (err) {
      toast('Insert failed: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  });

  // Image insertion
  $('btn-insert-image').addEventListener('click', () => _appCallbacks.handleImageInsert?.());
  $('image-file-input').addEventListener('change', (e) => _appCallbacks.onImageFileSelected?.(e));

  // Annotate ribbon image button
  if ($('btn-anno-image')) $('btn-anno-image').addEventListener('click', () => _appCallbacks.handleImageInsert?.());

  // Sticky note — note text textarea
  const noteTextarea = $('prop-note-text');
  if (noteTextarea) {
    noteTextarea.addEventListener('input', () => {
      updateSelectedNoteText(noteTextarea.value);
      _appCallbacks.refreshNotesSidebar?.();
    });
  }

  // Sticky note — color swatches in props panel
  document.querySelectorAll('#note-color-swatches .color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const canvas = getCanvas();
      if (!canvas) return;
      const obj = canvas.getActiveObject();
      if (!obj || obj.mudbrickType !== 'sticky-note') return;
      const colorName = swatch.dataset.noteColor;
      const colorMap = { yellow:'#fff9c4', green:'#c8e6c9', blue:'#bbdefb', pink:'#f8bbd0', orange:'#ffe0b2' };
      const fill = colorMap[colorName];
      if (!fill) return;
      // Update the rect background in the group
      if (obj._objects) {
        const rect = obj._objects.find(o => o.type === 'rect');
        if (rect) {
          rect.set('fill', fill);
        }
      }
      obj.noteColor = colorName;
      canvas.renderAll();
      savePageAnnotations(State.currentPage);
      // Update swatch active state
      document.querySelectorAll('#note-color-swatches .color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      _appCallbacks.refreshNotesSidebar?.();
    });
  });

  // Fabric canvas selection events — show/hide note props
  // Hook into canvas events after a short delay (canvas is ready after boot)
  setTimeout(() => {
    const canvas = getCanvas();
    if (!canvas) return;

    function _onObjectSelected(e) {
      const obj = e.selected?.[0];
      if (obj && obj.mudbrickType === 'sticky-note') {
        _appCallbacks.showNotePropsPanel?.(obj);
      } else {
        _appCallbacks.hideNotePropsPanel?.();
      }
      if (obj && obj.mudbrickType === 'link') {
        _appCallbacks.showLinkPropsPanel?.(obj);
      } else {
        _appCallbacks.hideLinkPropsPanel?.();
      }
      if (obj && obj.commentThread) {
        _appCallbacks.showCommentThreadPanel?.(obj);
      } else {
        _appCallbacks.hideCommentThreadPanel?.();
      }
      // Sync properties panel to reflect the selected object's properties
      if (obj) syncPanelFromObject(obj);
    }

    canvas.on('selection:created', (...args) => {
      _onObjectSelected(...args);
      if (typeof UIController !== 'undefined') {
        UIController.showProperties();
      }
    });
    canvas.on('selection:updated', (...args) => {
      _onObjectSelected(...args);
      if (typeof UIController !== 'undefined') {
        UIController.showProperties();
      }
    });

    canvas.on('selection:cleared', () => {
      _appCallbacks.hideNotePropsPanel?.();
      _appCallbacks.hideLinkPropsPanel?.();
      _appCallbacks.hideCommentThreadPanel?.();
      // Reset color swatches to default (no active highlight)
      document.querySelectorAll('#panel-tool-props .color-swatch').forEach(s => s.classList.remove('active'));
      if (typeof UIController !== 'undefined') {
        UIController.hideProperties();
      }
    });

    // Also refresh notes sidebar after any annotation modification
    canvas.on('object:modified', () => {
      _appCallbacks.refreshNotesSidebar?.();
      _appCallbacks.updateUnsavedIndicator?.();
    });

    canvas.on('object:added', () => {
      _appCallbacks.updateUnsavedIndicator?.();
    });

    canvas.on('object:removed', () => {
      _appCallbacks.refreshNotesSidebar?.();
      _appCallbacks.hideNotePropsPanel?.();
      _appCallbacks.updateUnsavedIndicator?.();
    });
  }, 500);

  // Export — opens unified export modal
  $('btn-export').addEventListener('click', () => _appCallbacks.handleExport?.());

  // Unified export modal — tab switching
  document.querySelectorAll('.export-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      _appCallbacks._switchExportTab?.(tabBtn.dataset.exportTab);
      _appCallbacks._updateImgSizeHint?.();
    });
  });

  // Unified export modal — image scope changes
  $('export-imgs-scope')?.addEventListener('change', () => {
    const custom = $('export-imgs-scope').value === 'custom';
    $('export-imgs-range-row').classList.toggle('hidden', !custom);
    _appCallbacks._updateImgSizeHint?.();
  });
  $('export-imgs-dpi')?.addEventListener('change', () => _appCallbacks._updateImgSizeHint?.());
  $('export-imgs-format')?.addEventListener('change', () => {
    const isJpeg = $('export-imgs-format').value === 'jpg';
    $('export-imgs-quality-row').classList.toggle('hidden', !isJpeg);
    _appCallbacks._updateImgSizeHint?.();
  });

  // Unified export modal — execute button
  $('btn-export-execute')?.addEventListener('click', () => _appCallbacks.executeExport?.());

  // Print modal — scope toggle
  $('print-scope')?.addEventListener('change', () => {
    const custom = $('print-scope').value === 'custom';
    $('print-range-row').classList.toggle('hidden', !custom);
  });

  // Print modal — execute button
  $('btn-print-execute')?.addEventListener('click', async () => {
    const scope = $('print-scope').value;
    const printScale = parseFloat($('print-quality').value) || 1.5;

    let pageNums;
    if (scope === 'current') {
      pageNums = [State.currentPage];
    } else if (scope === 'all') {
      pageNums = Array.from({ length: State.totalPages }, (_, i) => i + 1);
    } else {
      const rangeInput = $('print-range').value.trim();
      const ranges = parsePageRanges(rangeInput, State.totalPages);
      if (!ranges) { toast('Invalid page range', 'warning'); return; }
      pageNums = ranges.flat().map(i => i + 1);
    }

    _appCallbacks.closePrintModal?.();
    await _appCallbacks.executePrint?.(pageNums, printScale);
  });

  // Annotation context menu — right-click on Fabric canvas
  DOM.fabricWrapper.addEventListener('contextmenu', e => {
    // Only show annotation context menu when a PDF is loaded
    if (!State.pdfDoc) return;
    e.preventDefault();

    const canvas = getCanvas();
    if (!canvas) return;

    // Find the Fabric object under the pointer
    const target = canvas.getActiveObject() || canvas.findTarget(e);
    showAnnotationContextMenu(e, target);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboard);

  // Text edit fallback notification
  document.addEventListener('text-edit-fallback', (e) => {
    const n = e.detail.count;
    toast(`${n} line${n > 1 ? 's' : ''} used fallback rendering — font may differ slightly`, 'info');
  });

  // Redaction visual-only warning
  document.addEventListener('redact-warning', () => {
    toast('Redactions are visual only — export to PDF to make permanent. Original content may still be extractable.', 'warning', 6000);
  });

  // Find bar events
  const findInput = $('find-input');
  if (findInput) {
    findInput.addEventListener('input', debounce(() => _appCallbacks.performSearch?.(), 200));
    findInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) _appCallbacks.navigateMatch?.('prev');
        else _appCallbacks.navigateMatch?.('next');
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        _appCallbacks.closeFindBar?.();
      }
    });
  }
  $('find-next')?.addEventListener('click', () => _appCallbacks.navigateMatch?.('next'));
  $('find-prev')?.addEventListener('click', () => _appCallbacks.navigateMatch?.('prev'));
  $('find-close')?.addEventListener('click', () => _appCallbacks.closeFindBar?.());
  $('find-case-sensitive')?.addEventListener('change', () => _appCallbacks.performSearch?.());
  $('find-replace-toggle')?.addEventListener('click', () => _appCallbacks.toggleReplaceRow?.());
  $('replace-one')?.addEventListener('click', () => _appCallbacks.executeReplace?.());
  $('replace-all')?.addEventListener('click', () => _appCallbacks.executeReplaceAll?.());
  const replaceInput = $('replace-input');
  if (replaceInput) {
    replaceInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _appCallbacks.executeReplace?.(); }
      if (e.key === 'Escape') { e.preventDefault(); _appCallbacks.closeFindBar?.(); }
    });
  }

  // Window resize: debounced re-render
  window.addEventListener('resize', debounce(() => {
    if (State.pdfDoc) renderCurrentPage();
  }, 250));

  // Drag-and-drop on canvas area
  // If no PDF is loaded -> open the file. If a PDF is already open -> append pages.
  DOM.canvasArea.addEventListener('dragover', e => {
    e.preventDefault();
    DOM.canvasArea.classList.add('drag-over');
  });
  DOM.canvasArea.addEventListener('dragleave', () => {
    DOM.canvasArea.classList.remove('drag-over');
  });
  DOM.canvasArea.addEventListener('drop', e => {
    e.preventDefault();
    DOM.canvasArea.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.name.toLowerCase().endsWith('.pdf') ||
      f.type.startsWith('image/') ||
      /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(f.name)
    );
    if (!files.length) return;
    if (State.pdfDoc) {
      // PDF already open — append pages to end
      _appCallbacks.handleAddPages?.(files);
    } else {
      _appCallbacks.handleFiles?.(files);
    }
  });

  // Drag-and-drop on sidebar thumbnail list — reorder pages or insert new ones
  DOM.thumbnailList.addEventListener('dragover', e => {
    e.preventDefault();
    const isInternal = e.dataTransfer.types.includes('text/x-mudbrick-page');
    e.dataTransfer.dropEffect = isInternal ? 'move' : 'copy';
    const target = _appCallbacks.getDropTarget?.(e);
    _appCallbacks.clearDropIndicators?.();
    if (target?.item) {
      target.item.classList.add(target.position === 'before' ? 'drop-before' : 'drop-after');
    }
  });
  DOM.thumbnailList.addEventListener('dragleave', e => {
    if (!DOM.thumbnailList.contains(e.relatedTarget)) {
      _appCallbacks.clearDropIndicators?.();
    }
  });
  DOM.thumbnailList.addEventListener('drop', async e => {
    e.preventDefault();
    _appCallbacks.clearDropIndicators?.();

    // Internal page reorder
    const draggedPage = e.dataTransfer.getData('text/x-mudbrick-page');
    if (draggedPage && State.pdfBytes) {
      const fromPage = parseInt(draggedPage);
      const target = _appCallbacks.getDropTarget?.(e);
      if (!target?.item) return;
      let toPage = parseInt(target.item.dataset.page);
      if (target.position === 'after') toPage++;
      const fromIdx = fromPage - 1;
      let toIdx = toPage - 1;
      if (fromIdx === toIdx || fromIdx === toIdx - 1) return;
      if (fromIdx < toIdx) toIdx--;
      showLoading('Reordering pages...');
      try {
        const newBytes = await reorderPages(State.pdfBytes, fromIdx, toIdx);
        if (State.currentPage === fromPage) {
          State.currentPage = toIdx + 1;
        } else if (fromPage < State.currentPage && toIdx + 1 >= State.currentPage) {
          State.currentPage--;
        } else if (fromPage > State.currentPage && toIdx + 1 <= State.currentPage) {
          State.currentPage++;
        }
        await _appCallbacks.reloadAfterEdit?.(newBytes);
        toast(`Moved page ${fromPage}`, 'success');
      } catch (err) {
        console.error('Page reorder failed:', err);
        toast('Reorder failed: ' + err.message, 'error');
      } finally {
        hideLoading();
      }
      return;
    }

    // External file drop — insert pages
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.name.toLowerCase().endsWith('.pdf') ||
      f.type.startsWith('image/') ||
      /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(f.name)
    );
    if (!files.length || !State.pdfDoc) return;

    const target = _appCallbacks.getDropTarget?.(e);
    let insertAfter;
    if (target?.item) {
      const pageNum = parseInt(target.item.dataset.page);
      insertAfter = target.position === 'before' ? pageNum - 2 : pageNum - 1;
      if (insertAfter < -1) insertAfter = -1;
    }
    if (insertAfter === -1) {
      _appCallbacks.handleAddPages?.(files, -1);
    } else {
      _appCallbacks.handleAddPages?.(files, insertAfter);
    }
  });

  /* ── Security ribbon ── */
  $('btn-encrypt').addEventListener('click', () => {
    $('encrypt-modal-backdrop').classList.remove('hidden');
  });
  $('btn-encrypt-execute').addEventListener('click', () => _appCallbacks.executeEncrypt?.());

  $('btn-metadata').addEventListener('click', () => _appCallbacks.openMetadataModal?.());
  $('btn-meta-save').addEventListener('click', () => _appCallbacks.executeMetadataSave?.());
  $('btn-meta-remove').addEventListener('click', () => _appCallbacks.executeMetadataRemove?.());

  $('btn-redact-search').addEventListener('click', () => {
    $('redact-results-list').innerHTML = '';
    $('redact-results').classList.add('hidden');
    $('btn-redact-apply').classList.add('hidden');
    $('redact-search-modal-backdrop').classList.remove('hidden');
  });
  $('btn-redact-search-execute').addEventListener('click', () => _appCallbacks.executeRedactSearch?.());
  $('btn-redact-apply').addEventListener('click', () => _appCallbacks.executeRedactApply?.());

  // Toggle custom pattern row when "Custom Pattern" checkbox changes
  document.querySelectorAll('.redact-pattern-cb').forEach(cb => {
    if (cb.value === 'custom') {
      cb.addEventListener('change', () => {
        $('redact-custom-row').classList.toggle('hidden', !cb.checked);
      });
    }
  });

  /* ── Tools ribbon ── */
  $('btn-export-image').addEventListener('click', () => {
    $('export-image-modal-backdrop').classList.remove('hidden');
  });
  $('btn-export-image-execute').addEventListener('click', () => _appCallbacks.executeExportImage?.());

  // Show/hide custom range row based on scope
  $('export-img-scope')?.addEventListener('change', (e) => {
    $('export-img-range-row').classList.toggle('hidden', e.target.value !== 'custom');
  });
  // Update quality % display
  $('export-img-quality')?.addEventListener('input', (e) => {
    const display = $('export-img-quality-val');
    if (display) display.textContent = e.target.value + '%';
  });

  $('btn-create-from-images').addEventListener('click', () => {
    $('create-from-images-modal-backdrop').classList.remove('hidden');
    _appCallbacks.resetImagesToPdf?.();
    $('images-file-list').innerHTML = '<p style="color:var(--mb-text-secondary)">No images added yet.</p>';
  });
  $('btn-create-from-images-execute').addEventListener('click', () => _appCallbacks.executeCreateFromImages?.());

  // Images drop zone
  const imgDropZone = $('images-drop-zone');
  if (imgDropZone) {
    imgDropZone.addEventListener('dragover', e => { e.preventDefault(); imgDropZone.classList.add('drag-over'); });
    imgDropZone.addEventListener('dragleave', () => imgDropZone.classList.remove('drag-over'));
    imgDropZone.addEventListener('drop', e => {
      e.preventDefault();
      imgDropZone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      _appCallbacks.addImagesToList?.(files);
    });
    imgDropZone.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
      input.addEventListener('change', () => _appCallbacks.addImagesToList?.(Array.from(input.files)));
      input.click();
    });
  }

  $('btn-optimize').addEventListener('click', () => {
    $('optimize-result').textContent = '';
    $('optimize-result').classList.add('hidden');
    $('optimize-modal-backdrop').classList.remove('hidden');
  });
  $('btn-optimize-execute').addEventListener('click', () => _appCallbacks.executeOptimize?.());
  $('optimize-quality')?.addEventListener('input', (e) => {
    const display = $('optimize-quality-val');
    if (display) display.textContent = e.target.value + '%';
  });
  // Show/hide custom options based on preset
  $('optimize-preset')?.addEventListener('change', (e) => {
    const customOpts = $('optimize-custom-opts');
    if (customOpts) customOpts.classList.toggle('hidden', e.target.value !== 'custom');
  });
  // Update hint text when mode changes
  $('optimize-mode')?.addEventListener('change', (e) => {
    const hint = $('optimize-mode-hint');
    if (hint) {
      const hints = {
        smart: 'Smart mode preserves text, links, and fonts on text-only pages. Only image-heavy pages are recompressed.',
        images: 'Images Only mode recompresses individual embedded images without rasterizing pages. All text, fonts, links, and vectors are preserved.',
        aggressive: 'Aggressive mode rasterizes all pages as JPEG. Text will become non-selectable.',
      };
      hint.textContent = hints[e.target.value] || hints.smart;
    }
    // Hide DPI for images-only mode (it doesn't use DPI)
    const dpiRow = $('optimize-custom-opts');
    const presetRow = $('optimize-preset')?.parentElement;
    if (e.target.value === 'images') {
      if (presetRow) presetRow.style.display = 'none';
      if (dpiRow) dpiRow.classList.add('hidden');
    } else {
      if (presetRow) presetRow.style.display = '';
    }
  });

  $('btn-compare').addEventListener('click', () => {
    $('compare-setup').classList.remove('hidden');
    $('compare-results').classList.add('hidden');
    $('compare-modal-backdrop').classList.remove('hidden');
    _appCallbacks.resetCompareDocB?.();
  });
  $('btn-compare-execute').addEventListener('click', () => _appCallbacks.executeCompare?.());
  $('btn-compare-report').addEventListener('click', () => _appCallbacks.downloadCompareReport?.());
  $('btn-compare-prev')?.addEventListener('click', () => _appCallbacks.navigateCompare?.(-1));
  $('btn-compare-next')?.addEventListener('click', () => _appCallbacks.navigateCompare?.(1));
  $('compare-view-mode')?.addEventListener('change', () => _appCallbacks.renderCurrentCompare?.());

  // Compare drop zone
  const cmpDropZone = $('compare-drop-zone');
  if (cmpDropZone) {
    cmpDropZone.addEventListener('dragover', e => { e.preventDefault(); cmpDropZone.classList.add('drag-over'); });
    cmpDropZone.addEventListener('dragleave', () => cmpDropZone.classList.remove('drag-over'));
    cmpDropZone.addEventListener('drop', e => {
      e.preventDefault();
      cmpDropZone.classList.remove('drag-over');
      const file = Array.from(e.dataTransfer.files).find(f => f.name.toLowerCase().endsWith('.pdf'));
      if (file) _appCallbacks.loadCompareFile?.(file);
    });
    cmpDropZone.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.pdf';
      input.addEventListener('change', () => { if (input.files[0]) _appCallbacks.loadCompareFile?.(input.files[0]); });
      input.click();
    });
  }

  $('btn-comment-summary').addEventListener('click', () => _appCallbacks.openCommentSummaryModal?.());
  $('btn-comment-download').addEventListener('click', () => _appCallbacks.downloadCommentSummary?.());
  $('btn-flatten-anno-exec').addEventListener('click', () => _appCallbacks.executeFlattenAnnotations?.());

  $('btn-flatten-annotations').addEventListener('click', () => _appCallbacks.executeFlattenAnnotations?.());

  /* ── Forms ribbon ── */
  $('btn-form-text').addEventListener('click', () => _appCallbacks.createFormFieldInteractive?.('text'));
  $('btn-form-checkbox').addEventListener('click', () => _appCallbacks.createFormFieldInteractive?.('checkbox'));
  $('btn-form-dropdown').addEventListener('click', () => _appCallbacks.createFormFieldInteractive?.('dropdown'));
  $('btn-form-radio').addEventListener('click', () => _appCallbacks.createFormFieldInteractive?.('radio'));
  $('btn-form-signature').addEventListener('click', () => _appCallbacks.createFormFieldInteractive?.('signature'));
  $('btn-form-button').addEventListener('click', () => _appCallbacks.createFormFieldInteractive?.('button'));

  $('btn-form-import').addEventListener('click', () => {
    $('form-import-pane').classList.remove('hidden');
    $('form-export-pane').classList.add('hidden');
    $('form-data-modal-backdrop').classList.remove('hidden');
  });
  $('btn-form-export').addEventListener('click', () => {
    $('form-import-pane').classList.add('hidden');
    $('form-export-pane').classList.remove('hidden');
    $('form-data-modal-backdrop').classList.remove('hidden');
  });
  $('btn-form-data-execute')?.addEventListener('click', () => {
    // Determine which pane is active
    const importPane = $('form-import-pane');
    if (importPane && !importPane.classList.contains('hidden')) {
      _appCallbacks.executeFormDataImport?.();
    } else {
      const fmt = $('form-export-format')?.value || 'json';
      _appCallbacks.executeFormDataExport?.(fmt);
    }
  });

  $('btn-form-tab-order').addEventListener('click', () => _appCallbacks.showTabOrder?.());
  $('btn-form-flatten').addEventListener('click', () => _appCallbacks.executeFormFlatten?.());

  /* ── Phase 3 Batch: Exhibit Stamps, Sanitize, Page Labels, Replace Pages ── */

  // Exhibit Stamp
  $('btn-exhibit-stamp').addEventListener('click', () => _appCallbacks.openExhibitModal?.());
  $('btn-exhibit-execute').addEventListener('click', () => _appCallbacks.executeExhibitPlace?.());
  $('exhibit-format')?.addEventListener('change', () => _appCallbacks.updateExhibitPreview?.());
  $('exhibit-prefix')?.addEventListener('input', () => _appCallbacks.updateExhibitPreview?.());

  // Sanitize Document
  $('btn-sanitize').addEventListener('click', () => _appCallbacks.openSanitizeModal?.());
  $('btn-sanitize-execute').addEventListener('click', () => _appCallbacks.executeSanitize?.());
  $('sanitize-confirm').addEventListener('change', () => {
    $('btn-sanitize-execute').disabled = !$('sanitize-confirm').checked;
  });

  // Page Labels
  $('btn-page-labels').addEventListener('click', () => _appCallbacks.openPageLabelsModal?.());
  $('btn-add-label-range').addEventListener('click', () => _appCallbacks.addLabelRangeRow?.());
  $('btn-page-labels-apply').addEventListener('click', () => _appCallbacks.executePageLabels?.());

  // Replace Pages
  $('btn-replace-pages').addEventListener('click', () => _appCallbacks.openReplacePagesModal?.());
  $('btn-replace-execute').addEventListener('click', () => _appCallbacks.executeReplacePages?.());
  $('replace-confirm').addEventListener('change', () => {
    $('btn-replace-execute').disabled = !$('replace-confirm').checked;
  });

  // Replace Pages — file picker
  const replaceDropZone = $('replace-source-drop');
  if (replaceDropZone) {
    replaceDropZone.addEventListener('dragover', e => { e.preventDefault(); replaceDropZone.classList.add('drag-over'); });
    replaceDropZone.addEventListener('dragleave', () => replaceDropZone.classList.remove('drag-over'));
    replaceDropZone.addEventListener('drop', e => {
      e.preventDefault();
      replaceDropZone.classList.remove('drag-over');
      const file = Array.from(e.dataTransfer.files).find(f => f.name.toLowerCase().endsWith('.pdf'));
      if (file) _appCallbacks.loadReplaceSource?.(file);
    });
    replaceDropZone.addEventListener('click', () => {
      $('replace-file-input').click();
    });
    $('replace-file-input').addEventListener('change', () => {
      const f = $('replace-file-input').files[0];
      if (f) _appCallbacks.loadReplaceSource?.(f);
    });
  }

  // Form data drop zone
  const formDropZone = $('form-import-drop-zone');
  if (formDropZone) {
    formDropZone.addEventListener('dragover', e => { e.preventDefault(); formDropZone.classList.add('drag-over'); });
    formDropZone.addEventListener('dragleave', () => formDropZone.classList.remove('drag-over'));
    formDropZone.addEventListener('drop', e => {
      e.preventDefault();
      formDropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) { _appCallbacks.setFormDataFile?.(file); formDropZone.querySelector('p').textContent = file.name; }
    });
    formDropZone.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json,.xfdf,.csv';
      input.addEventListener('change', () => {
        if (input.files[0]) { _appCallbacks.setFormDataFile?.(input.files[0]); formDropZone.querySelector('p').textContent = input.files[0].name; }
      });
      input.click();
    });
  }

  // ── Flyout: Pages panel buttons ──
  $('btn-rotate-cw').addEventListener('click', async () => {
    if (!State.pdfBytes) return;
    showLoading('Rotating page...');
    try {
      const newBytes = await rotatePage(State.pdfBytes, State.currentPage - 1, 90);
      await _appCallbacks.reloadAfterEdit?.(newBytes);
      toast('Rotated page right', 'success');
    } catch (err) { toast('Rotate failed: ' + err.message, 'error'); }
    finally { hideLoading(); }
  });

  $('btn-rotate-ccw').addEventListener('click', async () => {
    if (!State.pdfBytes) return;
    showLoading('Rotating page...');
    try {
      const newBytes = await rotatePage(State.pdfBytes, State.currentPage - 1, -90);
      await _appCallbacks.reloadAfterEdit?.(newBytes);
      toast('Rotated page left', 'success');
    } catch (err) { toast('Rotate failed: ' + err.message, 'error'); }
    finally { hideLoading(); }
  });

  $('btn-delete-page').addEventListener('click', async () => {
    if (!State.pdfBytes || State.totalPages <= 1) return;
    if (!confirm(`Delete page ${State.currentPage}? This cannot be undone.`)) return;
    showLoading('Deleting page...');
    try {
      const newBytes = await deletePage(State.pdfBytes, State.currentPage - 1);
      if (State.currentPage > 1) State.currentPage--;
      await _appCallbacks.reloadAfterEdit?.(newBytes);
      toast('Page deleted', 'success');
    } catch (err) { toast('Delete failed: ' + err.message, 'error'); }
    finally { hideLoading(); }
  });

  $('btn-add-page').addEventListener('click', async () => {
    if (!State.pdfBytes) return;
    showLoading('Inserting page...');
    try {
      const newBytes = await insertBlankPage(State.pdfBytes, State.currentPage - 1);
      State.currentPage = State.currentPage + 1;
      await _appCallbacks.reloadAfterEdit?.(newBytes);
      toast('Inserted blank page', 'success');
    } catch (err) { toast('Insert page failed: ' + err.message, 'error'); }
    finally { hideLoading(); }
  });

  // ── Flyout: Forms panel buttons ──
  $('btn-detect-fields').addEventListener('click', async () => {
    if (!State.pdfDoc && !State.pdfLibDoc) { toast('Open a PDF first', 'error'); return; }
    try {
      // Try pdf-lib first
      if (State.pdfLibDoc) {
        State.formFields = detectFormFields(State.pdfLibDoc);
      }
      // Fall back to PDF.js if pdf-lib found nothing
      if (State.formFields.length === 0 && State.pdfDoc) {
        State.formFields = await detectFormFieldsPdfJs(State.pdfDoc);
      }
      if (State.formFields.length > 0) {
        toast(`Detected ${State.formFields.length} form field${State.formFields.length !== 1 ? 's' : ''}`, 'info');
        await renderCurrentPage();
      } else {
        toast('No form fields detected', 'info');
      }
    } catch (err) { toast('Form detection failed: ' + err.message, 'error'); }
  });

  $('btn-fill-mode').addEventListener('click', () => {
    if (!State.formFields.length) {
      toast('No form fields detected. Click "Detect Fields" first.', 'info');
      return;
    }
    renderCurrentPage();
    toast('Fill mode active — click form fields to fill them', 'info');
  });

  $('btn-create-field').addEventListener('click', () => {
    _appCallbacks.createFormFieldInteractive?.('text');
  });

  $('btn-import-form-data').addEventListener('click', () => {
    if (!State.pdfLibDoc) { toast('Open a PDF first', 'error'); return; }
    const backdrop = $('form-data-modal-backdrop');
    if (backdrop) backdrop.classList.remove('hidden');
  });

  $('btn-export-form-data').addEventListener('click', () => {
    if (!State.pdfLibDoc) { toast('Open a PDF first', 'error'); return; }
    _appCallbacks.executeFormDataExport?.('json');
  });

  $('btn-flatten-forms').addEventListener('click', () => {
    _appCallbacks.executeFormFlatten?.();
  });

  $('btn-tab-order').addEventListener('click', () => {
    _appCallbacks.showTabOrder?.();
  });

  // ── Flyout: Edit Image button ──
  $('btn-edit-image')?.addEventListener('click', () => {
    if (!State.pdfDoc) return;
    if (isImageEditActive()) {
      exitImageEditMode();
    } else {
      enterImageEditMode(State.pdfDoc, State.currentPage, DOM.pageContainer, State.zoom);
    }
  });

  // ── Flyout: OCR Correction Mode ──
  $('btn-ocr-correct-flyout')?.addEventListener('click', () => {
    if (!hasOCRResults()) { toast('Run OCR first', 'info'); return; }
    enableCorrectionMode();
    toast('OCR correction mode enabled', 'info');
  });

  // ── Flyout: Custom Stamp ──
  $('btn-custom-stamp')?.addEventListener('click', () => {
    selectTool('stamp');
    toast('Select a stamp type from the toolbar', 'info');
  });
}

/* ═══════════════════ handleKeyboard ═══════════════════ */

export function handleKeyboard(e) {
  const mod = e.ctrlKey || e.metaKey;

  // Ctrl+F — open find bar (intercept before input check so it works globally)
  if (mod && e.key === 'f' && State.pdfDoc) {
    e.preventDefault();
    _appCallbacks.openFindBar?.();
    return;
  }

  // Ctrl+H — open find bar with replace visible
  if (mod && e.key === 'h' && State.pdfDoc) {
    e.preventDefault();
    _appCallbacks.openFindBar?.(true);
    return;
  }

  // F6 / Shift+F6 — cycle between app landmark regions (WCAG 2.1 AA SC 2.1.1)
  // Handled before the input-guard so it works from any focused element.
  if (e.key === 'F6' && !mod) {
    e.preventDefault();
    cycleRegion(e.shiftKey);
    return;
  }

  // Undo / Redo — always available regardless of focus
  if (mod && e.key === 'z' && !e.shiftKey && State.pdfDoc) {
    e.preventDefault();
    _appCallbacks.handleUndo?.();
    return;
  }
  if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && State.pdfDoc) {
    e.preventDefault();
    _appCallbacks.handleRedo?.();
    return;
  }

  // Don't intercept when typing in inputs, selects, or Fabric IText editing
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.target.contentEditable === 'true') return;

  // ? key — show keyboard shortcuts (works without a PDF loaded)
  if (e.key === '?' && !mod) {
    e.preventDefault();
    _appCallbacks.openShortcutsModal?.();
    return;
  }

  // Shift+F10 — open context menu on the focused thumbnail (keyboard equivalent of right-click)
  if (e.key === 'F10' && e.shiftKey && !mod) {
    const focusedThumb = document.activeElement &&
      document.activeElement.closest('.thumbnail-item');
    if (focusedThumb && State.pdfDoc) {
      e.preventDefault();
      const pageNum = parseInt(focusedThumb.dataset.page, 10);
      if (!isNaN(pageNum)) {
        const rect = focusedThumb.getBoundingClientRect();
        const syntheticEvent = {
          preventDefault: () => {},
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        };
        showContextMenu(syntheticEvent, pageNum);
      }
      return;
    }
  }

  if (!State.pdfDoc) return;

  // Check if Fabric.js IText is being edited
  const canvas = getCanvas();
  const activeObj = canvas && canvas.getActiveObject();
  const isEditingText = activeObj && activeObj.isEditing;

  switch (true) {
    // Copy / Paste / Duplicate annotations
    case mod && e.key === 'c' && !isEditingText:
      e.preventDefault();
      copySelected();
      break;
    case mod && e.key === 'v' && !isEditingText:
      e.preventDefault();
      pasteClipboard();
      break;
    case mod && e.key === 'd' && !isEditingText:
      e.preventDefault();
      duplicateSelected();
      break;

    // Delete selected annotation object
    case (e.key === 'Delete' || e.key === 'Backspace') && !isEditingText:
      e.preventDefault();
      deleteSelected();
      break;

    // Escape: close dropdown -> close context menu -> close modal -> close crop
    //         -> close find bar -> deselect -> switch to select tool
    case e.key === 'Escape': {
      if (document.querySelector('.dropdown-menu')) {
        // Close title-bar dropdown and restore focus to the menu button
        const activeMenuBtn = document.querySelector('.menu-item.active');
        closeDropdown();
        if (activeMenuBtn) activeMenuBtn.focus();
      } else if (document.querySelector('.context-menu')) {
        // Close thumbnail / annotation context menu
        hideContextMenu();
      } else {
        const openBackdrop = document.querySelector('.modal-backdrop:not(.hidden)');
        if (openBackdrop) {
          const closeBtn = openBackdrop.querySelector('[data-close-modal]');
          if (closeBtn) closeBtn.click();
        } else if (_appCallbacks.getCropState?.()?.active) {
          _appCallbacks.closeCropModal?.();
        } else if (isFindOpen()) {
          _appCallbacks.closeFindBar?.();
        } else if (DOM.textLayer.querySelector('.ocr-text-span[contenteditable="true"]')) {
          disableCorrectionMode(DOM.textLayer);
          toast('OCR correction mode exited', 'info');
        } else {
          if (canvas) canvas.discardActiveObject().renderAll();
          selectTool('select');
        }
      }
      break;
    }

    // Tool shortcuts (only when not editing text)
    case e.key === 'v' && !mod && !isEditingText:
      selectTool('select');
      break;
    case e.key === 'h' && !mod && !isEditingText:
      selectTool('hand');
      break;
    case e.key === 't' && !mod && !isEditingText:
      selectTool('text');
      break;
    case e.key === 'd' && !mod && !isEditingText:
      selectTool('draw');
      break;

    // Print
    case mod && e.key === 'p':
      e.preventDefault();
      _appCallbacks.handlePrint?.();
      break;

    // Navigation
    case e.key === 'ArrowLeft' || e.key === 'ArrowUp':
      if (isEditingText) return; // let Fabric handle arrows in text
      e.preventDefault();
      prevPage();
      break;
    case e.key === 'ArrowRight' || e.key === 'ArrowDown':
      if (isEditingText) return;
      e.preventDefault();
      nextPage();
      break;
    case e.key === 'Home':
      e.preventDefault();
      goToPage(1);
      break;
    case e.key === 'End':
      e.preventDefault();
      goToPage(State.totalPages);
      break;

    // Zoom
    case (e.key === '=' || e.key === '+') && mod:
      e.preventDefault();
      zoomIn();
      break;
    case e.key === '-' && mod:
      e.preventDefault();
      zoomOut();
      break;
    case e.key === '0' && mod:
      e.preventDefault();
      setZoom(1.0);
      break;

    // File open
    case e.key === 'o' && mod:
      e.preventDefault();
      DOM.fileInput.click();
      break;

    // Save (Ctrl+S) / Save & Download (Ctrl+Shift+S)
    case e.key === 's' && mod:
      e.preventDefault();
      if (e.shiftKey) {
        _appCallbacks.handleSaveDownload?.();
      } else {
        _appCallbacks.handleSave?.();
      }
      break;
  }
}

/* ═══════════════════ selectTool ═══════════════════ */

/** Helper to switch tool and update UI across all ribbon panels */
export function selectTool(toolName) {
  // Sync ribbon toolbar buttons
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`.tool-btn[data-tool="${toolName}"]`).forEach(btn => {
    if (!btn.disabled) btn.classList.add('active');
  });
  // Sync floating toolbar buttons
  document.querySelectorAll('.float-btn[data-tool]').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`.float-btn[data-tool="${toolName}"]`).forEach(btn => {
    btn.classList.add('active');
  });
  State.activeTool = toolName;
  const activeShape = document.querySelector('#shape-picker .shape-pick.active');
  setTool(toolName, { shapeType: activeShape?.dataset.shape || 'rect', stampType: 'approved' });
  _appCallbacks.updatePanelToolTitle?.();
  // Update status bar tool indicator
  const toolLabel = $('status-tool');
  const _toolNames = { select: 'Select', hand: 'Hand', text: 'Text', draw: 'Draw', highlight: 'Highlight', underline: 'Underline', strikethrough: 'Strikethrough', shape: 'Shape', cover: 'Cover', redact: 'Redact', stamp: 'Stamp', 'sticky-note': 'Note' };
  if (toolLabel) {
    toolLabel.textContent = 'Tool: ' + (_toolNames[toolName] || toolName);
    toolLabel.classList.remove('hidden');
  }
  // Announce tool switch to screen readers
  announceToScreenReader((_toolNames[toolName] || toolName) + ' tool selected');
  // Show/hide tool properties section based on active tool
  const toolPropsEl = $('panel-tool-props');
  if (toolPropsEl) {
    const noPropsTools = ['select', 'hand'];
    toolPropsEl.style.display = noPropsTools.includes(toolName) ? 'none' : '';
  }
  // Show font controls only for text tool
  const fontSizeRow = $('prop-font-size-row');
  const fontFamilyRow = $('prop-font-family-row');
  const isTextTool = toolName === 'text' || toolName === 'select';
  if (fontSizeRow) fontSizeRow.style.display = isTextTool ? '' : 'none';
  if (fontFamilyRow) fontFamilyRow.style.display = isTextTool ? '' : 'none';
  // Show shape picker and stroke width only for shape tool
  const shapeTypeRow = $('prop-shape-type-row');
  const strokeWidthRow = $('prop-stroke-width-row');
  const isShapeTool = toolName === 'shape';
  if (shapeTypeRow) shapeTypeRow.style.display = isShapeTool ? '' : 'none';
  if (strokeWidthRow) strokeWidthRow.style.display = isShapeTool ? '' : 'none';
  // Update canvas cursor
  DOM.canvasArea.setAttribute('data-cursor', toolName);

  // Hand tool: disable text selection so it doesn't interfere with panning
  // Select tool: enable text selection on the text layer
  const textLayer = DOM.textLayer;
  if (textLayer) {
    if (toolName === 'hand') {
      textLayer.style.pointerEvents = 'none';
      textLayer.style.userSelect = 'none';
    } else if (toolName === 'select') {
      textLayer.style.pointerEvents = 'auto';
      textLayer.style.userSelect = 'auto';
    } else {
      // Other annotation tools: disable text selection
      textLayer.style.pointerEvents = 'none';
      textLayer.style.userSelect = 'none';
    }
  }

  // Contextual tip: first time activating an annotation tool
  const annotationTools = ['text', 'draw', 'highlight', 'underline', 'strikethrough', 'shape', 'cover', 'redact', 'stamp', 'sticky-note'];
  if (annotationTools.includes(toolName)) {
    showTip('first-annotation', 'Tip: Press Ctrl+Z to undo, or use the toolbar undo button', document.getElementById('btn-undo'));
  }

  // Update new icon rail + flyout panel active states
  document.querySelectorAll('.mb-rail-item[data-tool]').forEach(btn => {
    btn.classList.toggle('mb-rail-item--active', btn.dataset.tool === toolName);
  });
  document.querySelectorAll('.mb-flyout-item[data-tool]').forEach(btn => {
    btn.classList.toggle('mb-flyout-item--active', btn.dataset.tool === toolName);
  });
  if (typeof UIController !== 'undefined') {
    UIController.setActiveTool(toolName);
  }
}
