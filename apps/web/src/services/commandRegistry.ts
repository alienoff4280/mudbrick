/**
 * Mudbrick v2 -- Command Registry
 *
 * Central registry for all shell commands.
 * Powers the menu bar, ribbon, keyboard shortcuts, and context menus.
 * Each command has an id, label, icon, shortcut, placement, and enablement rule.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandPlacement = 'menu' | 'ribbon' | 'context' | 'shortcut';

export type CommandCategory =
  | 'file'
  | 'edit'
  | 'view'
  | 'document'
  | 'annotate'
  | 'tools'
  | 'security'
  | 'export'
  | 'help';

export interface CommandDef {
  /** Unique command identifier */
  id: string;
  /** Human-readable label */
  label: string;
  /** Optional SVG path data for icon (24x24 viewBox) */
  icon?: string;
  /** Keyboard shortcut display string (e.g. "Ctrl+S") */
  shortcut?: string;
  /** Which surfaces this command appears on */
  placements: CommandPlacement[];
  /** Command category for grouping */
  category: CommandCategory;
  /** Ribbon tab this command belongs to (if any) */
  ribbonTab?: RibbonTabId;
  /** Ribbon group within the tab */
  ribbonGroup?: string;
  /** Whether the command requires an open document */
  requiresDocument: boolean;
  /** Whether the command is currently enabled -- evaluated dynamically */
  enabled?: boolean;
  /** Separator after this command in menus */
  separatorAfter?: boolean;
}

export type RibbonTabId = 'home' | 'edit' | 'annotate' | 'forms' | 'security' | 'tools';

// ---------------------------------------------------------------------------
// Icon paths (24x24 viewBox, stroke-based)
// ---------------------------------------------------------------------------

const ICONS = {
  open: 'M5 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h4a2 2 0 0 1 2 2v1M5 19h14a2 2 0 0 0 2-2l-3-9H2l3 9z',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
  saveAs: 'M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v4M7 3v5h8M7 13h4M15 18l2 2 4-4',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  undo: 'M3 10h10a5 5 0 0 1 0 10H3M3 10l4-4M3 10l4 4',
  redo: 'M21 10H11a5 5 0 0 0 0 10h10M21 10l-4-4M21 10l-4 4',
  cut: 'M6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8.12 8.12L12 12M15.88 8.12L12 12M12 12v8',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  paste: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M8 2h8v4H8z',
  delete: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  selectAll: 'M3 3h18v18H3zM8 12h8M12 8v8',
  find: 'M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
  zoomIn: 'M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM10 7v6M7 10h6',
  zoomOut: 'M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM7 10h6',
  fitWidth: 'M21 3H3v18h18V3zM6 12h12M6 12l3-3M6 12l3 3M18 12l-3-3M18 12l-3 3',
  fitPage: 'M3 3h18v18H3zM7 7h10v10H7z',
  leftPane: 'M3 3h6v18H3zM9 3h12v18H9z',
  rightPane: 'M3 3h12v18H3zM15 3h6v18h-6z',
  darkMode: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  rotate: 'M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15',
  merge: 'M8 6H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3M16 6h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3M12 6v12',
  split: 'M16 3h5v18h-5M3 3h5v18H3M12 3v18',
  compare: 'M12 3v18M3 3h18v18H3zM6 9h3M15 9h3M6 15h3M15 15h3',
  security: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  encrypt: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4',
  forms: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  ocr: 'M4 7V4h3M4 17v3h3M20 7V4h-3M20 17v3h-3M7 10h10M7 14h7',
  export: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  exportImage: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  flatten: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  optimize: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  annotationReport: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15h6M9 11h6',
  bates: 'M7 21h10M12 3v14M9 6l3-3 3 3',
  headers: 'M3 3h18v4H3zM3 17h18v4H3zM3 10h18',
  exhibits: 'M4 4h16v16H4zM4 9h16M9 4v16',
  pageLabels: 'M16 3H8v18h8V3zM11 8h2M11 12h2M11 16h2',
  select: 'M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z',
  draw: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
  highlight: 'M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  shape: 'M3 3h18v18H3zM12 3v18M3 12h18',
  stamp: 'M5 21h14M12 17V7M7 7h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2z',
  redact: 'M2 2l20 20M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61',
  redactionReview: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  textEdit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
  signatures: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  about: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 16v-4M12 8h.01',
  shortcuts: 'M18 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM8 7h2M8 11h4M8 15h6',
  close: 'M18 6L6 18M6 6l12 12',
} as const;

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

