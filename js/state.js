/**
 * Mudbrick — Application State
 * Singleton mutable state object shared across all modules.
 */

const State = {
  pdfDoc: null,
  pdfBytes: null,
  fileName: '',
  fileSize: 0,
  currentPage: 1,
  totalPages: 0,
  zoom: 1.0,
  pageAnnotations: {},
  activeTool: 'select',
  sidebarOpen: true,
  panelOpen: false,
  formFields: [],
  pdfLibDoc: null,
  _viewport: null,
  integration: null,
};

export default State;
