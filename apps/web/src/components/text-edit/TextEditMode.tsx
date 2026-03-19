/**
 * Mudbrick v2 -- Text Edit Mode
 *
 * Click on a text region to edit it with a contentEditable overlay.
 * Uses cover-and-replace: sends the edit to the backend which draws
 * a white rectangle over the original and places new text on top.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../../services/api';
import { useDocumentStore } from '../../stores/documentStore';
import { useUIStore } from '../../stores/uiStore';
import { sampleBackgroundColor, sampleTextColor } from '../../utils/colorSampler';
import type { TextBlock, TextEditItem } from '../../types/api';
import styles from './TextEditMode.module.css';

interface TextEditModeProps {
  /** Text blocks extracted from the current page */
  blocks: TextBlock[];
  /** Current page number (1-indexed) */
  pageNumber: number;
  /** Scale factor: CSS pixels per PDF point */
  scale: number;
  /** Reference to the PDF canvas for color sampling */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Callback when edits are committed */
  onEditCommitted: () => void;
  /** Callback to exit text edit mode */
  onExit: () => void;
}

interface PendingEdit {
  block: TextBlock;
  newText: string;
  font: string;
  size: number;
  color: string;
  bgColor: string;
}

export function TextEditMode({
  blocks,
  pageNumber,
  scale,
  canvasRef,
  onEditCommitted,
  onExit,
}: TextEditModeProps) {
  const document = useDocumentStore((s) => s.document);
  const addToast = useUIStore((s) => s.addToast);

  const [activeBlock, setActiveBlock] = useState<TextBlock | null>(null);
  const [editText, setEditText] = useState('');
  const [editFont, setEditFont] = useState('helv');
  const [editSize, setEditSize] = useState(12);
  const [editColor, setEditColor] = useState('#000000');
  const [editBgColor, setEditBgColor] = useState('#ffffff');
  const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([]);
  const [committing, setCommitting] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);

  const handleBlockClick = useCallback(
    (block: TextBlock) => {
      setActiveBlock(block);
      setEditText(block.text);
      setEditFont(block.font || 'helv');
      setEditSize(block.size || 12);

      // Sample colors from the canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const bgColor = sampleBackgroundColor(
          canvas,
          block.x * scale,
          block.y * scale,
          block.width * scale,
          block.height * scale,
        );
        const textColor = sampleTextColor(
          canvas,
          block.x * scale,
          block.y * scale,
          block.width * scale,
          block.height * scale,
          bgColor,
        );
        setEditBgColor(bgColor);
        setEditColor(block.color !== '#000000' ? block.color : textColor);
      } else {
        setEditColor(block.color || '#000000');
        setEditBgColor('#ffffff');
      }
    },
    [canvasRef, scale],
  );

  const handleSaveEdit = useCallback(() => {
    if (!activeBlock || !editText.trim()) return;

    setPendingEdits((prev) => [
      ...prev,
      {
        block: activeBlock,
        newText: editText,
        font: editFont,
        size: editSize,
        color: editColor,
        bgColor: editBgColor,
      },
    ]);
    setActiveBlock(null);
    setEditText('');
  }, [activeBlock, editText, editFont, editSize, editColor, editBgColor]);

  const handleCancelEdit = useCallback(() => {
    setActiveBlock(null);
    setEditText('');
  }, []);

  const handleCommitAll = useCallback(async () => {
    if (!document || pendingEdits.length === 0) return;

    setCommitting(true);
    try {
      const edits: TextEditItem[] = pendingEdits.map((e) => ({
        x: e.block.x,
        y: e.block.y,
        width: e.block.width,
        height: e.block.height,
        text: e.newText,
        font: e.font,
        size: e.size,
        color: e.color,
        bg_color: e.bgColor,
      }));

      await api.editText(document.sessionId, pageNumber, edits);
      setPendingEdits([]);
      addToast({
        type: 'success',
        message: `Applied ${edits.length} text edit(s)`,
      });
      onEditCommitted();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Text edit failed';
      addToast({ type: 'error', message: msg });
    } finally {
      setCommitting(false);
    }
  }, [document, pageNumber, pendingEdits, addToast, onEditCommitted]);

  // Focus the edit div when active
  useEffect(() => {
    if (activeBlock && editRef.current) {
      editRef.current.focus();
    }
  }, [activeBlock]);

  return (
    <div className={styles.container}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>Text Edit Mode</span>
        <span className={styles.toolbarInfo}>
          {pendingEdits.length} pending edit(s)
        </span>
        <button
          className={styles.commitBtn}
          onClick={handleCommitAll}
          disabled={pendingEdits.length === 0 || committing}
        >
          {committing ? 'Saving...' : 'Commit All'}
        </button>
        <button className={styles.exitBtn} onClick={onExit}>
          Exit
        </button>
      </div>

      {/* Clickable text block overlays */}
      {blocks.map((block, i) => {
        const isActive = activeBlock === block;
        const hasPendingEdit = pendingEdits.some(
          (e) =>
            e.block.x === block.x &&
            e.block.y === block.y &&
            e.block.width === block.width,
        );

        return (
          <div
            key={i}
            className={`${styles.blockOverlay} ${isActive ? styles.active : ''} ${hasPendingEdit ? styles.edited : ''}`}
            style={{
              left: `${block.x * scale}px`,
              top: `${block.y * scale}px`,
              width: `${block.width * scale}px`,
              height: `${block.height * scale}px`,
            }}
            onClick={() => !isActive && handleBlockClick(block)}
          >
            {isActive && (
              <div className={styles.editPopover}>
                <div
                  ref={editRef}
                  className={styles.editArea}
                  contentEditable
                  suppressContentEditableWarning
                  style={{
                    fontFamily: editFont,
                    fontSize: `${editSize}px`,
                    color: editColor,
                    backgroundColor: editBgColor,
                  }}
                  onInput={(e) =>
                    setEditText((e.target as HTMLDivElement).textContent ?? '')
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSaveEdit();
                    }
                    if (e.key === 'Escape') handleCancelEdit();
                  }}
                >
                  {editText}
                </div>
                <div className={styles.editControls}>
                  <input
                    type="color"
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    title="Text color"
                    className={styles.colorPicker}
                  />
                  <input
                    type="number"
                    value={editSize}
                    onChange={(e) => setEditSize(Number(e.target.value))}
                    min={6}
                    max={72}
                    step={0.5}
                    className={styles.sizeInput}
                    title="Font size"
                  />
                  <button
                    className={styles.saveEditBtn}
                    onClick={handleSaveEdit}
                  >
                    Save
                  </button>
                  <button
                    className={styles.cancelEditBtn}
                    onClick={handleCancelEdit}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
