/**
 * Mudbrick v2 -- UI Store (Zustand)
 *
 * Manages UI state: shell regions, panes, modals, theme, toasts, ribbon.
 */

import { create } from 'zustand';
import type { RibbonTabId } from '../services/commandRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LeftPaneMode = 'pages' | 'outline' | 'search' | 'attachments';
export type RightPaneMode = 'properties' | 'redaction' | 'security' | 'compare' | 'forms' | 'ocr' | null;

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

export interface StatusItem {
  id: string;
  label: string;
  value?: string;
}

interface UIState {
  // -- Left pane --
  leftPaneOpen: boolean;
  leftPaneMode: LeftPaneMode;

  // -- Right pane --
  rightPaneOpen: boolean;
  rightPaneMode: RightPaneMode;

  // -- Ribbon --
  ribbonTab: RibbonTabId;
  ribbonCollapsed: boolean;

  // -- Legacy compat (read by existing components) --
  /** @deprecated use leftPaneOpen */
  sidebarOpen: boolean;
  /** @deprecated use leftPaneMode */
  sidebarTab: 'pages' | 'outline' | 'attachments';
  /** @deprecated use rightPaneOpen */
  panelOpen: boolean;
  /** @deprecated use rightPaneMode */
  activePanel: string | null;

  // -- Modals --
  activeModal: string | null;

  // -- Theme --
  theme: 'light' | 'dark';

  // -- Toasts --
  toasts: ToastMessage[];

  // -- Status bar --
  statusItems: StatusItem[];

  // -- Command overflow --
  commandOverflowOpen: boolean;

  // -- Fullscreen --
  fullscreen: boolean;

  // -- Menu state --
  menuOpen: string | null;

  // -- Actions: left pane --
  setLeftPaneOpen: (open: boolean) => void;
  toggleLeftPane: () => void;
  setLeftPaneMode: (mode: LeftPaneMode) => void;

  // -- Actions: right pane --
  setRightPaneOpen: (open: boolean) => void;
  toggleRightPane: () => void;
  setRightPaneMode: (mode: RightPaneMode) => void;
  openRightPane: (mode: RightPaneMode) => void;
  closeRightPane: () => void;

  // -- Actions: ribbon --
  setRibbonTab: (tab: RibbonTabId) => void;
  toggleRibbonCollapsed: () => void;
  setRibbonCollapsed: (collapsed: boolean) => void;

  // -- Actions: legacy compat --
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarTab: (tab: 'pages' | 'outline' | 'attachments') => void;
  togglePanel: (panel?: string) => void;
  setPanelOpen: (open: boolean, panel?: string) => void;

  // -- Actions: modals --
  openModal: (modal: string) => void;
  closeModal: () => void;

  // -- Actions: theme --
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;

  // -- Actions: toasts --
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;

  // -- Actions: status --
  setStatusItems: (items: StatusItem[]) => void;
  updateStatusItem: (id: string, update: Partial<StatusItem>) => void;

  // -- Actions: overflow --
  setCommandOverflowOpen: (open: boolean) => void;

  // -- Actions: menu --
  setMenuOpen: (menu: string | null) => void;

  // -- Actions: fullscreen --
  setFullscreen: (fs: boolean) => void;

  // -- Reset --
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

let toastIdCounter = 0;

const initialState = {
  // Left pane
  leftPaneOpen: true,
  leftPaneMode: 'pages' as LeftPaneMode,

  // Right pane
  rightPaneOpen: false,
  rightPaneMode: null as RightPaneMode,

  // Ribbon
  ribbonTab: 'home' as RibbonTabId,
  ribbonCollapsed: false,

  // Legacy compat
  sidebarOpen: true,
  sidebarTab: 'pages' as const,
  panelOpen: false,
  activePanel: null as string | null,

  // Modals
  activeModal: null as string | null,

  // Theme
  theme: 'light' as const,

  // Toasts
  toasts: [] as ToastMessage[],

  // Status
  statusItems: [] as StatusItem[],

  // Overflow
  commandOverflowOpen: false,

  // Fullscreen
  fullscreen: false,

  // Menu
  menuOpen: null as string | null,
};

export const useUIStore = create<UIState>((set) => ({
  ...initialState,

  // -- Left pane --
  setLeftPaneOpen: (open) => set({ leftPaneOpen: open, sidebarOpen: open }),
  toggleLeftPane: () => set((s) => ({ leftPaneOpen: !s.leftPaneOpen, sidebarOpen: !s.leftPaneOpen })),
  setLeftPaneMode: (mode) => {
    const sidebarTab = mode === 'search' ? 'pages' : (mode as 'pages' | 'outline' | 'attachments');
    return set({ leftPaneMode: mode, leftPaneOpen: true, sidebarTab, sidebarOpen: true });
  },

  // -- Right pane --
  setRightPaneOpen: (open) => set({ rightPaneOpen: open, panelOpen: open }),
  toggleRightPane: () => set((s) => ({ rightPaneOpen: !s.rightPaneOpen, panelOpen: !s.rightPaneOpen })),
  setRightPaneMode: (mode) => set({ rightPaneMode: mode, activePanel: mode }),
  openRightPane: (mode) => set({ rightPaneOpen: true, rightPaneMode: mode, panelOpen: true, activePanel: mode }),
  closeRightPane: () => set({ rightPaneOpen: false, rightPaneMode: null, panelOpen: false, activePanel: null }),

  // -- Ribbon --
  setRibbonTab: (tab) => set({ ribbonTab: tab, ribbonCollapsed: false }),
  toggleRibbonCollapsed: () => set((s) => ({ ribbonCollapsed: !s.ribbonCollapsed })),
  setRibbonCollapsed: (collapsed) => set({ ribbonCollapsed: collapsed }),

  // -- Legacy compat --
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen, leftPaneOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open, leftPaneOpen: open }),
  setSidebarTab: (tab) => set({ sidebarTab: tab, leftPaneMode: tab }),

  togglePanel: (panel) =>
    set((s) => {
      if (s.panelOpen && s.activePanel === panel) {
        return { panelOpen: false, activePanel: null, rightPaneOpen: false, rightPaneMode: null };
      }
      return { panelOpen: true, activePanel: panel ?? null, rightPaneOpen: true, rightPaneMode: (panel as RightPaneMode) ?? null };
    }),

  setPanelOpen: (open, panel) =>
    set({
      panelOpen: open,
      activePanel: open ? panel ?? null : null,
      rightPaneOpen: open,
      rightPaneMode: open ? (panel as RightPaneMode) ?? null : null,
    }),

  // -- Modals --
  openModal: (modal) => set({ activeModal: modal }),
  closeModal: () => set({ activeModal: null }),

  // -- Theme --
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),

  // -- Toasts --
  addToast: (toast) =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        { ...toast, id: `toast-${++toastIdCounter}` },
      ],
    })),
  removeToast: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),

  // -- Status --
  setStatusItems: (items) => set({ statusItems: items }),
  updateStatusItem: (id, update) =>
    set((s) => ({
      statusItems: s.statusItems.map((item) =>
        item.id === id ? { ...item, ...update } : item,
      ),
    })),

  // -- Overflow --
  setCommandOverflowOpen: (open) => set({ commandOverflowOpen: open }),

  // -- Menu --
  setMenuOpen: (menu) => set({ menuOpen: menu }),

  // -- Fullscreen --
  setFullscreen: (fs) => set({ fullscreen: fs }),

  // -- Reset --
  reset: () => set(initialState),
}));
