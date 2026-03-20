/**
 * Mudbrick v2 -- Recent Files Panel
 *
 * Shows recently opened files from the session store (persisted in localStorage).
 * Click to reopen a file. Clear history button.
 * Ported from v1 js/recent-files.js pattern.
 */

import { useCallback } from 'react';
import { useSessionStore, type RecentFile } from '../../stores/sessionStore';
import styles from './RecentFilesPanel.module.css';

interface RecentFilesPanelProps {
  onOpenFile: (filePath: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  } catch {
    return '';
  }
}

function RecentFileItem({
  file,
  onOpen,
  onRemove,
}: {
  file: RecentFile;
  onOpen: () => void;
  onRemove: (e: React.MouseEvent) => void;
}) {
  return (
    <div className={styles.fileItem} title={file.filePath}>
      <button type="button" className={styles.fileItem} onClick={onOpen}>
        <span className={styles.fileIcon}>PDF</span>
        <div className={styles.fileInfo}>
          <div className={styles.fileName}>{file.fileName}</div>
          <div className={styles.fileMeta}>
            <span>{formatFileSize(file.fileSize)}</span>
            <span>{file.pageCount} pages</span>
            <span>{formatDate(file.openedAt)}</span>
          </div>
        </div>
      </button>
      <button
        type="button"
        className={styles.removeBtn}
        onClick={onRemove}
        aria-label={`Remove ${file.fileName} from recent files`}
        title="Remove from list"
      >
        x
      </button>
    </div>
  );
}

export function RecentFilesPanel({ onOpenFile }: RecentFilesPanelProps) {
  const recentFiles = useSessionStore((s) => s.recentFiles);
  const removeRecentFile = useSessionStore((s) => s.removeRecentFile);
  const clearRecentFiles = useSessionStore((s) => s.clearRecentFiles);

  const handleOpen = useCallback(
    (filePath: string) => {
      onOpenFile(filePath);
    },
    [onOpenFile],
  );

  const handleRemove = useCallback(
    (e: React.MouseEvent, filePath: string) => {
      e.stopPropagation();
      removeRecentFile(filePath);
    },
    [removeRecentFile],
  );

  if (recentFiles.length === 0) {
    return null;
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>Recent Files</h3>
        <button className={styles.clearBtn} onClick={clearRecentFiles}>
          Clear history
        </button>
      </div>

      <div className={styles.list} role="list" aria-label="Recent files">
        {recentFiles.map((file) => (
          <RecentFileItem
            key={file.filePath}
            file={file}
            onOpen={() => handleOpen(file.filePath)}
            onRemove={(e) => handleRemove(e, file.filePath)}
          />
        ))}
      </div>
    </div>
  );
}
