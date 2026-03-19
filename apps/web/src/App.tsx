/**
 * Mudbrick v2 -- App Root Component
 *
 * Routes between WelcomeScreen (no document) and the main editor view.
 * Manages document open flow via the API client + document store.
 */

import { useCallback } from 'react';
import { WelcomeScreen } from './components/welcome/WelcomeScreen';
import { LoadingOverlay } from './components/welcome/LoadingOverlay';
import { ToastContainer } from './components/shared/Toast';
import { OfflineIndicator } from './components/shared/OfflineIndicator';
import { useDocumentStore } from './stores/documentStore';
import { useSessionStore } from './stores/sessionStore';
import { useUIStore } from './stores/uiStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useDarkMode } from './hooks/useDarkMode';
import { useTauri } from './hooks/useTauri';
import { api } from './services/api';

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

  const { openFile } = useTauri();

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

  useKeyboardShortcuts({
    'Ctrl+O': handleKeyboardOpen,
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
          <aside className="app-sidebar">
            <p style={{ fontSize: '12px', color: 'var(--mb-text-secondary)' }}>
              {document.pageCount} pages
            </p>
            {/* ThumbnailSidebar will be mounted here by C5 */}
          </aside>
        )}
        <main className="app-main">
          <p style={{ color: 'var(--mb-text-inverse)' }}>
            {document.fileName} ({document.pageCount} pages)
          </p>
          {/* PdfViewer will be mounted here by C4 */}
        </main>
      </div>
      <LoadingOverlay visible={loading} message="Processing..." />
      <ToastContainer />
      <OfflineIndicator />
    </div>
  );
}
