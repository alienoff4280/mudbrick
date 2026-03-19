interface LegalToolsBarProps {
  onOpenBates: () => void;
  onOpenHeaders: () => void;
  onOpenExhibits: () => void;
  onOpenPageLabels: () => void;
  onOpenForms: () => void;
}

const buttonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '84px',
  height: '32px',
  padding: '0 12px',
  border: '1px solid var(--mb-toolbar-divider)',
  borderRadius: 'var(--mb-radius-sm)',
  backgroundColor: 'var(--mb-toolbar-hover)',
  color: 'var(--mb-toolbar-text)',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
} as const;

export function LegalToolsBar({
  onOpenBates,
  onOpenHeaders,
  onOpenExhibits,
  onOpenPageLabels,
  onOpenForms,
}: LegalToolsBarProps) {
  return (
    <div
      aria-label="Legal document tools"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginLeft: '12px',
        paddingLeft: '12px',
        borderLeft: '1px solid var(--mb-toolbar-divider)',
      }}
    >
      <button type="button" onClick={onOpenBates} style={buttonStyle}>
        Bates
      </button>
      <button type="button" onClick={onOpenHeaders} style={buttonStyle}>
        Headers
      </button>
      <button type="button" onClick={onOpenExhibits} style={buttonStyle}>
        Exhibits
      </button>
      <button type="button" onClick={onOpenPageLabels} style={buttonStyle}>
        Labels
      </button>
      <button type="button" onClick={onOpenForms} style={buttonStyle}>
        Forms
      </button>
    </div>
  );
}
