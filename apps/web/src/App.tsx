/**
 * Mudbrick v2 -- App Root Component
 *
 * Routes between WelcomeScreen (no document) and the main editor view.
 * Manages document open flow via the API client + document store.
 */

import { useCallback } from 'react';
import { WelcomeScreen } from './components/welcome/WelcomeScreen';
import { LoadingOverlay } from './components/welcome/LoadingOverlay';
import { PdfViewer } from './components/viewer/PdfViewer';
import { ThumbnailSidebar } from './components/viewer/ThumbnailSidebar';
import { Toolbar } from './components/annotations/Toolbar';
import { PropertyPanel } from './components/annotations/PropertyPanel';
import { ToastContainer } from './components/shared/Toast';
import { OfflineIndicator } from './components/shared/OfflineIndicator';
import { useDocumentStore } from './stores/documentStore';
import { useSessionStore } from './stores/sessionStore';
import { useUIStore } from './stores/uiStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useDarkMode } from './hooks/useDarkMode';
import { useTauri } from './hooks/useTauri';
import { api } from './services/api';
import type { PageOperation } from './components/sidebar/PageList';

export function App() {
  // Apply dark mode CSS class
  useDarkMode();

  const document = useDocumentStore((s) => s.document);
  const loading = useDocumentStore((s) => s.loading);
  const error = useDocumentStore((s) => s.error);
  const setDocument = useDocumentStore((s) => s.setDocument);
  const setLoading = useDocumentStore((s) => s.setLoading);
  const setError = useDocumentStore((s) => s.setError);

  const addRecentFile = useSessionStore((s) => s.addRecentFile);
  const addToast = useUIStore((s) => s.addToast);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  const { openFile, openMultipleFiles, chooseSavePath } = useTauri();

  /**
   * Open a PDF file by local path.
   * Calls POST /api/documents/open, then fetches full doc info.
   */
  const handleOpenFile = useCallback(
    async (filePath: string) => {
      setLoading(true);
      setError(null);
      try {
        // Open the file via backend
        const createResp = await api.openFile(filePath);

        // Fetch full document info
        const infoResp = await api.getDocumentInfo(createResp.session_id);

        // Build DocumentInfo from API response
        const fileName = filePath.split(/[/\\]/).pop() ?? filePath;

        setDocument({
          sessionId: infoResp.session_id,
          filePath: infoResp.file_path,
          fileName: infoResp.file_name,
          fileSize: infoResp.file_size,
          pageCount: infoResp.page_count,
          currentVersion: infoResp.current_version,
          pages: [], // Pages populated by viewer on render
          createdAt: infoResp.created_at,
          updatedAt: infoResp.updated_at,
        });

        // Track in recent files
        addRecentFile({
          filePath: infoResp.file_path,
          fileName: infoResp.file_name || fileName,
          fileSize: infoResp.file_size,
          pageCount: infoResp.page_count,
          openedAt: new Date().toISOString(),
        });

        addToast({ type: 'success', message: `Opened ${infoResp.file_name || fileName}` });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to open file';
        setError(message);
        addToast({ type: 'error', message });
      } finally {
        setLoading(false);
      }
    },
    [setDocument, setLoading, setError, addRecentFile, addToast],
  );

  /**
   * Keyboard shortcut: Ctrl+O to open file.
   */
  const handleKeyboardOpen = useCallback(async () => {
    const path = await openFile();
    if (path) {
      handleOpenFile(path);
    }
  }, [openFile, handleOpenFile]);

  const setCurrentPage = useDocumentStore((s) => s.setCurrentPage);

  /** Navigate to a specific page (from sidebar click) */
  const handleNavigateToPage = useCallback(
    (pageNum: number) => {
      setCurrentPage(pageNum);
      // PdfViewer will pick up the currentPage change and scroll
    },
    [setCurrentPage],
  );

  /** Save current document (Ctrl+S) */
  const handleSave = useCallback(async () => {
    if (!document) return;
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
  }, [document, setLoading, addToast]);

  /** Save As (Ctrl+Shift+S) */
  const handleSaveAs = useCallback(async () => {
    if (!document) return;
    const path = await chooseSavePath(document.fileName);
    if (!path) return;
    try {
      setLoading(true);
      await api.saveAs(document.sessionId, path);
      addToast({ type: 'success', message: `Saved as ${path.split(/[/\\]/).pop()}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      addToast({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  }, [document, chooseSavePath, setLoading, addToast]);

  /** Merge files */
  const handleMerge = useCallback(async () => {
    const paths = await openMultipleFiles();
    if (paths.length < 2) {
      addToast({ type: 'warning', message: 'Select at least 2 files to merge' });
      return;
    }
    try {
      setLoading(true);
      const resp = await api.mergeFiles(paths);
      const infoResp = await api.getDocumentInfo(resp.session_id);
      setDocument({
        sessionId: infoResp.session_id,
        filePath: infoResp.file_path,
        fileName: infoResp.file_name,
        fileSize: infoResp.file_size,
        pageCount: infoResp.page_count,
        currentVersion: infoResp.current_version,
        pages: [],
        createdAt: infoResp.created_at,
        updatedAt: infoResp.updated_at,
      });
      addToast({ type: 'success', message: `Merged ${paths.length} files` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Merge failed';
      addToast({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  }, [openMultipleFiles, setLoading, setDocument, addToast]);

  /** Page operations from sidebar context menu */
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
          case 'delete':
            await api.deletePage(sid, [op.pageNum]);
            break;
          case 'insert-after':
            await api.insertBlankPage(sid, op.pageNum);
            break;
        }
        // Refresh doc info
        const info = await api.getDocumentInfo(sid);
        setDocument({
          ...document,
          pageCount: info.page_count,
          currentVersion: info.current_version,
          updatedAt: info.updated_at,
        });
        addToast({ type: 'success', message: `Page ${op.type.replace('-', ' ')} done` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Operation failed';
        addToast({ type: 'error', message: msg });
      } finally {
        setLoading(false);
      }
    },
    [document, setLoading, setDocument, addToast],
  );

  /** Reorder pages from sidebar drag */
  const handleReorder = useCallback(
    async (newOrder: number[]) => {
      if (!document) return;
      try {
        setLoading(true);
        await api.reorderPages(document.sessionId, newOrder);
        const info = await api.getDocumentInfo(document.sessionId);
        setDocument({
          ...document,
          pageCount: info.page_count,
          currentVersion: info.current_version,
          updatedAt: info.updated_at,
        });
        addToast({ type: 'success', message: 'Pages reordered' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Reorder failed';
        addToast({ type: 'error', message: msg });
      } finally {
        setLoading(false);
      }
    },
    [document, setLoading, setDocument, addToast],
  );

  useKeyboardShortcuts({
    'Ctrl+O': handleKeyboardOpen,
    'Ctrl+S': handleSave,
    'Ctrl+Shift+S': handleSaveAs,
  });

  // No document loaded: show welcome screen
  if (!document) {
    return (
      <div className="app-layout">
        <header className="app-toolbar">
          <h1 className="app-title">Mudbrick</h1>
        </header>
        <div className="app-body">
          <main className="app-main">
            <WelcomeScreen onOpenFile={handleOpenFile} loading={loading} />
          </main>
        </div>
        <LoadingOverlay visible={loading} message="Opening document..." />
        <ToastContainer />
        <OfflineIndicator />
      </div>
    );
  }

  // Document loaded: show editor layout (viewer + sidebar placeholders)
  return (
    <div className="app-layout">
      <header className="app-toolbar">
        <h1 className="app-title">Mudbrick</h1>
        <span
          style={{
            marginLeft: '16px',
            fontSize: '13px',
            color: 'var(--mb-toolbar-text)',
            opacity: 0.8,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {document.fileName}
        </span>
        <div style={{ marginLeft: '16px' }}>
          <Toolbar />
        </div>
        {error && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '12px',
              color: 'var(--mb-danger)',
            }}
          >
            {error}
          </span>
        )}
      </header>
      <div className="app-body">
        {sidebarOpen && (
          <aside className="app-sidebar" style={{ padding: 0 }}>
            <ThumbnailSidebar
              sessionId={document.sessionId}
              onNavigate={handleNavigateToPage}
              onPageOperation={handlePageOperation}
              onReorder={handleReorder}
            />
          </aside>
        )}
        <main className="app-main" style={{ flexDirection: 'column', justifyContent: 'stretch' }}>
          <PdfViewer sessionId={document.sessionId} />
        </main>
        <PropertyPanel />
      </div>
      <LoadingOverlay visible={loading} message="Processing..." />
      <ToastContainer />
      <OfflineIndicator />
    </div>
  );
}
