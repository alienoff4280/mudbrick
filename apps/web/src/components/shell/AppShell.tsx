/**
 * Mudbrick v2 -- AppShell
 *
 * Top-level editor shell layout.
 * Composes: menu bar, ribbon, viewer utility bar, left rail+pane,
 * center workspace, right task pane, status bar.
 */

import { useCallback, useEffect } from 'react';
import { AppMenuBar } from './menu/AppMenuBar';
import { RibbonTabStrip } from './ribbon/RibbonTabStrip';
import { RibbonPanel } from './ribbon/RibbonPanel';
import { ViewerUtilityBar } from './ViewerUtilityBar';
import { LeftNavigationRail } from './left-pane/LeftNavigationRail';
import { LeftPaneHost } from './left-pane/LeftPaneHost';
import { RightTaskPaneHost } from './right-pane/RightTaskPaneHost';
import { StatusBar } from './status/StatusBar';
import { useUIStore } from '../../stores/uiStore';
import { useDocumentStore } from '../../stores/documentStore';
import { registerHandler, unregisterHandler } from '../../services/commandRegistry';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: React.ReactNode;
  /** Handlers injected from App.tsx for file/document operations */
  onSave?: () => void;
  onSaveAs?: () => void;
  onOpenFile?: () => void;
  onMerge?: () => void;
  onFlattenAnnotations?: () => void;
  onOptimizeDocument?: () => void;
  /** Session props for left pane */
  sessionId: string;
  onNavigate: (pageNum: number) => void;
  onPageOperation?: (op: any) => void;
  onReorder?: (newOrder: number[]) => void;
  onDocumentUpdated?: () => void | Promise<void>;
}

export function AppShell({
  children,
  onSave,
  onSaveAs,
  onOpenFile,
  onMerge,
  onFlattenAnnotations,
  onOptimizeDocument,
  sessionId,
  onNavigate,
  onPageOperation,
  onReorder,
  onDocumentUpdated,
}: AppShellProps) {
  const leftPaneOpen = useUIStore((s) => s.leftPaneOpen);
  const rightPaneOpen = useUIStore((s) => s.rightPaneOpen);
  const ribbonCollapsed = useUIStore((s) => s.ribbonCollapsed);
  const document = useDocumentStore((s) => s.document);
  const openModal = useUIStore((s) => s.openModal);
  const toggleLeftPane = useUIStore((s) => s.toggleLeftPane);
  const toggleRightPane = useUIStore((s) => s.toggleRightPane);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const openRightPane = useUIStore((s) => s.openRightPane);

  // Register command handlers
  useEffect(() => {
    if (onSave) registerHandler('file.save', onSave);
    if (onSaveAs) registerHandler('file.saveAs', onSaveAs);
    if (onOpenFile) registerHandler('file.open', onOpenFile);
    if (onMerge) registerHandler('document.merge', onMerge);
    if (onFlattenAnnotations) registerHandler('export.flatten', onFlattenAnnotations);
    if (onOptimizeDocument) registerHandler('export.optimize', onOptimizeDocument);

    registerHandler('export.pdf', () => openModal('export'));
    registerHandler('export.images', () => openModal('export-images'));
    registerHandler('export.annotationReport', () => openModal('annotation-report'));
    registerHandler('tools.bates', () => openModal('bates'));
    registerHandler('tools.headers', () => openModal('headers'));
    registerHandler('tools.exhibits', () => openModal('exhibits'));
    registerHandler('tools.pageLabels', () => openModal('page-labels'));
    registerHandler('tools.signatures', () => openModal('signatures'));
    registerHandler('tools.compare', () => openModal('compare'));
    registerHandler('security.encrypt', () => openRightPane('security'));
    registerHandler('tools.ocr', () => openRightPane('ocr'));
    registerHandler('forms.detectFields', () => openRightPane('forms'));
    registerHandler('forms.editFields', () => openRightPane('forms'));
    registerHandler('view.toggleLeftPane', toggleLeftPane);
    registerHandler('view.toggleRightPane', toggleRightPane);
    registerHandler('view.toggleDarkMode', toggleTheme);

    return () => {
      const ids = [
        'file.save', 'file.saveAs', 'file.open', 'document.merge',
        'export.flatten', 'export.optimize', 'export.pdf', 'export.images',
        'export.annotationReport', 'tools.bates', 'tools.headers',
        'tools.exhibits', 'tools.pageLabels', 'tools.signatures',
        'tools.compare', 'security.encrypt', 'tools.ocr',
        'forms.detectFields', 'forms.editFields',
        'view.toggleLeftPane', 'view.toggleRightPane', 'view.toggleDarkMode',
      ];
      ids.forEach(unregisterHandler);
    };
  }, [onSave, onSaveAs, onOpenFile, onMerge, onFlattenAnnotations, onOptimizeDocument, openModal, toggleLeftPane, toggleRightPane, toggleTheme, openRightPane]);

  return (
    <div
      className={styles.shell}
      data-left-closed={!leftPaneOpen}
      data-right-closed={!rightPaneOpen}
    >
      <div className={styles.menubar}>
        <AppMenuBar hasDocument={!!document} />
      </div>

      <div className={styles.ribbon}>
        <RibbonTabStrip />
        {!ribbonCollapsed && <RibbonPanel />}
      </div>

      <div className={styles.utilbar}>
        <ViewerUtilityBar sessionId={sessionId} />
      </div>

      {leftPaneOpen && (
        <>
          <div className={styles.leftRail}>
            <LeftNavigationRail />
          </div>
          <div className={styles.leftPane}>
            <LeftPaneHost
              sessionId={sessionId}
              onNavigate={onNavigate}
              onPageOperation={onPageOperation}
              onReorder={onReorder}
              onDocumentUpdated={onDocumentUpdated}
            />
          </div>
        </>
      )}

      <main
        id="main-content"
        className={styles.workspace}
        role="main"
        aria-label="Document workspace"
      >
        {children}
      </main>

      {rightPaneOpen && (
        <div className={styles.rightPane}>
          <RightTaskPaneHost />
        </div>
      )}

      <div className={styles.statusbar}>
        <StatusBar />
      </div>
    </div>
  );
}
