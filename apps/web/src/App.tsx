/**
 * Mudbrick v2 -- App Root Component
 *
 * Thin router between HomeShell (no document) and AppShell (with document).
 * All shell chrome is delegated to shell components.
 * Manages document open/save/close flow.
 */

import { useCallback } from 'react';
import { HomeShell } from './components/shell/HomeShell';
import { AppShell } from './components/shell/AppShell';
import { AppModalHost } from './components/shell/AppModalHost';
import { useShellShortcuts, useRegionCycling } from './hooks/useShellShortcuts';
import { LoadingOverlay } from './components/welcome/LoadingOverlay';
import { PdfViewer } from './components/viewer/PdfViewer';
import { SkipLink } from './components/a11y/SkipLink';
import { AnnouncerProvider } from './components/a11y/Announcer';
import { OnboardingTooltips } from './components/onboarding/OnboardingTooltips';
import { ToastContainer } from './components/shared/Toast';
import { OfflineIndicator } from './components/shared/OfflineIndicator';
import { useDocumentStore } from './stores/documentStore';
import { useAnnotationStore } from './stores/annotationStore';
import { useSessionStore } from './stores/sessionStore';
import { useUIStore } from './stores/uiStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useDarkMode } from './hooks/useDarkMode';
import { useTauri } from './hooks/useTauri';
import { api } from './services/api';
import type { PageOperation } from './components/sidebar/PageList';

