/**
 * Mudbrick v2 -- Typed API Client
 *
 * Handles all API communication including chunked uploads.
 */

import { API_BASE, CHUNK_SIZE_BYTES, CHUNKED_UPLOAD_THRESHOLD_BYTES } from '@mudbrick/shared/src/constants';
import type {
  SessionCreateResponse,
  SessionInfoResponse,
  UndoRedoResponse,
  HealthResponse,
  ExportResponse,
  PageOperationResponse,
  MergeResponse,
} from '../types/api';
import type { PageAnnotations } from '../types/annotation';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  // ── Helpers ──

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new ApiError(response.status, error.detail || 'Unknown error');
    }

    return response.json();
  }

  private async requestBlob(path: string): Promise<Blob> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new ApiError(response.status, error.detail || 'Unknown error');
    }
    return response.blob();
  }

  // ── Health ──

  async health(): Promise<HealthResponse> {
    return this.request('/health');
  }

  // ── Document Upload ──

  async uploadDocument(
    file: File,
    onProgress?: (progress: number) => void,
  ): Promise<SessionCreateResponse> {
    if (file.size > CHUNKED_UPLOAD_THRESHOLD_BYTES) {
      return this.uploadChunked(file, onProgress);
    }
    return this.uploadSingle(file, onProgress);
  }

  private async uploadSingle(
    file: File,
    onProgress?: (progress: number) => void,
  ): Promise<SessionCreateResponse> {
    const formData = new FormData();
    formData.append('file', file);

    // Use XMLHttpRequest for progress tracking
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.baseUrl}/documents/upload`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new ApiError(xhr.status, err.detail));
          } catch {
            reject(new ApiError(xhr.status, xhr.statusText));
          }
        }
      };

      xhr.onerror = () => reject(new ApiError(0, 'Network error'));
      xhr.send(formData);
    });
  }

  private async uploadChunked(
    file: File,
    onProgress?: (progress: number) => void,
  ): Promise<SessionCreateResponse> {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE_BYTES);
    const sessionId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE_BYTES;
      const end = Math.min(start + CHUNK_SIZE_BYTES, file.size);
      const chunk = file.slice(start, end);

      const formData = new FormData();
      formData.append('chunk', chunk, `chunk_${i}`);
      formData.append('session_id', sessionId);
      formData.append('chunk_index', String(i));

      await this.request('/documents/upload/chunk', {
        method: 'POST',
        body: formData,
      });

      if (onProgress) {
        onProgress(Math.round(((i + 1) / totalChunks) * 100));
      }
    }

    // Complete the upload
    return this.request('/documents/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        chunk_count: totalChunks,
        file_name: file.name,
      }),
    });
  }

  // ── Document Operations ──

  async getDocumentInfo(sessionId: string): Promise<SessionInfoResponse> {
    return this.request(`/documents/${sessionId}`);
  }

  async downloadDocument(sessionId: string): Promise<Blob> {
    return this.requestBlob(`/documents/${sessionId}/download`);
  }

  async deleteDocument(sessionId: string): Promise<{ deleted: boolean }> {
    return this.request(`/documents/${sessionId}`, { method: 'DELETE' });
  }

  async undo(sessionId: string): Promise<UndoRedoResponse> {
    return this.request(`/documents/${sessionId}/undo`, { method: 'POST' });
  }

  async redo(sessionId: string): Promise<UndoRedoResponse> {
    return this.request(`/documents/${sessionId}/redo`, { method: 'POST' });
  }

  // ── Page Operations ──

  async rotatePage(
    sessionId: string,
    pages: number[],
    degrees: number,
  ): Promise<PageOperationResponse> {
    return this.request(`/pages/${sessionId}/rotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages, degrees }),
    });
  }

  async deletePage(
    sessionId: string,
    pages: number[],
  ): Promise<PageOperationResponse> {
    return this.request(`/pages/${sessionId}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages }),
    });
  }

  async reorderPages(
    sessionId: string,
    order: number[],
  ): Promise<PageOperationResponse> {
    return this.request(`/pages/${sessionId}/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    });
  }

  async getThumbnail(sessionId: string, page: number, width = 200): Promise<string> {
    const blob = await this.requestBlob(
      `/pages/${sessionId}/${page}/thumbnail?width=${width}`,
    );
    return URL.createObjectURL(blob);
  }

  // ── Merge ──

  async mergeDocuments(files: File[]): Promise<MergeResponse> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    return this.request('/merge', {
      method: 'POST',
      body: formData,
    });
  }

  // ── Export ──

  async exportDocument(
    sessionId: string,
    annotations: Record<number, PageAnnotations>,
    options: Record<string, unknown> = {},
  ): Promise<ExportResponse> {
    return this.request(`/export/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annotations, options }),
    });
  }
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Singleton API client */
export const api = new ApiClient();
