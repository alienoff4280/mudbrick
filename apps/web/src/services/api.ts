/**
 * Mudbrick v2 -- Typed API Client (Desktop / Local Sidecar)
 *
 * All operations use local file paths -- no HTTP upload.
 * Backend runs on localhost:8000 as a Tauri sidecar.
 */

import { API_BASE } from '@mudbrick/shared/src/constants';
import type {
  SessionCreateResponse,
  SessionInfoResponse,
  UndoRedoResponse,
  HealthResponse,
  ExportResponse,
  PageOperationResponse,
  MergeResponse,
  SaveResponse,
  BatesRequest,
  BatesResponse,
  HeaderFooterRequest,
  HeaderFooterResponse,
  RedactionPattern,
  RedactionSearchResponse,
  RedactionRegion,
  RedactionResult,
  OcrResults,
  TextExtractResponse,
  TextSearchResponse,
  TextEditItem,
  TextEditResponse,
  SplitResponse,
} from '../types/api';
import type { PageAnnotations } from '../types/annotation';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  // -- Helpers --

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

  // -- Health --

  async health(): Promise<HealthResponse> {
    return this.request('/health');
  }

  // -- Document Operations (file-path based, no upload) --

  /**
   * Open a PDF file by local filesystem path.
   * Backend reads the file directly from disk.
   */
  async openFile(filePath: string): Promise<SessionCreateResponse> {
    return this.request('/documents/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath }),
    });
  }

  async getDocumentInfo(sessionId: string): Promise<SessionInfoResponse> {
    return this.request(`/documents/${sessionId}`);
  }

  /**
   * Save the current document back to its original file path (Ctrl+S).
   */
  async save(sessionId: string): Promise<SaveResponse> {
    return this.request(`/documents/${sessionId}/save`, { method: 'POST' });
  }

  /**
   * Save the current document to a new file path (Ctrl+Shift+S).
   */
  async saveAs(sessionId: string, filePath: string): Promise<SaveResponse> {
    return this.request(`/documents/${sessionId}/save-as`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath }),
    });
  }

  async closeDocument(sessionId: string): Promise<{ success: boolean }> {
    return this.request(`/documents/${sessionId}/close`, { method: 'POST' });
  }

  async undo(sessionId: string): Promise<UndoRedoResponse> {
    return this.request(`/documents/${sessionId}/undo`, { method: 'POST' });
  }

  async redo(sessionId: string): Promise<UndoRedoResponse> {
    return this.request(`/documents/${sessionId}/redo`, { method: 'POST' });
  }

  // -- Page Operations --

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

  async insertBlankPage(
    sessionId: string,
    after: number,
    size = 'letter',
  ): Promise<PageOperationResponse> {
    return this.request(`/pages/${sessionId}/insert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ after, size }),
    });
  }

  async getThumbnail(sessionId: string, page: number, width = 200): Promise<string> {
    const blob = await this.requestBlob(
      `/pages/${sessionId}/${page}/thumbnail?width=${width}`,
    );
    return URL.createObjectURL(blob);
  }

  // -- Merge (file-path based, no upload) --

  /**
   * Merge multiple local PDF files by path.
   */
  async mergeFiles(filePaths: string[]): Promise<MergeResponse> {
    return this.request('/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_paths: filePaths }),
    });
  }

  // -- Export --

  /**
   * Export document with annotations flattened.
   * outputPath is a local filesystem path chosen via Tauri save dialog.
   */
  async exportDocument(
    sessionId: string,
    annotations: Record<number, PageAnnotations>,
    outputPath: string,
    options: Record<string, unknown> = {},
  ): Promise<ExportResponse> {
    return this.request(`/export/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        annotations,
        output_path: outputPath,
        options,
      }),
    });
  }

  // -- Phase 3: Legal Document Features --

  async applyBatesNumbers(
    sessionId: string,
    options: BatesRequest,
  ): Promise<BatesResponse> {
    return this.request(`/bates/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
  }

  async applyHeadersFooters(
    sessionId: string,
    options: HeaderFooterRequest,
  ): Promise<HeaderFooterResponse> {
    return this.request(`/headers/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
  }

  // -- Phase 2: Redaction --

  /**
   * Get available redaction patterns.
   */
  async getRedactionPatterns(): Promise<RedactionPattern[]> {
    return this.request('/redaction/patterns');
  }

  /**
   * Search for sensitive data patterns in the document.
   */
  async searchRedactionPatterns(
    sessionId: string,
    patterns: string[],
    customRegex?: string,
    pages?: number[],
  ): Promise<RedactionSearchResponse> {
    return this.request(`/redaction/${sessionId}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patterns,
        custom_regex: customRegex,
        pages: pages ?? undefined,
      }),
    });
  }

  /**
   * Apply forensic redaction to specified regions.
   */
  async applyRedaction(
    sessionId: string,
    regions: RedactionRegion[],
  ): Promise<RedactionResult> {
    return this.request(`/redaction/${sessionId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regions }),
    });
  }

  // -- Phase 2: OCR --

  /**
   * Start OCR processing. Returns an EventSource for SSE streaming.
   */
  startOcr(
    sessionId: string,
    options: { pages?: number[]; language?: string; dpi?: number } = {},
  ): EventSource {
    const params = new URLSearchParams();
    // OCR uses POST with SSE, but EventSource only supports GET.
    // So we POST to start and use a separate SSE endpoint.
    // Actually, we'll POST via fetch and read the stream.
    // For simplicity, use the createEventSource helper with query params.
    return this.createEventSource(`/ocr/${sessionId}`);
  }

  /**
   * Start OCR with POST request and return the response for SSE streaming.
   */
  async startOcrStream(
    sessionId: string,
    options: { pages?: number[]; language?: string; dpi?: number } = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}/ocr/${sessionId}`;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
  }

  /**
   * Get cached OCR results.
   */
  async getOcrResults(sessionId: string): Promise<OcrResults> {
    return this.request(`/ocr/${sessionId}/results`);
  }

  // -- Phase 2: Text & Search --

  /**
   * Extract text from PDF pages with position information.
   */
  async extractText(sessionId: string, pages?: string): Promise<TextExtractResponse> {
    const query = pages ? `?pages=${encodeURIComponent(pages)}` : '';
    return this.request(`/text/${sessionId}/extract${query}`);
  }

  /**
   * Search for text across all pages.
   */
  async searchText(sessionId: string, query: string): Promise<TextSearchResponse> {
    return this.request(`/text/${sessionId}/search?q=${encodeURIComponent(query)}`);
  }

  /**
   * Edit text on a specific page (cover-and-replace).
   */
  async editText(
    sessionId: string,
    page: number,
    edits: TextEditItem[],
  ): Promise<TextEditResponse> {
    return this.request(`/text/${sessionId}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page, edits }),
    });
  }

  // -- Phase 2: Split --

  /**
   * Split PDF into multiple files by page ranges.
   */
  async splitPdf(
    sessionId: string,
    ranges: string[],
    outputDir: string,
    filenamePrefix?: string,
  ): Promise<SplitResponse> {
    return this.request(`/split/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ranges,
        output_dir: outputDir,
        filename_prefix: filenamePrefix ?? undefined,
      }),
    });
  }

  // -- SSE Streaming (for OCR, long operations) --

  /**
   * Create an EventSource for SSE streaming endpoints.
   */
  createEventSource(path: string): EventSource {
    return new EventSource(`${this.baseUrl}${path}`);
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
