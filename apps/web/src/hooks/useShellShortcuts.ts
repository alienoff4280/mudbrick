/**
 * Mudbrick v2 -- Shell Keyboard Shortcuts Hook
 *
 * Wires keyboard shortcuts from the command registry into the
 * useKeyboardShortcuts hook. This connects the shell's command
 * definitions to actual keyboard event handling.
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';
import { getShortcutCommands, executeCommand, type CommandDef } from '../services/commandRegistry';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { useDocumentStore } from '../stores/documentStore';

/**
 * Registers all shortcut-enabled commands from the command registry.
 * Commands that require a document are only active when one is open.
 */
export function useShellShortcuts(): void {
  const hasDocument = !!useDocumentStore((s) => s.document);

  const bindings = useMemo(() => {
    const result: Record<string, () => void> = {};
    const commands = getShortcutCommands();

    for (const cmd of commands) {
      if (!cmd.shortcut) continue;
      // Skip commands that require a document when none is open
      if (cmd.requiresDocument && !hasDocument) continue;
      // Skip explicitly disabled commands
      if (cmd.enabled === false) continue;

      result[cmd.shortcut] = () => executeCommand(cmd.id);
    }

    return result;
  }, [hasDocument]);

  useKeyboardShortcuts(bindings);
}

/**
 * F6 region cycling for accessibility.
 * Cycles focus between: menu bar, ribbon, left pane, workspace, right pane, status bar.
 */
export function useRegionCycling(): void {
  useEffect(() => {
    const REGION_SELECTORS = [
      '[role="menubar"]',
      '[role="tablist"][aria-label="Ribbon tabs"]',
      '[role="tablist"][aria-label="Left pane navigation"]',
      '#main-content',
      '[role="complementary"]',
      '[role="status"]',
    ];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'F6') return;
      e.preventDefault();

      const direction = e.shiftKey ? -1 : 1;
      const regions = REGION_SELECTORS.map((sel) => document.querySelector<HTMLElement>(sel)).filter(Boolean) as HTMLElement[];
      if (regions.length === 0) return;

      // Find current region
      const active = document.activeElement as HTMLElement;
      let currentIndex = -1;
      for (let i = 0; i < regions.length; i++) {
        if (regions[i].contains(active)) {
          currentIndex = i;
          break;
        }
      }

      const nextIndex = currentIndex === -1
        ? 0
        : (currentIndex + direction + regions.length) % regions.length;

      const target = regions[nextIndex];
      // Try to focus the first focusable element inside the region
      const focusable = target.querySelector<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      (focusable || target).focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
