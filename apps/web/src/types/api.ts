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

export interface OptimizeResponse {
  success: boolean;
  optimized: boolean;
  page_count: number;
  original_size: number;
  optimized_size: number;
  bytes_saved: number;
  new_version: number | null;
}

export interface ExportResponse {
  success: boolean;
  file_path: string;
}

export interface ImageExportRequest {
  output_dir: string;
  format?: 'png' | 'jpg' | 'jpeg';
  dpi?: number;
  pages?: number[];
}

export interface ImageExportResponse {
  success: boolean;
  output_dir: string;
  format: string;
  exported_count: number;
  file_paths: string[];
}

export interface FlattenAnnotationsResponse {
  success: boolean;
  page_count: number;
  new_version: number;
}

export interface AttachmentInfo {
  name: string;
  file_name: string;
  description: string;
  size: number;
  creation_date: string;
  mod_date: string;
}

export interface AttachmentListResponse {
  attachments: AttachmentInfo[];
  total: number;
}

export interface AttachmentAddResponse {
  success: boolean;
  attachments_added: number;
  attachment_names: string[];
  total_attachments: number;
}

export interface AttachmentExportResponse {
  success: boolean;
  file_path: string;
}

export interface AttachmentDeleteResponse {
  success: boolean;
  total_attachments: number;
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

// ── Phase 3: Exhibit Types ──

export interface ExhibitStampRequest {
  format?: string;
  start_num?: number;
  position?: string;
  font?: string;
  font_size?: number;
  color?: string;
  bg_color?: string;
  margin?: number;
  pages?: number[];
}

export interface ExhibitStampResponse {
  success: boolean;
  labels: string[];
  page_count: number;
}

export interface PageLabelEntry {
  page: number;
  label: string;
}

export interface PageLabelsRequest {
  labels: PageLabelEntry[];
}

export interface PageLabelsResponse {
  success: boolean;
  page_count: number;
}

export interface PageLabelsGetResponse {
  labels: Record<number, string>;
  page_count: number;
}

// ── Phase 3: Form Types ──

export interface FormField {
  name: string;
  type: string;
  page: number;
  rect: number[];
  value: unknown;
  options: string[];
  flags: number;
  read_only: boolean;
}

export interface FormFieldsResponse {
  fields: FormField[];
  total: number;
  has_xfa: boolean;
}

export interface FormFillRequest {
  fields: Record<string, unknown>;
}

export interface FormFillResponse {
  success: boolean;
  fields_updated: number;
  page_count: number;
}

export interface FormFlattenResponse {
  success: boolean;
  page_count: number;
}

export interface FormExportResponse {
  success: boolean;
  format: string;
  data: Record<string, unknown>;
}

export interface FormImportRequest {
  format: string;
  data: Record<string, unknown>;
}

export interface FormImportResponse {
  success: boolean;
  fields_updated: number;
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

// ── Phase 4: Document Comparison Types ──

export interface PageChangeItem {
  page: number;
  type: 'added' | 'deleted' | 'modified' | 'unchanged';
  diff_score: number;
}

export interface ComparisonSummary {
  added: number;
  deleted: number;
  modified: number;
  unchanged: number;
}

export interface CompareResponse {
  changes: PageChangeItem[];
  summary: ComparisonSummary;
}

// ── Phase 4: Security / Encryption Types ──

export interface EncryptRequest {
  user_password: string;
  owner_password: string;
  allow_print: boolean;
  allow_copy: boolean;
  allow_modify: boolean;
  allow_annotate: boolean;
}

export interface EncryptResponse {
  success: boolean;
  encrypted: boolean;
  permissions: Record<string, boolean>;
}

export interface MetadataResponse {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  creation_date: string;
  mod_date: string;
}

export interface MetadataUpdateRequest {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
}

export interface MetadataUpdateResponse {
  success: boolean;
  updated_fields: string[];
}

export interface SanitizeResponse {
  success: boolean;
  removed: string[];
}
