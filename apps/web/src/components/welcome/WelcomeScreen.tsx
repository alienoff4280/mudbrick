/**
 * Mudbrick v2 -- WelcomeScreen Component
 *
 * Landing screen shown when no document is open.
 * Provides file open button (Tauri dialog), drag-and-drop zone,
 * and recent files list from the session store.
 */

import { useCallback } from 'react';
import { DropZone } from './DropZone';
import { UpdatePanel } from '../shared/UpdatePanel';
import { useSessionStore, type RecentFile } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useTauri } from '../../hooks/useTauri';

interface WelcomeScreenProps {
  onOpenFile: (filePath: string) => void;
  onCreateFromImages: (filePaths: string[]) => void | Promise<void>;
  onMergeFiles: () => void | Promise<void>;
  loading: boolean;
}

export function WelcomeScreen({
  onOpenFile,
  onCreateFromImages,
  onMergeFiles,
  loading,
}: WelcomeScreenProps) {
  const { openFile, openImageFiles } = useTauri();
  const recentFiles = useSessionStore((s) => s.recentFiles);
  const removeRecentFile = useSessionStore((s) => s.removeRecentFile);
  const addToast = useUIStore((s) => s.addToast);

  const handleOpenClick = useCallback(async () => {
    const path = await openFile();
    if (path) {
      onOpenFile(path);
    }
  }, [openFile, onOpenFile]);

  const handleCreateFromImagesClick = useCallback(async () => {
    const paths = await openImageFiles();
    if (paths.length > 0) {
      await onCreateFromImages(paths);
    }
  }, [onCreateFromImages, openImageFiles]);

  const handleFileDrop = useCallback(
    (paths: string[]) => {
      const first = paths[0];
      if (first) {
        onOpenFile(first);
      }
    },
    [onOpenFile],
  );

  const handleRecentFileClick = useCallback(
    (file: RecentFile) => {
      onOpenFile(file.filePath);
    },
    [onOpenFile],
  );

  const handleRemoveRecent = useCallback(
    (e: React.MouseEvent, filePath: string) => {
      e.stopPropagation();
      removeRecentFile(filePath);
      addToast({ type: 'info', message: 'Removed from recent files' });
    },
    [removeRecentFile, addToast],
  );

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (isoDate: string): string => {
    try {
      const date = new Date(isoDate);
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '32px',
        padding: '48px 32px',
        maxWidth: '560px',
        width: '100%',
        margin: '0 auto',
      }}
    >
      {/* Logo / Title */}
      <div style={{ textAlign: 'center' }}>
        <h1
          style={{
            fontSize: '28px',
            fontWeight: 700,
            color: 'var(--mb-text-inverse)',
            marginBottom: '8px',
          }}
        >
          Mudbrick
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--mb-text-muted)' }}>
          PDF Editor for Desktop
        </p>
      </div>

      {/* Drop Zone */}
      <DropZone onFileDrop={handleFileDrop} disabled={loading}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--mb-text-muted)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="12" y2="12" />
            <line x1="15" y1="15" x2="12" y2="12" />
          </svg>
          <p style={{ fontSize: '14px', color: 'var(--mb-text-muted)' }}>
            Drag and drop a PDF here
          </p>
          <span style={{ fontSize: '12px', color: 'var(--mb-text-muted)', opacity: 0.7 }}>
            or
          </span>
          <button
            onClick={handleOpenClick}
            disabled={loading}
            style={{
              padding: '10px 24px',
              backgroundColor: 'var(--mb-brand)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--mb-radius-sm)',
              fontSize: '14px',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'background-color var(--mb-transition), opacity var(--mb-transition)',
            }}
            onMouseOver={(e) => {
              if (!loading) e.currentTarget.style.backgroundColor = 'var(--mb-brand-light)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--mb-brand)';
            }}
          >
            Open PDF
          </button>
          <button
            onClick={handleCreateFromImagesClick}
            disabled={loading}
            style={{
              padding: '10px 24px',
              backgroundColor: 'transparent',
              color: 'var(--mb-text)',
              border: '1px solid var(--mb-border)',
              borderRadius: 'var(--mb-radius-sm)',
              fontSize: '14px',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'background-color var(--mb-transition), opacity var(--mb-transition)',
            }}
            onMouseOver={(e) => {
              if (!loading) e.currentTarget.style.backgroundColor = 'var(--mb-surface-hover)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            Create PDF from Images
          </button>
          <button
            onClick={onMergeFiles}
            disabled={loading}
            style={{
              padding: '10px 24px',
              backgroundColor: 'transparent',
              color: 'var(--mb-text)',
              border: '1px solid var(--mb-border)',
              borderRadius: 'var(--mb-radius-sm)',
              fontSize: '14px',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'background-color var(--mb-transition), opacity var(--mb-transition)',
            }}
            onMouseOver={(e) => {
              if (!loading) e.currentTarget.style.backgroundColor = 'var(--mb-surface-hover)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            Merge PDFs
          </button>
        </div>
      </DropZone>

      {/* Keyboard shortcut hint */}
      <p style={{ fontSize: '12px', color: 'var(--mb-text-muted)', opacity: 0.7 }}>
        Press <kbd style={kbdStyle}>Ctrl+O</kbd> to open a file
      </p>

      <UpdatePanel />

      {/* Recent Files */}
      {recentFiles.length > 0 && (
        <div style={{ width: '100%' }}>
          <h2
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--mb-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '8px',
            }}
          >
            Recent Files
          </h2>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              borderRadius: 'var(--mb-radius-sm)',
              overflow: 'hidden',
            }}
          >
            {recentFiles.map((file) => (
              <div
                key={file.filePath}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  width: '100%',
                  backgroundColor: 'var(--mb-surface)',
                }}
              >
                <button
                  type="button"
                  onClick={() => handleRecentFileClick(file)}
                  disabled={loading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 12px',
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                    flex: 1,
                    color: 'var(--mb-text)',
                    transition: 'background-color var(--mb-transition)',
                  }}
                  onMouseOver={(e) => {
                    if (!loading) {
                      e.currentTarget.parentElement!.style.backgroundColor = 'var(--mb-surface-hover)';
                    }
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.parentElement!.style.backgroundColor = 'var(--mb-surface)';
                  }}
                >
                  {/* PDF icon */}
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--mb-brand)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {file.fileName}
                    </div>
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--mb-text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {file.filePath}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--mb-text-muted)',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    <span>{formatFileSize(file.fileSize)}</span>
                    <span style={{ margin: '0 4px' }}>·</span>
                    <span>{file.pageCount} pg</span>
                    <span style={{ margin: '0 4px' }}>·</span>
                    <span>{formatDate(file.openedAt)}</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(e) => handleRemoveRecent(e, file.filePath)}
                  aria-label={`Remove ${file.fileName} from recent files`}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--mb-text-muted)',
                    padding: '2px 8px',
                    fontSize: '14px',
                    opacity: 0.5,
                    flexShrink: 0,
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.opacity = '1';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.opacity = '0.5';
                  }}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 6px',
  fontSize: '11px',
  fontFamily: 'monospace',
  backgroundColor: 'var(--mb-surface)',
  color: 'var(--mb-text)',
  borderRadius: 'var(--mb-radius-xs)',
  border: '1px solid var(--mb-border)',
};