export const COMMANDS: CommandDef[] = [
  // -- File --
  { id: 'file.open', label: 'Open', icon: ICONS.open, shortcut: 'Ctrl+O', placements: ['menu', 'ribbon', 'shortcut'], category: 'file', ribbonTab: 'home', ribbonGroup: 'File', requiresDocument: false },
  { id: 'file.save', label: 'Save', icon: ICONS.save, shortcut: 'Ctrl+S', placements: ['menu', 'ribbon', 'shortcut'], category: 'file', ribbonTab: 'home', ribbonGroup: 'File', requiresDocument: true },
  { id: 'file.saveAs', label: 'Save As', icon: ICONS.saveAs, shortcut: 'Ctrl+Shift+S', placements: ['menu', 'ribbon', 'shortcut'], category: 'file', ribbonTab: 'home', ribbonGroup: 'File', requiresDocument: true },
  { id: 'file.print', label: 'Print', icon: ICONS.print, shortcut: 'Ctrl+P', placements: ['menu', 'ribbon', 'shortcut'], category: 'file', ribbonTab: 'home', ribbonGroup: 'File', requiresDocument: true, enabled: false },
  { id: 'file.close', label: 'Close Document', icon: ICONS.close, placements: ['menu'], category: 'file', requiresDocument: true, separatorAfter: true },
  { id: 'file.exit', label: 'Exit', placements: ['menu'], category: 'file', requiresDocument: false },

  // -- Edit --
  { id: 'edit.undo', label: 'Undo', icon: ICONS.undo, shortcut: 'Ctrl+Z', placements: ['menu', 'ribbon', 'shortcut'], category: 'edit', ribbonTab: 'home', ribbonGroup: 'History', requiresDocument: true },
  { id: 'edit.redo', label: 'Redo', icon: ICONS.redo, shortcut: 'Ctrl+Shift+Z', placements: ['menu', 'ribbon', 'shortcut'], category: 'edit', ribbonTab: 'home', ribbonGroup: 'History', requiresDocument: true },
  { id: 'edit.cut', label: 'Cut', icon: ICONS.cut, shortcut: 'Ctrl+X', placements: ['menu', 'shortcut'], category: 'edit', requiresDocument: true, separatorAfter: true },
  { id: 'edit.copy', label: 'Copy', icon: ICONS.copy, shortcut: 'Ctrl+C', placements: ['menu', 'shortcut'], category: 'edit', requiresDocument: true },
  { id: 'edit.paste', label: 'Paste', icon: ICONS.paste, shortcut: 'Ctrl+V', placements: ['menu', 'shortcut'], category: 'edit', requiresDocument: true },
  { id: 'edit.delete', label: 'Delete', icon: ICONS.delete, shortcut: 'Delete', placements: ['menu', 'shortcut'], category: 'edit', requiresDocument: true },
  { id: 'edit.selectAll', label: 'Select All', icon: ICONS.selectAll, shortcut: 'Ctrl+A', placements: ['menu', 'shortcut'], category: 'edit', requiresDocument: true, separatorAfter: true },
  { id: 'edit.find', label: 'Find', icon: ICONS.find, shortcut: 'Ctrl+F', placements: ['menu', 'ribbon', 'shortcut'], category: 'edit', ribbonTab: 'home', ribbonGroup: 'Find', requiresDocument: true },

  // -- View --
  { id: 'view.zoomIn', label: 'Zoom In', icon: ICONS.zoomIn, shortcut: 'Ctrl+=', placements: ['menu', 'shortcut'], category: 'view', requiresDocument: true },
  { id: 'view.zoomOut', label: 'Zoom Out', icon: ICONS.zoomOut, shortcut: 'Ctrl+-', placements: ['menu', 'shortcut'], category: 'view', requiresDocument: true },
  { id: 'view.actualSize', label: 'Actual Size', shortcut: 'Ctrl+0', placements: ['menu', 'shortcut'], category: 'view', requiresDocument: true },
  { id: 'view.fitWidth', label: 'Fit Width', icon: ICONS.fitWidth, placements: ['menu'], category: 'view', requiresDocument: true },
  { id: 'view.fitPage', label: 'Fit Page', icon: ICONS.fitPage, placements: ['menu'], category: 'view', requiresDocument: true, separatorAfter: true },
  { id: 'view.toggleLeftPane', label: 'Toggle Left Pane', icon: ICONS.leftPane, placements: ['menu', 'shortcut'], category: 'view', requiresDocument: true },
  { id: 'view.toggleRightPane', label: 'Toggle Right Pane', icon: ICONS.rightPane, placements: ['menu'], category: 'view', requiresDocument: true },
  { id: 'view.toggleDarkMode', label: 'Toggle Dark Mode', icon: ICONS.darkMode, placements: ['menu'], category: 'view', requiresDocument: false },

  // -- Annotate (ribbon tab) --
  { id: 'annotate.select', label: 'Select', icon: ICONS.select, shortcut: 'V', placements: ['ribbon', 'shortcut'], category: 'annotate', ribbonTab: 'annotate', ribbonGroup: 'Tools', requiresDocument: true },
  { id: 'annotate.draw', label: 'Draw', icon: ICONS.draw, shortcut: 'D', placements: ['ribbon', 'shortcut'], category: 'annotate', ribbonTab: 'annotate', ribbonGroup: 'Tools', requiresDocument: true },
  { id: 'annotate.highlight', label: 'Highlight', icon: ICONS.highlight, placements: ['ribbon'], category: 'annotate', ribbonTab: 'annotate', ribbonGroup: 'Tools', requiresDocument: true },
  { id: 'annotate.text', label: 'Text', icon: ICONS.text, shortcut: 'T', placements: ['ribbon', 'shortcut'], category: 'annotate', ribbonTab: 'annotate', ribbonGroup: 'Tools', requiresDocument: true },
  { id: 'annotate.shape', label: 'Shape', icon: ICONS.shape, placements: ['ribbon'], category: 'annotate', ribbonTab: 'annotate', ribbonGroup: 'Tools', requiresDocument: true },
  { id: 'annotate.stamp', label: 'Stamp', icon: ICONS.stamp, placements: ['ribbon'], category: 'annotate', ribbonTab: 'annotate', ribbonGroup: 'Tools', requiresDocument: true },
  { id: 'annotate.redact', label: 'Redact', icon: ICONS.redact, placements: ['ribbon'], category: 'annotate', ribbonTab: 'annotate', ribbonGroup: 'Markup', requiresDocument: true },
  { id: 'annotate.redactReview', label: 'Review Redactions', icon: ICONS.redactionReview, placements: ['ribbon'], category: 'annotate', ribbonTab: 'annotate', ribbonGroup: 'Markup', requiresDocument: true },

  // -- Document --
  { id: 'document.rotate', label: 'Rotate', icon: ICONS.rotate, placements: ['menu', 'ribbon', 'context'], category: 'document', ribbonTab: 'edit', ribbonGroup: 'Pages', requiresDocument: true },
  { id: 'document.deletePage', label: 'Delete Page', icon: ICONS.delete, placements: ['menu', 'ribbon', 'context'], category: 'document', ribbonTab: 'edit', ribbonGroup: 'Pages', requiresDocument: true },
  { id: 'document.merge', label: 'Merge Files', icon: ICONS.merge, placements: ['menu', 'ribbon'], category: 'document', ribbonTab: 'edit', ribbonGroup: 'Organize', requiresDocument: false },
  { id: 'document.split', label: 'Split Document', icon: ICONS.split, placements: ['menu', 'ribbon'], category: 'document', ribbonTab: 'edit', ribbonGroup: 'Organize', requiresDocument: true },
  { id: 'document.textEdit', label: 'Edit Text', icon: ICONS.textEdit, placements: ['ribbon'], category: 'document', ribbonTab: 'edit', ribbonGroup: 'Content', requiresDocument: true },

  // -- Tools (advanced) --
  { id: 'tools.compare', label: 'Compare', icon: ICONS.compare, placements: ['menu', 'ribbon'], category: 'tools', ribbonTab: 'tools', ribbonGroup: 'Analysis', requiresDocument: true },
  { id: 'tools.ocr', label: 'OCR', icon: ICONS.ocr, placements: ['menu', 'ribbon'], category: 'tools', ribbonTab: 'tools', ribbonGroup: 'Processing', requiresDocument: true },
  { id: 'tools.bates', label: 'Bates Numbering', icon: ICONS.bates, placements: ['menu', 'ribbon'], category: 'tools', ribbonTab: 'tools', ribbonGroup: 'Legal', requiresDocument: true },
  { id: 'tools.headers', label: 'Headers & Footers', icon: ICONS.headers, placements: ['menu', 'ribbon'], category: 'tools', ribbonTab: 'tools', ribbonGroup: 'Legal', requiresDocument: true },
  { id: 'tools.exhibits', label: 'Exhibit Stamps', icon: ICONS.exhibits, placements: ['menu', 'ribbon'], category: 'tools', ribbonTab: 'tools', ribbonGroup: 'Legal', requiresDocument: true },
  { id: 'tools.pageLabels', label: 'Page Labels', icon: ICONS.pageLabels, placements: ['menu', 'ribbon'], category: 'tools', ribbonTab: 'tools', ribbonGroup: 'Legal', requiresDocument: true },
  { id: 'tools.signatures', label: 'Signatures', icon: ICONS.signatures, placements: ['ribbon'], category: 'tools', ribbonTab: 'tools', ribbonGroup: 'Legal', requiresDocument: true },

  // -- Forms --
  { id: 'forms.detectFields', label: 'Detect Fields', icon: ICONS.forms, placements: ['ribbon'], category: 'tools', ribbonTab: 'forms', ribbonGroup: 'Fields', requiresDocument: true },
  { id: 'forms.editFields', label: 'Edit Fields', icon: ICONS.forms, placements: ['ribbon'], category: 'tools', ribbonTab: 'forms', ribbonGroup: 'Fields', requiresDocument: true },
  { id: 'forms.exportData', label: 'Export Data', icon: ICONS.export, placements: ['ribbon'], category: 'tools', ribbonTab: 'forms', ribbonGroup: 'Data', requiresDocument: true },
  { id: 'forms.importData', label: 'Import Data', icon: ICONS.open, placements: ['ribbon'], category: 'tools', ribbonTab: 'forms', ribbonGroup: 'Data', requiresDocument: true },
  { id: 'forms.flattenForm', label: 'Flatten Form', icon: ICONS.flatten, placements: ['ribbon'], category: 'tools', ribbonTab: 'forms', ribbonGroup: 'Data', requiresDocument: true },

  // -- Security --
  { id: 'security.encrypt', label: 'Encrypt', icon: ICONS.encrypt, placements: ['menu', 'ribbon'], category: 'security', ribbonTab: 'security', ribbonGroup: 'Protection', requiresDocument: true },
  { id: 'security.metadata', label: 'View Metadata', icon: ICONS.about, placements: ['ribbon'], category: 'security', ribbonTab: 'security', ribbonGroup: 'Inspect', requiresDocument: true },
  { id: 'security.sanitize', label: 'Sanitize', icon: ICONS.security, placements: ['ribbon'], category: 'security', ribbonTab: 'security', ribbonGroup: 'Inspect', requiresDocument: true },

  // -- Export --
  { id: 'export.pdf', label: 'Export PDF', icon: ICONS.export, placements: ['menu', 'ribbon'], category: 'export', ribbonTab: 'home', ribbonGroup: 'Output', requiresDocument: true },
  { id: 'export.images', label: 'Export Images', icon: ICONS.exportImage, placements: ['menu', 'ribbon'], category: 'export', ribbonTab: 'home', ribbonGroup: 'Output', requiresDocument: true },
  { id: 'export.flatten', label: 'Flatten Annotations', icon: ICONS.flatten, placements: ['menu', 'ribbon'], category: 'export', ribbonTab: 'home', ribbonGroup: 'Output', requiresDocument: true },
  { id: 'export.optimize', label: 'Optimize PDF', icon: ICONS.optimize, placements: ['ribbon'], category: 'export', ribbonTab: 'home', ribbonGroup: 'Output', requiresDocument: true },
  { id: 'export.annotationReport', label: 'Annotation Report', icon: ICONS.annotationReport, placements: ['menu', 'ribbon'], category: 'export', ribbonTab: 'home', ribbonGroup: 'Output', requiresDocument: true },

  // -- Help --
  { id: 'help.shortcuts', label: 'Keyboard Shortcuts', icon: ICONS.shortcuts, shortcut: '?', placements: ['menu'], category: 'help', requiresDocument: false },
  { id: 'help.about', label: 'About Mudbrick', icon: ICONS.about, placements: ['menu'], category: 'help', requiresDocument: false },
];

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

