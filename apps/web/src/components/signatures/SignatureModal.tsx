import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../shared/Modal';
import { useUIStore } from '../../stores/uiStore';
import {
  actionsStyle,
  dialogBodyStyle,
  errorStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionStyle,
  sectionTitleStyle,
} from '../legal/primitives';
import type { CSSProperties } from 'react';

type SignatureMode = 'draw' | 'type' | 'upload';

interface SignatureModalProps {
  open: boolean;
  onClose: () => void;
  onAccept: (signatureDataUrl: string) => void;
}

const tabBarStyle: CSSProperties = {
  display: 'flex',
  gap: '0',
  borderBottom: '2px solid var(--mb-border)',
  marginBottom: '16px',
};

const tabStyle = (active: boolean): CSSProperties => ({
  padding: '8px 16px',
  fontSize: '13px',
  fontWeight: 600,
  border: 'none',
  borderBottom: active ? '2px solid var(--mb-brand)' : '2px solid transparent',
  marginBottom: '-2px',
  backgroundColor: 'transparent',
  color: active ? 'var(--mb-brand)' : 'var(--mb-text-secondary)',
  cursor: 'pointer',
});

const canvasContainerStyle: CSSProperties = {
  border: '1px solid var(--mb-border)',
  borderRadius: 'var(--mb-radius-sm)',
  backgroundColor: '#ffffff',
  cursor: 'crosshair',
  touchAction: 'none',
};

const signaturePreviewStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '160px',
  border: '1px dashed var(--mb-border)',
  borderRadius: 'var(--mb-radius-sm)',
  backgroundColor: '#ffffff',
  padding: '16px',
};

