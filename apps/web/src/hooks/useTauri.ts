/**
 * Mudbrick v2 -- Tauri Hook
 *
 * Provides Tauri-specific functionality (file dialogs, window controls)
 * with graceful fallback when running in browser dev mode.
 */

import { useCallback } from 'react';
import {
  isTauri,
  type DialogFilter,
  openDirectoryDialog,
  openFileDialog,
  saveFileDialog,
} from '../services/tauriBridge';

const PDF_AND_IMAGE_FILTERS: DialogFilter[] = [
  { name: 'Supported Files', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'gif', 'webp'] },
  { name: 'PDF Documents', extensions: ['pdf'] },
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'gif', 'webp'] },
];

const IMAGE_FILTERS: DialogFilter[] = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'gif', 'webp'] },
  { name: 'All Files', extensions: ['*'] },
];

const ALL_FILES_FILTERS: DialogFilter[] = [
  { name: 'All Files', extensions: ['*'] },
];

export function useTauri() {
  const isDesktop = isTauri();

  const openFile = useCallback(async (): Promise<string | null> => {
    const paths = await openFileDialog(false);
    return paths.length > 0 ? paths[0] : null;
  }, []);

  const openMultipleFiles = useCallback(async (): Promise<string[]> => {
    return openFileDialog(true);
  }, []);

  const openPdfOrImageFile = useCallback(async (): Promise<string | null> => {
    const paths = await openFileDialog(false, PDF_AND_IMAGE_FILTERS);
    return paths.length > 0 ? paths[0] : null;
  }, []);

  const openImageFiles = useCallback(async (): Promise<string[]> => {
    return openFileDialog(true, IMAGE_FILTERS);
  }, []);

  const openAnyFiles = useCallback(async (): Promise<string[]> => {
    return openFileDialog(true, ALL_FILES_FILTERS);
  }, []);

  const chooseSavePath = useCallback(
    async (defaultName = 'document.pdf'): Promise<string | null> => {
      return saveFileDialog(defaultName);
    },
    [],
  );

  const chooseAnySavePath = useCallback(
    async (defaultName = 'attachment.bin'): Promise<string | null> => {
      return saveFileDialog(defaultName, ALL_FILES_FILTERS);
    },
    [],
  );

  const chooseDirectory = useCallback(async (): Promise<string | null> => {
    return openDirectoryDialog();
  }, []);

  return {
    isDesktop,
    openFile,
    openMultipleFiles,
    openPdfOrImageFile,
    openImageFiles,
    openAnyFiles,
    chooseSavePath,
    chooseAnySavePath,
    chooseDirectory,
  };
}
