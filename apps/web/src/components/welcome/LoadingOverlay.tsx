/**
 * Mudbrick v2 -- LoadingOverlay Component
 *
 * Full-screen loading overlay shown while a PDF is being opened.
 */

import { ProgressBar } from './ProgressBar';

interface LoadingOverlayProps {
  /** Message to show (e.g. "Opening document...") */
  message?: string;
  /** Progress 0-100, undefined for indeterminate */
  progress?: number;
  /** Whether the overlay is visible */
  visible: boolean;
}

export function LoadingOverlay({
  message = 'Loading...',
  progress,
  visible,
}: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={message}
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        zIndex: 2000,
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--mb-surface)',
          borderRadius: 'var(--mb-radius-md)',
          padding: '32px 48px',
          boxShadow: 'var(--mb-shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
          minWidth: '280px',
        }}
      >
        <span
          style={{
            fontSize: '14px',
            color: 'var(--mb-text)',
            fontWeight: 500,
          }}
        >
          {message}
        </span>
        <ProgressBar value={progress} height={4} showLabel={progress !== undefined} />
      </div>
    </div>
  );
}
