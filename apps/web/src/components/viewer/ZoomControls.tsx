/**
 * Mudbrick v2 -- ZoomControls Component
 *
 * Zoom toolbar with zoom in/out buttons, percentage display,
 * fit-to-page, and fit-to-width buttons.
 */

import { formatZoomPercent } from '../../utils/zoom';
import type { ZoomState } from '../../types/pdf';

interface ZoomControlsProps {
  zoom: ZoomState;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  onResetZoom: () => void;
}

export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onFitPage,
  onResetZoom,
}: ZoomControlsProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 8px',
        backgroundColor: 'var(--mb-toolbar-bg)',
        borderRadius: 'var(--mb-radius-sm)',
      }}
    >
      <ZoomButton
        onClick={onZoomOut}
        title="Zoom out (Ctrl+-)"
        aria-label="Zoom out"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </ZoomButton>

      <button
        onClick={onResetZoom}
        title="Reset to 100% (Ctrl+0)"
        aria-label={`Current zoom: ${formatZoomPercent(zoom.level)}`}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--mb-toolbar-text)',
          fontSize: '12px',
          fontWeight: 500,
          padding: '4px 8px',
          cursor: 'pointer',
          minWidth: '48px',
          textAlign: 'center',
          borderRadius: 'var(--mb-radius-xs)',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--mb-toolbar-hover)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        {formatZoomPercent(zoom.level)}
      </button>

      <ZoomButton
        onClick={onZoomIn}
        title="Zoom in (Ctrl+=)"
        aria-label="Zoom in"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </ZoomButton>

      <Divider />

      <ZoomButton
        onClick={onFitWidth}
        title="Fit width"
        aria-label="Fit to width"
        active={zoom.fitMode === 'width'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 3H3v18h18V3z" />
          <path d="M6 12h12M6 12l3-3M6 12l3 3M18 12l-3-3M18 12l-3 3" />
        </svg>
      </ZoomButton>

      <ZoomButton
        onClick={onFitPage}
        title="Fit page"
        aria-label="Fit to page"
        active={zoom.fitMode === 'page'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <rect x="7" y="7" width="10" height="10" rx="1" />
        </svg>
      </ZoomButton>
    </div>
  );
}

function ZoomButton({
  onClick,
  title,
  children,
  active = false,
  ...rest
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  active?: boolean;
  'aria-label'?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        height: '28px',
        background: active ? 'var(--mb-toolbar-active)' : 'none',
        border: 'none',
        borderRadius: 'var(--mb-radius-xs)',
        color: 'var(--mb-toolbar-text)',
        cursor: 'pointer',
        transition: 'background-color var(--mb-transition)',
      }}
      onMouseOver={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = 'var(--mb-toolbar-hover)';
      }}
      onMouseOut={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = 'transparent';
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <div
      style={{
        width: '1px',
        height: '20px',
        backgroundColor: 'var(--mb-toolbar-divider)',
        margin: '0 4px',
      }}
    />
  );
}
