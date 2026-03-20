/**
 * Mudbrick v2 -- AppMenuBar
 *
 * Desktop-style File/Edit/View/Document/Tools/Help menu bar.
 * All items are driven by the command registry.
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import {
  getMenuCommands,
  executeCommand,
  type CommandDef,
  type CommandCategory,
} from '../../../services/commandRegistry';
import { useUIStore } from '../../../stores/uiStore';
import styles from './AppMenuBar.module.css';

interface AppMenuBarProps {
  hasDocument: boolean;
}

interface MenuDef {
  label: string;
  category: CommandCategory;
}

const MENUS: MenuDef[] = [
  { label: 'File', category: 'file' },
  { label: 'Edit', category: 'edit' },
  { label: 'View', category: 'view' },
  { label: 'Document', category: 'document' },
  { label: 'Tools', category: 'tools' },
  { label: 'Help', category: 'help' },
];

export function AppMenuBar({ hasDocument }: AppMenuBarProps) {
  const menuOpen = useUIStore((s) => s.menuOpen);
  const setMenuOpen = useUIStore((s) => s.setMenuOpen);
  const barRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handle = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [menuOpen, setMenuOpen]);

  // Close on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(null);
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [menuOpen, setMenuOpen]);

  const handleMenuClick = useCallback(
    (category: string) => {
      setMenuOpen(menuOpen === category ? null : category);
    },
    [menuOpen, setMenuOpen],
  );

  const handleMenuHover = useCallback(
    (category: string) => {
      if (menuOpen) setMenuOpen(category);
    },
    [menuOpen, setMenuOpen],
  );

  const handleCommand = useCallback(
    (cmd: CommandDef) => {
      setMenuOpen(null);
      executeCommand(cmd.id);
    },
    [setMenuOpen],
  );

  return (
    <div className={styles.menuBar} ref={barRef} role="menubar" aria-label="Application menu">
      <span className={styles.brand}>Mudbrick</span>
      {MENUS.map((menu) => (
        <MenuButton
          key={menu.category}
          label={menu.label}
          category={menu.category}
          isOpen={menuOpen === menu.category}
          hasDocument={hasDocument}
          onClick={() => handleMenuClick(menu.category)}
          onHover={() => handleMenuHover(menu.category)}
          onCommand={handleCommand}
        />
      ))}
    </div>
  );
}

function MenuButton({
  label,
  category,
  isOpen,
  hasDocument,
  onClick,
  onHover,
  onCommand,
}: {
  label: string;
  category: CommandCategory;
  isOpen: boolean;
  hasDocument: boolean;
  onClick: () => void;
  onHover: () => void;
  onCommand: (cmd: CommandDef) => void;
}) {
  const commands = getMenuCommands(category);

  return (
    <div style={{ position: 'relative' }}>
      <button
        className={styles.menuItem}
        data-open={isOpen}
        onClick={onClick}
        onMouseEnter={onHover}
        role="menuitem"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {label}
      </button>
      {isOpen && (
        <div className={styles.dropdown} role="menu" aria-label={`${label} menu`}>
          {commands.map((cmd) => {
            const disabled = cmd.requiresDocument && !hasDocument;
            const isExplicitlyDisabled = cmd.enabled === false;
            return (
              <div key={cmd.id}>
                <button
                  className={styles.dropdownItem}
                  role="menuitem"
                  disabled={disabled || isExplicitlyDisabled}
                  onClick={() => onCommand(cmd)}
                >
                  <span>{cmd.label}</span>
                  {cmd.shortcut && (
                    <span className={styles.shortcutHint}>{cmd.shortcut}</span>
                  )}
                </button>
                {cmd.separatorAfter && <div className={styles.separator} role="separator" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