/** Command handler map -- populated at runtime by shell components */
const handlers = new Map<string, () => void | Promise<void>>();

/** Register a handler for a command */
export function registerHandler(commandId: string, handler: () => void | Promise<void>): void {
  handlers.set(commandId, handler);
}

/** Unregister a handler */
export function unregisterHandler(commandId: string): void {
  handlers.delete(commandId);
}

/** Execute a command by id */
export async function executeCommand(commandId: string): Promise<void> {
  const handler = handlers.get(commandId);
  if (handler) {
    await handler();
  } else {
    console.warn(`[CommandRegistry] No handler registered for command: ${commandId}`);
  }
}

/** Get a command definition by id */
export function getCommand(id: string): CommandDef | undefined {
  return COMMANDS.find((c) => c.id === id);
}

/** Get all commands for a given placement */
export function getCommandsByPlacement(placement: CommandPlacement): CommandDef[] {
  return COMMANDS.filter((c) => c.placements.includes(placement));
}

/** Get all commands for a given menu category */
export function getMenuCommands(category: CommandCategory): CommandDef[] {
  return COMMANDS.filter((c) => c.category === category && c.placements.includes('menu'));
}

/** Get all commands for a ribbon tab, grouped by ribbonGroup */
export function getRibbonCommands(tab: RibbonTabId): Map<string, CommandDef[]> {
  const groups = new Map<string, CommandDef[]>();
  for (const cmd of COMMANDS) {
    if (cmd.ribbonTab === tab && cmd.placements.includes('ribbon')) {
      const group = cmd.ribbonGroup ?? 'Other';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(cmd);
    }
  }
  return groups;
}

/** Get all commands with keyboard shortcuts */
export function getShortcutCommands(): CommandDef[] {
  return COMMANDS.filter((c) => c.shortcut && c.placements.includes('shortcut'));
}

/** Ribbon tab definitions (in display order) */
export const RIBBON_TABS: { id: RibbonTabId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'edit', label: 'Edit' },
  { id: 'annotate', label: 'Annotate' },
  { id: 'forms', label: 'Forms' },
  { id: 'security', label: 'Security' },
  { id: 'tools', label: 'Tools' },
];