export function App() {
  useDarkMode();
  useShellShortcuts();
  useRegionCycling();

  const document = useDocumentStore((s) => s.document);
  const loading = useDocumentStore((s) => s.loading);
  const error = useDocumentStore((s) => s.error);
  const setDocument = useDocumentStore((s) => s.setDocument);
  const setLoading = useDocumentStore((s) => s.setLoading);
  const setError = useDocumentStore((s) => s.setError);
  const setCurrentPage = useDocumentStore((s) => s.setCurrentPage);
  const pageAnnotations = useAnnotationStore((s) => s.pageAnnotations);
  const clearAllAnnotations = useAnnotationStore((s) => s.clearAllAnnotations);
  const addRecentFile = useSessionStore((s) => s.addRecentFile);
  const addToast = useUIStore((s) => s.addToast);

  const { openFile, openMultipleFiles, openPdfOrImageFile, chooseSavePath } = useTauri();

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  const formatBytes = useCallback((bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  const loadDocumentIntoStore = useCallback(
    async (sessionId: string) => {
      const info = await api.getDocumentInfo(sessionId);
      setDocument({
        sessionId: info.session_id,
        filePath: info.file_path,
        fileName: info.file_name,
        fileSize: info.file_size,
        pageCount: info.page_count,
        currentVersion: info.current_version,
        pages: [],
        createdAt: info.created_at,
        updatedAt: info.updated_at,
      });
      return info;
    },
    [setDocument],
  );

  // -----------------------------------------------------------------------
  // File operations
  // -----------------------------------------------------------------------

  const handleOpenFile = useCallback(
    async (filePath: string) => {
      setLoading(true);
      setError(null);
      try {
        const createResp = await api.openFile(filePath);
        const info = await loadDocumentIntoStore(createResp.session_id);
        addRecentFile({
          filePath: info.file_path,
          fileName: info.file_name,
          fileSize: info.file_size,
          pageCount: info.page_count,
          openedAt: new Date().toISOString(),
        });
        addToast({ type: 'success', message: `Opened ${info.file_name}` });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to open file';
        setError(message);
        addToast({ type: 'error', message });
      } finally {
        setLoading(false);
      }
    },
    [addRecentFile, addToast, loadDocumentIntoStore, setError, setLoading],
  );

  const handleCreatePdfFromImages = useCallback(
    async (filePaths: string[]) => {
      setLoading(true);
      setError(null);
      try {
        const createResp = await api.createPdfFromImages(filePaths);
        const info = await loadDocumentIntoStore(createResp.session_id);
        addToast({
          type: 'success',
          message: `Created ${info.file_name || 'PDF'} from ${filePaths.length} image${filePaths.length !== 1 ? 's' : ''}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create PDF from images';
        setError(message);
        addToast({ type: 'error', message });
      } finally {
        setLoading(false);
      }
    },
    [addToast, loadDocumentIntoStore, setError, setLoading],
  );

  const handleKeyboardOpen = useCallback(async () => {
    const path = await openFile();
    if (path) handleOpenFile(path);
  }, [openFile, handleOpenFile]);

  const handleSaveAs = useCallback(async () => {
    if (!document) return;
    const path = await chooseSavePath(document.fileName);
    if (!path) return;
    try {
      setLoading(true);
      await api.saveAs(document.sessionId, path);
      await loadDocumentIntoStore(document.sessionId);
      addToast({ type: 'success', message: `Saved as ${path.split(/[/\\]/).pop()}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      addToast({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  }, [addToast, chooseSavePath, document, loadDocumentIntoStore, setLoading]);

  const handleSave = useCallback(async () => {
    if (!document) return;
    if (!document.filePath) {
      await handleSaveAs();
      return;
    }
    try {
      setLoading(true);
      await api.save(document.sessionId);
      addToast({ type: 'success', message: 'Saved' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      addToast({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  }, [addToast, document, handleSaveAs, setLoading]);

  const handleMerge = useCallback(async () => {
    const paths = await openMultipleFiles();
    if (paths.length < 2) {
      addToast({ type: 'warning', message: 'Select at least 2 files to merge' });
      return;
    }
    try {
      setLoading(true);
      const resp = await api.mergeFiles(paths);
      await loadDocumentIntoStore(resp.session_id);
      addToast({ type: 'success', message: `Merged ${paths.length} files` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Merge failed';
      addToast({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  }, [addToast, loadDocumentIntoStore, openMultipleFiles, setLoading]);

  const handleNavigateToPage = useCallback(
    (pageNum: number) => setCurrentPage(pageNum),
    [setCurrentPage],
  );

  const handlePageOperation = useCallback(
    async (op: PageOperation) => {
      if (!document) return;
      try {
        setLoading(true);
        const sid = document.sessionId;
        switch (op.type) {
          case 'rotate-cw':
            await api.rotatePage(sid, [op.pageNum], 90);
            break;
          case 'rotate-ccw':
            await api.rotatePage(sid, [op.pageNum], -90);
            break;
          case 'duplicate':
            await api.duplicatePages(sid, [op.pageNum]);
            break;
          case 'delete':
            await api.deletePage(sid, [op.pageNum]);
            break;
          case 'insert-after':
            await api.insertBlankPage(sid, op.pageNum);
            break;
          case 'insert-from-pdf': {
            const filePath = await openFile();
            if (!filePath) return;
            await api.insertPagesFromFile(sid, filePath, op.pageNum);
            break;
          }
          case 'replace-page': {
            const filePath = await openPdfOrImageFile();
            if (!filePath) return;
            await api.replacePage(sid, op.pageNum, filePath);
            break;
          }
        }
        await loadDocumentIntoStore(sid);
        const labels: Record<string, string> = {
          'rotate-cw': 'Rotated page clockwise',
          'rotate-ccw': 'Rotated page counter-clockwise',
          'duplicate': 'Duplicated page',
          'insert-after': 'Inserted blank page',
          'insert-from-pdf': 'Inserted pages from PDF',
          'replace-page': 'Replaced page',
          'delete': 'Deleted page',
        };
        addToast({ type: 'success', message: labels[op.type] ?? 'Page updated' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Operation failed';
        addToast({ type: 'error', message: msg });
      } finally {
        setLoading(false);
      }
    },
    [addToast, document, loadDocumentIntoStore, openFile, openPdfOrImageFile, setLoading],
  );

  const handleReorder = useCallback(
    async (newOrder: number[]) => {
      if (!document) return;
      try {
        setLoading(true);
        await api.reorderPages(document.sessionId, newOrder);
        await loadDocumentIntoStore(document.sessionId);
        addToast({ type: 'success', message: 'Pages reordered' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Reorder failed';
        addToast({ type: 'error', message: msg });
      } finally {
        setLoading(false);
      }
    },
    [addToast, document, loadDocumentIntoStore, setLoading],
  );

  const handleLegalToolApplied = useCallback(async () => {
    if (!document) return;
    await loadDocumentIntoStore(document.sessionId);
  }, [document, loadDocumentIntoStore]);

  const handleFlattenAnnotations = useCallback(async () => {
    if (!document) return;
    const annotationCount = Object.values(pageAnnotations).reduce(
      (sum, page) => sum + (page.objects?.length ?? 0),
      0,
    );
    if (annotationCount === 0) {
      addToast({ type: 'info', message: 'There are no annotations to flatten' });
      return;
    }
    try {
      setLoading(true);
      await api.flattenAnnotations(document.sessionId, pageAnnotations);
      clearAllAnnotations();
      await loadDocumentIntoStore(document.sessionId);
      addToast({ type: 'success', message: `Flattened ${annotationCount} annotation${annotationCount !== 1 ? 's' : ''}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to flatten annotations';
      addToast({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  }, [addToast, clearAllAnnotations, document, loadDocumentIntoStore, pageAnnotations, setLoading]);

  const handleOptimizeDocument = useCallback(async () => {
    if (!document) return;
    try {
      setLoading(true);
      const response = await api.optimizeDocument(document.sessionId);
      if (response.optimized) {
        await loadDocumentIntoStore(document.sessionId);
        addToast({ type: 'success', message: `Reduced file size by ${formatBytes(response.bytes_saved)}` });
      } else {
        addToast({ type: 'info', message: 'No additional size reduction was available' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to optimize PDF';
      addToast({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  }, [addToast, document, formatBytes, loadDocumentIntoStore, setLoading]);

  const handleSidebarDocumentUpdated = useCallback(async () => {
    if (!document) return;
    await loadDocumentIntoStore(document.sessionId);
  }, [document, loadDocumentIntoStore]);

  // -----------------------------------------------------------------------
  // Keyboard shortcuts
  // -----------------------------------------------------------------------

  useKeyboardShortcuts({
    'Ctrl+O': handleKeyboardOpen,
    'Ctrl+S': handleSave,
    'Ctrl+Shift+S': handleSaveAs,
  });

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <AnnouncerProvider>
      <SkipLink targetId="main-content" />
      <div className="app-layout">
        {!document ? (
          <HomeShell
            onOpenFile={handleOpenFile}
            onCreateFromImages={handleCreatePdfFromImages}
            onMergeFiles={handleMerge}
            loading={loading}
          />
        ) : (
          <AppShell
            sessionId={document.sessionId}
            onSave={handleSave}
            onSaveAs={handleSaveAs}
            onOpenFile={handleKeyboardOpen}
            onMerge={handleMerge}
            onFlattenAnnotations={handleFlattenAnnotations}
            onOptimizeDocument={handleOptimizeDocument}
            onNavigate={handleNavigateToPage}
            onPageOperation={handlePageOperation}
            onReorder={handleReorder}
            onDocumentUpdated={handleSidebarDocumentUpdated}
          >
            <PdfViewer
              sessionId={document.sessionId}
              version={document.currentVersion}
            />
          </AppShell>
        )}

        {/* Modals are always mounted for consistent lifecycle */}
        <AppModalHost onLegalToolApplied={handleLegalToolApplied} />

        <LoadingOverlay
          visible={loading}
          message={document ? 'Processing...' : 'Opening document...'}
        />
        <ToastContainer />
        <OfflineIndicator />
        {!document && <OnboardingTooltips />}
      </div>
    </AnnouncerProvider>
  );
}
