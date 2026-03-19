/**
 * Mudbrick v2 -- API TypeScript types (Desktop)
 *
 * Request and response types for all API endpoints.
 */

export interface HealthResponse {
  status: string;
  version: string;
}

export interface SessionCreateResponse {
  session_id: string;
  page_count: number;
  file_size: number;
}

export interface SessionInfoResponse {
  session_id: string;
  file_path: string;
  file_name: string;
  file_size: number;
  page_count: number;
  current_version: number;
  versions: VersionInfoResponse[];
  created_at: string;
  updated_at: string;
}

export interface VersionInfoResponse {
  version: number;
  operation: string;
  timestamp: string;
  is_current: boolean;
}

export interface UndoRedoResponse {
  version: number;
  page_count: number;
  operation: string;
}

export interface PageOperationResponse {
  success: boolean;
  page_count: number;
}

export interface MergeResponse {
  session_id: string;
  page_count: number;
}

export interface SaveResponse {
  success: boolean;
  file_path: string;
}

export interface ExportResponse {
  success: boolean;
  file_path: string;
}

export interface BatesRequest {
  prefix?: string;
  suffix?: string;
  start_num?: number;
  zero_pad?: number;
  position?: string;
  font?: string;
  font_size?: number;
  color?: string;
  start_page?: number;
  end_page?: number;
  margin?: number;
}

export interface BatesResponse {
  success: boolean;
  first_label: string;
  last_label: string;
  page_count: number;
}

export interface HeaderFooterRequest {
  top_left?: string;
  top_center?: string;
  top_right?: string;
  bottom_left?: string;
  bottom_center?: string;
  bottom_right?: string;
  font?: string;
  font_size?: number;
  color?: string;
  margin?: number;
  filename?: string;
  start_page?: number;
  end_page?: number;
  skip_first?: boolean;
  skip_last?: boolean;
  mirror?: boolean;
  draw_line?: boolean;
}

export interface HeaderFooterResponse {
  success: boolean;
  page_count: number;
}

export interface ApiErrorResponse {
  detail: string;
}

/** Generic API response wrapper for hooks */
export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// ── Phase 2: Redaction Types ──

export interface RedactionPattern {
  name: string;
  label: string;
  description: string;
}

export interface RedactionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RedactionMatch {
  id: string;
  page: number;
  pattern: string;
  text: string;
  rects: RedactionRect[];
}

export interface RedactionSearchResponse {
  matches: RedactionMatch[];
  total: number;
  pages_searched: number;
}

export interface RedactionRegion {
  page: number;
  rects: RedactionRect[];
}

export interface RedactionResult {
  success: boolean;
  pages_redacted: number;
  regions_redacted: number;
  new_version: number;
}

// ── Phase 2: OCR Types ──

export interface OcrWord {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  block_num: number;
  line_num: number;
  word_num: number;
}

export interface OcrPageResult {
  page: number;
  words: OcrWord[];
  word_count: number;
  avg_confidence: number;
  language: string;
}

export interface OcrResults {
  pages: OcrPageResult[];
  total_words: number;
  avg_confidence: number;
  language: string;
}

/** SSE event data for OCR page completion */
export interface OcrPageCompleteEvent {
  page: number;
  total: number;
  words: number;
  confidence: number;
}

/** SSE event data for OCR completion */
export interface OcrDoneEvent {
  status: string;
  total_words: number;
  avg_confidence: number;
  pages_processed: number;
}

// ── Phase 2: Text & Search Types ──

export interface TextBlock {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font: string;
  size: number;
  color: string;
}

export interface PageText {
  page: number;
  text: string;
  blocks: TextBlock[];
}

export interface TextExtractResponse {
  pages: PageText[];
  total_pages: number;
}

export interface SearchMatch {
  page: number;
  text: string;
  rects: RedactionRect[];
  context: string;
}

export interface TextSearchResponse {
  query: string;
  matches: SearchMatch[];
  total: number;
}

export interface TextEditItem {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  font?: string;
  size?: number;
  color?: string;
  bg_color?: string;
}

export interface TextEditResponse {
  success: boolean;
  edits_applied: number;
  new_version: number;
}

// ── Phase 2: Split Types ──

export interface SplitPart {
  file_path: string;
  pages: string;
  page_count: number;
  file_size: number;
}

export interface SplitResponse {
  success: boolean;
  parts: SplitPart[];
  total_parts: number;
}
