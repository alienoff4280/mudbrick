/**
 * Mudbrick v2 -- RibbonPanel
 *
 * Renders the command groups for the currently active ribbon tab.
 * Each group is a labeled section with icon buttons.
 */

import { useCallback } from 'react';
import {
  getRibbonCommands,
  executeCommand,
  type CommandDef,
} from '../../../services/commandRegistry';
import { useUIStore } from '../../../stores/uiStore';
import { useDocumentStore } from '../../../stores/documentStore';
import { useAnnotationStore } from '../../../stores/annotationStore';
import { TOOLS, type ToolId } from '@mudbrick/shared/src/constants';
import styles from './RibbonPanel.module.css';

/** Map annotation command ids to tool ids */
const ANNOTATE_TOOL_MAP: Record<string, ToolId> = {
  'annotate.select': TOOLS.SELECT,
  'annotate.draw': TOOLS.DRAW,
  'annotate.highlight': TOOLS.HIGHLIGHT,
  'annotate.text': TOOLS.TEXT,
  'annotate.shape': TOOLS.SHAPE,
  'annotate.stamp': TOOLS.STAMP,
  'annotate.redact': TOOLS.REDACT,
};

export function RibbonPanel() {
  const ribbonTab = useUIStore((s) => s.ribbonTab);
  const hasDocument = !!useDocumentStore((s) => s.document);
  const activeTool = useAnnotationStore((s) => s.activeTool);
  const setActiveTool = useAnnotationStore((s) => s.setActiveTool);
  const openRightPane = useUIStore((s) => s.openRightPane);

  const groups = getRibbonCommands(ribbonTab);

  const handleCommand = useCallback(
    (cmd: CommandDef) => {
      // Annotation tool commands switch the active tool
      const toolId = ANNOTATE_TOOL_MAP[cmd.id];
      if (toolId) {
        setActiveTool(toolId);
        if (toolId !== TOOLS.SELECT) {
          openRightPane('properties');
        }
        return;
      }
      executeCommand(cmd.id);
    },
    [setActiveTool, openRightPane],
  );

  const entries = Array.from(groups.entries());

  return (
    <div
      className={styles.panel}
      id={`ribbon-panel-${ribbonTab}`}
      role="tabpanel"
      aria-label={`${ribbonTab} ribbon`}
    >
      {entries.map(([groupName, commands], gi) => (
        <div key={groupName} style={{ display: 'flex', alignItems: 'stretch' }}>
          <div className={styles.group}>
            <div className={styles.groupButtons}>
              {commands.map((cmd) => {
                const disabled =
                  (cmd.requiresDocument && !hasDocument) || cmd.enabled === false;
                const toolId = ANNOTATE_TOOL_MAP[cmd.id];
                const isActive = toolId ? activeTool === toolId : false;

                return (
                  <button
                    key={cmd.id}
                    className={styles.ribbonBtn}
                    data-active={isActive}
                    disabled={disabled}
                    title={
                      cmd.shortcut
                        ? `${cmd.label} (${cmd.shortcut})`
                        : cmd.label
                    }
                    aria-label={cmd.label}
                    aria-pressed={isActive || undefined}
                    onClick={() => handleCommand(cmd)}
                  >
                    {cmd.icon && (
                      <svg
                        className={styles.ribbonBtnIcon}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d={cmd.icon} />
                      </svg>
                    )}
                    <span>{cmd.label}</span>
                  </button>
                );
              })}
            </div>
            <span className={styles.groupLabel}>{groupName}</span>
          </div>
          {gi < entries.length - 1 && <div className={styles.groupSeparator} />}
        </div>
      ))}
    </div>
  );
}