export function SignatureModal({ open, onClose, onAccept }: SignatureModalProps) {
  const addToast = useUIStore((s) => s.addToast);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<SignatureMode>('draw');
  const [drawing, setDrawing] = useState(false);
  const [typedText, setTypedText] = useState('');
  const [typedFont, setTypedFont] = useState('cursive');
  const [typedSize, setTypedSize] = useState(48);
  const [typedColor, setTypedColor] = useState('#00008B');
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    setMode('draw');
    setTypedText('');
    setUploadedImage(null);
    setHasDrawn(false);
    setErrorMessage('');
  }, [open]);

  // Initialize canvas when mode = draw
  useEffect(() => {
    if (!open || mode !== 'draw') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 500;
    canvas.height = 160;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#00008B';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setHasDrawn(false);
  }, [mode, open]);

  const getCanvasCoords = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      setDrawing(true);
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      const { x, y } = getCanvasCoords(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    },
    [getCanvasCoords],
  );

  const handlePointerMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!drawing) return;
      e.preventDefault();
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      const { x, y } = getCanvasCoords(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      setHasDrawn(true);
    },
    [drawing, getCanvasCoords],
  );

  const handlePointerUp = useCallback(() => {
    setDrawing(false);
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#00008B';
    ctx.lineWidth = 2;
    setHasDrawn(false);
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please select an image file (PNG, JPG, etc.)');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setUploadedImage(reader.result as string);
      setErrorMessage('');
    };
    reader.readAsDataURL(file);
  }, []);

  const generateTypedSignature = useCallback((): string => {
    const canvas = window.document.createElement('canvas');
    canvas.width = 500;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = typedColor;
    ctx.font = `${typedSize}px ${typedFont}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(typedText, canvas.width / 2, canvas.height / 2);

    return canvas.toDataURL('image/png');
  }, [typedColor, typedFont, typedSize, typedText]);

  const handleAccept = useCallback(() => {
    setErrorMessage('');

    let dataUrl = '';

    switch (mode) {
      case 'draw': {
        if (!hasDrawn) {
          setErrorMessage('Please draw a signature first');
          return;
        }
        const canvas = canvasRef.current;
        if (!canvas) return;
        dataUrl = canvas.toDataURL('image/png');
        break;
      }
      case 'type': {
        if (!typedText.trim()) {
          setErrorMessage('Please type a signature');
          return;
        }
        dataUrl = generateTypedSignature();
        break;
      }
      case 'upload': {
        if (!uploadedImage) {
          setErrorMessage('Please upload a signature image');
          return;
        }
        dataUrl = uploadedImage;
        break;
      }
    }

    if (!dataUrl) {
      setErrorMessage('Failed to generate signature');
      return;
    }

    onAccept(dataUrl);
    addToast({ type: 'success', message: 'Signature created' });
    onClose();
  }, [addToast, generateTypedSignature, hasDrawn, mode, onAccept, onClose, typedText, uploadedImage]);

  const FONT_OPTIONS = [
    { value: 'cursive', label: 'Cursive' },
    { value: '"Brush Script MT", cursive', label: 'Brush Script' },
    { value: '"Segoe Script", cursive', label: 'Segoe Script' },
    { value: 'serif', label: 'Serif' },
    { value: 'monospace', label: 'Monospace' },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Create Signature">
      <div style={dialogBodyStyle}>
        <div style={tabBarStyle}>
          {(['draw', 'type', 'upload'] as const).map((tab) => (
            <button key={tab} type="button" onClick={() => setMode(tab)} style={tabStyle(mode === tab)}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {mode === 'draw' && (
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Draw your signature</div>
            <div style={canvasContainerStyle}>
              <canvas
                ref={canvasRef}
                style={{ width: '100%', height: '160px', display: 'block' }}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onMouseLeave={handlePointerUp}
                onTouchStart={handlePointerDown}
                onTouchMove={handlePointerMove}
                onTouchEnd={handlePointerUp}
              />
            </div>
            <button
              type="button"
              onClick={clearCanvas}
              style={{
                alignSelf: 'flex-start',
                padding: '4px 10px',
                fontSize: '12px',
                border: '1px solid var(--mb-border)',
                borderRadius: 'var(--mb-radius-sm)',
                backgroundColor: 'var(--mb-surface)',
                color: 'var(--mb-text)',
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          </div>
        )}

        {mode === 'type' && (
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Type your signature</div>
            <input
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              placeholder="Type your name"
              style={{
                width: '100%',
                minHeight: '36px',
                padding: '8px 12px',
                border: '1px solid var(--mb-border)',
                borderRadius: 'var(--mb-radius-sm)',
                backgroundColor: '#ffffff',
                color: typedColor,
                fontSize: `${Math.min(typedSize, 32)}px`,
                fontFamily: typedFont,
              }}
            />
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--mb-text-secondary)' }}>
                Font
                <select
                  value={typedFont}
                  onChange={(e) => setTypedFont(e.target.value)}
                  style={{ padding: '4px 8px', fontSize: '13px', border: '1px solid var(--mb-border)', borderRadius: 'var(--mb-radius-sm)' }}
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--mb-text-secondary)' }}>
                Size
                <input
                  type="number"
                  min={16}
                  max={72}
                  value={typedSize}
                  onChange={(e) => setTypedSize(Number(e.target.value) || 48)}
                  style={{ width: '60px', padding: '4px 8px', fontSize: '13px', border: '1px solid var(--mb-border)', borderRadius: 'var(--mb-radius-sm)' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--mb-text-secondary)' }}>
                Color
                <input
                  type="color"
                  value={typedColor}
                  onChange={(e) => setTypedColor(e.target.value)}
                  style={{ width: '36px', height: '28px', padding: '2px', border: '1px solid var(--mb-border)', borderRadius: 'var(--mb-radius-sm)' }}
                />
              </label>
            </div>
            {typedText && (
              <div style={signaturePreviewStyle}>
                <span style={{ fontFamily: typedFont, fontSize: `${typedSize}px`, color: typedColor }}>
                  {typedText}
                </span>
              </div>
            )}
          </div>
        )}

        {mode === 'upload' && (
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Upload signature image</div>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              style={{ fontSize: '13px' }}
            />
            {uploadedImage && (
              <div style={signaturePreviewStyle}>
                <img
                  src={uploadedImage}
                  alt="Uploaded signature"
                  style={{ maxWidth: '100%', maxHeight: '140px', objectFit: 'contain' }}
                />
              </div>
            )}
          </div>
        )}

        {errorMessage ? <div style={errorStyle}>{errorMessage}</div> : null}

        <div style={actionsStyle}>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>
            Cancel
          </button>
          <button type="button" onClick={handleAccept} style={primaryButtonStyle}>
            Accept Signature
          </button>
        </div>
      </div>
    </Modal>
  );
}
