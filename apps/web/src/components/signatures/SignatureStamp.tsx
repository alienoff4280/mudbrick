import { useCallback, useState } from 'react';
import { SignatureModal } from './SignatureModal';
import type { CSSProperties } from 'react';

interface SignatureStampProps {
  /** Called when the user finishes placing a signature with its data URL and position */
  onPlace: (signatureDataUrl: string) => void;
  /** Optional style override for the trigger button */
  style?: CSSProperties;
}

const defaultButtonStyle: CSSProperties = {
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
};

/**
 * SignatureStamp -- Toolbar button that opens the SignatureModal
 * and delivers the resulting data URL to the annotation canvas.
 *
 * The parent component (typically the annotation Toolbar) uses onPlace
 * to add the signature as an image stamp annotation onto the Fabric.js canvas.
 */
export function SignatureStamp({ onPlace, style }: SignatureStampProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const handleAccept = useCallback(
    (dataUrl: string) => {
      onPlace(dataUrl);
    },
    [onPlace],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        style={{ ...defaultButtonStyle, ...style }}
        title="Add signature"
        aria-label="Add signature"
      >
        Signature
      </button>
      <SignatureModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAccept={handleAccept}
      />
    </>
  );
}
