/**
 * Mudbrick v2 -- HomeShell
 *
 * No-document landing shell. Shows the open/drop zone and recent files.
 * Replaces the v1 welcome screen layout in App.tsx.
 */

import { WelcomeScreen } from '../welcome/WelcomeScreen';
import { RecentFilesPanel } from '../recent/RecentFilesPanel';
import styles from './HomeShell.module.css';

interface HomeShellProps {
  onOpenFile: (filePath: string) => void;
  onCreateFromImages: (filePaths: string[]) => void;
  onMergeFiles: () => void;
  loading: boolean;
}

export function HomeShell({
  onOpenFile,
  onCreateFromImages,
  onMergeFiles,
  loading,
}: HomeShellProps) {
  return (
    <div className={styles.home}>
      <header className={styles.homeHeader}>
        <h1 className={styles.brand}>Mudbrick</h1>
      </header>
      <div className={styles.homeBody}>
        <main id="main-content" className={styles.homeMain}>
          <WelcomeScreen
            onOpenFile={onOpenFile}
            onCreateFromImages={onCreateFromImages}
            onMergeFiles={onMergeFiles}
            loading={loading}
          />
        </main>
        <aside className={styles.homeRecent}>
          <RecentFilesPanel onOpenFile={onOpenFile} />
        </aside>
      </div>
    </div>
  );
}
