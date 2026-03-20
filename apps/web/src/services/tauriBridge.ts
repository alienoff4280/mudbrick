/**
 * Mudbrick v2 -- Tauri Bridge Service
 *
 * Wraps Tauri API calls for file dialogs, app data paths, window controls.
 * Falls back gracefully when not running inside Tauri (e.g., browser dev mode).
 */

export interface AppUpdateStatus {
  configured: boolean;
  endpoint: string | null;
  currentVersion: string;
  updateAvailable: boolean;
  latestVersion: string | null;
}

export interface DialogFilter {
  name: string;
  extensions: string[];
}

const PDF_DIALOG_FILTERS: DialogFilter[] = [
  {
    name: 'PDF Documents',
    extensions: ['pdf'],
  },
  {
    name: 'All Files',
    extensions: ['*'],
  },
];

/** Check if running inside a Tauri WebView */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/**
 * Open a file dialog to select one or more PDF files.
 * Returns an array of local file paths.
 */
export async function openFileDialog(
  multiple = false,
  filters: DialogFilter[] = PDF_DIALOG_FILTERS,
): Promise<string[]> {
  if (!isTauri()) {
    // Browser fallback: use standard file input
    return browserFileDialog(multiple, filters);
  }

  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    multiple,
    filters,
  });

  if (!result) return [];
  if (typeof result === 'string') return [result];
  return result;
}

/**
 * Open a save dialog for choosing where to save a file.
 * Returns the chosen file path, or null if cancelled.
 */
export async function saveFileDialog(
  defaultName = 'document.pdf',
  filters: DialogFilter[] = PDF_DIALOG_FILTERS,
): Promise<string | null> {
  if (!isTauri()) {
    // Browser fallback: return a fake path
    return null;
  }

  const { save } = await import('@tauri-apps/plugin-dialog');
  const result = await save({
    defaultPath: defaultName,
    filters,
  });

  return result;
}

/**
 * Open a directory chooser dialog.
 * Returns the selected folder path, or null if cancelled.
 */
export async function openDirectoryDialog(): Promise<string | null> {
  if (!isTauri()) return null;

  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    directory: true,
    multiple: false,
  });

  return typeof result === 'string' ? result : null;
}

/**
 * Get the app data directory path (%APPDATA%/mudbrick).
 */
export async function getAppDataDir(): Promise<string | null> {
  if (!isTauri()) return null;

  const { appDataDir } = await import('@tauri-apps/api/path');
  return appDataDir();
}

/**
 * Ask the native shell whether an update is available.
 */
export async function checkForAppUpdate(): Promise<AppUpdateStatus> {
  if (!isTauri()) {
    return {
      configured: false,
      endpoint: null,
      currentVersion: 'dev',
      updateAvailable: false,
      latestVersion: null,
    };
  }

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<AppUpdateStatus>('check_for_app_update');
}

/**
 * Install a pending native update.
 */
export async function installAppUpdate(): Promise<boolean> {
  if (!isTauri()) return false;

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<boolean>('install_app_update');
}

// -- Browser fallback for file dialog --

function browserFileDialog(multiple: boolean, filters: DialogFilter[]): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = filters
      .flatMap((filter) => filter.extensions)
      .map((extension) => (extension === '*' ? '*/*' : `.${extension}`))
      .join(',');
    input.multiple = multiple;

    input.onchange = () => {
      const files = Array.from(input.files || []);
      // In browser mode, we can't get local file paths.
      // Return file names as placeholders.
      resolve(files.map((f) => f.name));
    };

    input.oncancel = () => resolve([]);
    input.click();
  });
}
