import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../shared/Modal';
import { useDocumentStore } from '../../stores/documentStore';
import { useUIStore } from '../../stores/uiStore';
import { api } from '../../services/api';
import {
  BATES_POSITION_OPTIONS,
  LEGAL_FONT_OPTIONS,
  actionsStyle,
  dialogBodyStyle,
  errorStyle,
  fieldStyle,
  gridStyle,
  helperTextStyle,
  inputStyle,
  labelStyle,
  previewStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionStyle,
  sectionTitleStyle,
} from '../legal/primitives';

interface ExhibitStampDialogProps {
  open: boolean;
  onClose: () => void;
  onApplied?: () => Promise<void> | void;
}

export function ExhibitStampDialog({ open, onClose, onApplied }: ExhibitStampDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const addToast = useUIStore((s) => s.addToast);

  const [format, setFormat] = useState('Exhibit {num}');
  const [startNum, setStartNum] = useState(1);
  const [position, setPosition] = useState('top-center');
  const [font, setFont] = useState('HelveticaBold');
  const [fontSize, setFontSize] = useState(14);
  const [color, setColor] = useState('#000000');
  const [bgColor, setBgColor] = useState('');
  const [margin, setMargin] = useState(0.5);
  const [pageMode, setPageMode] = useState<'all' | 'custom'>('all');
  const [customPages, setCustomPages] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    setFormat('Exhibit {num}');
    setStartNum(1);
    setPosition('top-center');
    setFont('HelveticaBold');
    setFontSize(14);
    setColor('#000000');
    setBgColor('');
    setMargin(0.5);
    setPageMode('all');
    setCustomPages('');
    setErrorMessage('');
  }, [open]);

  const previewLabel = format.replace('{num}', String(startNum));

  const parsePages = useCallback(
    (input: string): number[] => {
      if (!input.trim()) return [];
      const pages: number[] = [];
      const parts = input.split(',');
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.includes('-')) {
          const [start, end] = trimmed.split('-').map(Number);
          if (!isNaN(start) && !isNaN(end)) {
            for (let i = start; i <= end; i++) pages.push(i);
          }
        } else {
          const num = Number(trimmed);
          if (!isNaN(num)) pages.push(num);
        }
      }
      return pages;
    },
    [],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!document || submitting) return;

      setSubmitting(true);
      setErrorMessage('');

      try {
        const pages = pageMode === 'custom' ? parsePages(customPages) : [];
        const result = await api.applyExhibitStamps(document.sessionId, {
          format,
          start_num: startNum,
          position,
          font,
          font_size: fontSize,
          color,
          bg_color: bgColor,
          margin,
          pages,
        });

        const count = result.labels?.length ?? 0;
        addToast({
          type: 'success',
          message: `Applied ${count} exhibit stamp${count !== 1 ? 's' : ''}`,
        });
        await onApplied?.();
        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to apply exhibit stamps';
        setErrorMessage(message);
        addToast({ type: 'error', message });
      } finally {
        setSubmitting(false);
      }
    },
    [
      addToast,
      bgColor,
      color,
      customPages,
      document,
      font,
      fontSize,
      format,
      margin,
      onApplied,
      onClose,
      pageMode,
      parsePages,
      position,
      startNum,
      submitting,
    ],
  );

  return (
    <Modal open={open} onClose={onClose} title="Exhibit Stamps">
      <form onSubmit={handleSubmit} style={dialogBodyStyle}>
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Stamp Format</div>
          <div style={gridStyle}>
            <label htmlFor="exhibit-format" style={fieldStyle}>
              <span style={labelStyle}>Format string</span>
              <input
                id="exhibit-format"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                style={inputStyle}
              />
              <span style={helperTextStyle}>Use {'{num}'} for the exhibit number</span>
            </label>
            <label htmlFor="exhibit-start-num" style={fieldStyle}>
              <span style={labelStyle}>Starting number</span>
              <input
                id="exhibit-start-num"
                type="number"
                min={1}
                value={startNum}
                onChange={(e) => setStartNum(Number(e.target.value) || 1)}
                style={inputStyle}
              />
            </label>
          </div>
          <div style={previewStyle}>
            <strong>Preview:</strong> {previewLabel}
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Placement</div>
          <div style={gridStyle}>
            <label htmlFor="exhibit-position" style={fieldStyle}>
              <span style={labelStyle}>Position</span>
              <select
                id="exhibit-position"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                style={inputStyle}
              >
                {BATES_POSITION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="exhibit-font" style={fieldStyle}>
              <span style={labelStyle}>Font</span>
              <select
                id="exhibit-font"
                value={font}
                onChange={(e) => setFont(e.target.value)}
                style={inputStyle}
              >
                {LEGAL_FONT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="exhibit-font-size" style={fieldStyle}>
              <span style={labelStyle}>Font size</span>
              <input
                id="exhibit-font-size"
                type="number"
                min={6}
                max={72}
                step={0.5}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value) || 14)}
                style={inputStyle}
              />
            </label>
            <label htmlFor="exhibit-color" style={fieldStyle}>
              <span style={labelStyle}>Text color</span>
              <input
                id="exhibit-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                style={{ ...inputStyle, padding: '6px 10px' }}
              />
            </label>
            <label htmlFor="exhibit-bg-color" style={fieldStyle}>
              <span style={labelStyle}>Background color</span>
              <input
                id="exhibit-bg-color"
                type="color"
                value={bgColor || '#ffffff'}
                onChange={(e) => setBgColor(e.target.value)}
                style={{ ...inputStyle, padding: '6px 10px' }}
              />
              <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  type="checkbox"
                  checked={!bgColor}
                  onChange={(e) => setBgColor(e.target.checked ? '' : '#ffffff')}
                />
                No background
              </label>
            </label>
            <label htmlFor="exhibit-margin" style={fieldStyle}>
              <span style={labelStyle}>Margin (inches)</span>
              <input
                id="exhibit-margin"
                type="number"
                min={0}
                max={3}
                step={0.05}
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value) || 0)}
                style={inputStyle}
              />
            </label>
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Page Selection</div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
              <input
                type="radio"
                name="page-mode"
                checked={pageMode === 'all'}
                onChange={() => setPageMode('all')}
              />
              All pages
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
              <input
                type="radio"
                name="page-mode"
                checked={pageMode === 'custom'}
                onChange={() => setPageMode('custom')}
              />
              Specific pages
            </label>
          </div>
          {pageMode === 'custom' && (
            <label htmlFor="exhibit-pages" style={fieldStyle}>
              <span style={labelStyle}>Pages (e.g., 1,3,5-8)</span>
              <input
                id="exhibit-pages"
                value={customPages}
                onChange={(e) => setCustomPages(e.target.value)}
                placeholder="1, 3, 5-8"
                style={inputStyle}
              />
            </label>
          )}
          <div style={helperTextStyle}>
            {pageMode === 'all'
              ? `All ${document?.pageCount ?? 0} pages will receive sequential exhibit stamps.`
              : 'Only the specified pages will receive exhibit stamps.'}
          </div>
        </div>

        {errorMessage ? <div style={errorStyle}>{errorMessage}</div> : null}

        <div style={actionsStyle}>
          <button type="button" onClick={onClose} disabled={submitting} style={secondaryButtonStyle}>
            Cancel
          </button>
          <button type="submit" disabled={!document || submitting} style={primaryButtonStyle}>
            {submitting ? 'Applying...' : 'Apply Stamps'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
