/**
 * Mudbrick v2 -- DropZone Component
 *
 * Drag-and-drop area for opening PDF files.
 * Visual feedback on drag-over, accepts .pdf files only.
 */

import { useState, useCallback, useRef, type ReactNode, type DragEvent } from 'react';

interface DropZoneProps {
  onFileDrop: (filePaths: string[]) => void;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
}

export function DropZone({ onFileDrop, disabled = false, children, className = '' }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      dragCounter.current += 1;
      if (dragCounter.current === 1) {
        setIsDragOver(true);
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current -= 1;
      if (dragCounter.current === 0) {
        setIsDragOver(false);
      }
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
    },
    [],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      dragCounter.current = 0;

      if (disabled) return;

      const files = Array.from(e.dataTransfer.files);
      const pdfFiles = files.filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      );

      if (pdfFiles.length > 0) {
        // In Tauri, dataTransfer gives us real paths.
        // In browser dev mode, we use file names as placeholders.
        const paths = pdfFiles.map((f) => (f as File & { path?: string }).path ?? f.name);
        onFileDrop(paths);
      }
    },
    [disabled, onFileDrop],
  );

  return (
    <div
      className={`dropzone ${isDragOver ? 'dropzone--active' : ''} ${className}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="region"
      aria-label="Drop PDF files here"
      style={{
        position: 'relative',
        border: `2px dashed ${isDragOver ? 'var(--mb-brand)' : 'var(--mb-border)'}`,
        borderRadius: 'var(--mb-radius-lg)',
        padding: '48px 32px',
        textAlign: 'center',
        transition: 'border-color var(--mb-transition), background-color var(--mb-transition)',
        backgroundColor: isDragOver ? 'var(--mb-brand-tint-subtle)' : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
      {isDragOver && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--mb-radius-lg)',
            backgroundColor: 'var(--mb-brand-tint)',
            color: 'var(--mb-brand)',
            fontWeight: 600,
            fontSize: '16px',
            pointerEvents: 'none',
          }}
        >
          Drop PDF here
        </div>
      )}
    </div>
  );
}
