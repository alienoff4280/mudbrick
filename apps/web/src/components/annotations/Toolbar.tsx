/**
 * Mudbrick v2 -- Annotation Toolbar Component
 *
 * Tool selection bar for annotation tools.
 * Displays icons for select, draw, highlight, text, shape, stamp, redact.
 */

import { useAnnotationStore } from '../../stores/annotationStore';
import { TOOLS, type ToolId } from '@mudbrick/shared/src/constants';

interface ToolDef {
  id: ToolId;
  label: string;
  shortcut: string;
  icon: string; // SVG path data
}

const TOOL_DEFS: ToolDef[] = [
  {
    id: TOOLS.SELECT,
    label: 'Select',
    shortcut: 'V',
    icon: 'M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z',
  },
  {
    id: TOOLS.DRAW,
    label: 'Draw',
    shortcut: 'D',
    icon: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
  },
  {
    id: TOOLS.HIGHLIGHT,
    label: 'Highlight',
    shortcut: '',
    icon: 'M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
  },
  {
    id: TOOLS.TEXT,
    label: 'Text',
    shortcut: 'T',
    icon: 'M4 7V4h16v3M9 20h6M12 4v16',
  },
  {
    id: TOOLS.SHAPE,
    label: 'Shape',
    shortcut: '',
    icon: 'M3 3h18v18H3zM12 3v18M3 12h18',
  },
  {
    id: TOOLS.STAMP,
    label: 'Stamp',
    shortcut: '',
    icon: 'M5 21h14M12 17V7M7 7h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2z',
  },
  {
    id: TOOLS.REDACT,
    label: 'Redact',
    shortcut: '',
    icon: 'M2 2l20 20M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61',
  },
];

export function Toolbar() {
  const activeTool = useAnnotationStore((s) => s.activeTool);
  const setActiveTool = useAnnotationStore((s) => s.setActiveTool);

  return (
    <div
      role="toolbar"
      aria-label="Annotation tools"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        padding: '4px 8px',
      }}
    >
      {TOOL_DEFS.map((tool) => {
        const isActive = activeTool === tool.id;
        return (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id)}
            title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
            aria-label={tool.label}
            aria-pressed={isActive}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              background: isActive ? 'var(--mb-toolbar-active)' : 'none',
              border: 'none',
              borderRadius: 'var(--mb-radius-xs)',
              color: isActive ? '#fff' : 'var(--mb-toolbar-text)',
              cursor: 'pointer',
              transition: 'background-color var(--mb-transition)',
            }}
            onMouseOver={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = 'var(--mb-toolbar-hover)';
              }
            }}
            onMouseOut={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={tool.icon} />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
