interface ExportToolsBarProps {
  onOpenPdfExport: () => void;
  onOpenImageExport: () => void;
  onFlattenAnnotations: () => void;
  onOptimizeDocument: () => void;
}

const buttonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '96px',
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

export function ExportToolsBar({
  onOpenPdfExport,
  onOpenImageExport,
  onFlattenAnnotations,
  onOptimizeDocument,
}: ExportToolsBarProps) {
  return (
    <div
      aria-label="Export tools"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginLeft: '12px',
        paddingLeft: '12px',
        borderLeft: '1px solid var(--mb-toolbar-divider)',
      }}
    >
      <button type="button" onClick={onOpenPdfExport} style={buttonStyle}>
        Export PDF
      </button>
      <button type="button" onClick={onOpenImageExport} style={buttonStyle}>
        Export Images
      </button>
      <button type="button" onClick={onOptimizeDocument} style={buttonStyle}>
        Optimize PDF
      </button>
      <button type="button" onClick={onFlattenAnnotations} style={buttonStyle}>
        Flatten
      </button>
    </div>
  );
}
