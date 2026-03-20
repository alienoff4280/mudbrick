/**
 * Mudbrick v2 -- AppModalHost
 *
 * Centralized modal rendering driven by uiStore.activeModal.
 * All dialogs route through here for consistent focus management.
 */

import { ExportDialog } from '../export/ExportDialog';
import { ImageExportDialog } from '../export/ImageExportDialog';
import { AnnotationReport } from '../export/AnnotationReport';
import { BatesDialog } from '../legal/BatesDialog';
import { HeaderFooterDialog } from '../legal/HeaderFooterDialog';
import { ComparisonViewer } from '../compare/ComparisonViewer';
import { SecurityPanel } from '../security/SecurityPanel';
import { useUIStore } from '../../stores/uiStore';

interface AppModalHostProps {
  /** Callback when a legal tool (Bates, headers) is applied */
  onLegalToolApplied?: () => void;
}

export function AppModalHost({ onLegalToolApplied }: AppModalHostProps) {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);

  return (
    <>
      <ExportDialog
        open={activeModal === 'export'}
        onClose={closeModal}
      />
      <ImageExportDialog
        open={activeModal === 'export-images'}
        onClose={closeModal}
      />
      <AnnotationReport
        open={activeModal === 'annotation-report'}
        onClose={closeModal}
      />
      <BatesDialog
        open={activeModal === 'bates'}
        onClose={closeModal}
        onApplied={onLegalToolApplied}
      />
      <HeaderFooterDialog
        open={activeModal === 'headers'}
        onClose={closeModal}
        onApplied={onLegalToolApplied}
      />
      <ComparisonViewer
        open={activeModal === 'compare'}
        onClose={closeModal}
      />
      <SecurityPanel
        open={activeModal === 'security'}
        onClose={closeModal}
      />
    </>
  );
}
