/**
 * Mudbrick v2 -- IndexedDB Service
 *
 * Provides crash recovery by auto-saving annotation state to IndexedDB.
 */

const DB_NAME = 'mudbrick-v2';
const DB_VERSION = 1;
const STORE_NAME = 'annotations';

interface SavedAnnotationState {
  sessionId: string;
  pageAnnotations: Record<number, unknown>;
  savedAt: string;
}

class IndexedDbService {
  private db: IDBDatabase | null = null;

  /**
   * Open (or create) the IndexedDB database.
   */
  async open(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save annotation state for crash recovery.
   */
  async saveAnnotations(
    sessionId: string,
    pageAnnotations: Record<number, unknown>,
  ): Promise<void> {
    await this.open();
    if (!this.db) return;

    const data: SavedAnnotationState = {
      sessionId,
      pageAnnotations,
      savedAt: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(data);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Load saved annotation state for a session.
   */
  async loadAnnotations(
    sessionId: string,
  ): Promise<SavedAnnotationState | null> {
    await this.open();
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(sessionId);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete saved annotation state for a session.
   */
  async deleteAnnotations(sessionId: string): Promise<void> {
    await this.open();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(sessionId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Check if recovery data exists for a session.
   */
  async hasRecoveryData(sessionId: string): Promise<boolean> {
    const data = await this.loadAnnotations(sessionId);
    return data !== null;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

/** Singleton IndexedDB service */
export const indexedDbService = new IndexedDbService();
