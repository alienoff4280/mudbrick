/**
 * Mudbrick v2 -- ProgressBar Component
 *
 * Determinate or indeterminate progress bar for file loading.
 */

interface ProgressBarProps {
  /** Progress value 0-100. Pass undefined for indeterminate. */
  value?: number;
  /** Height in px */
  height?: number;
  /** Whether to show the percentage label */
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  height = 4,
  showLabel = false,
  className = '',
}: ProgressBarProps) {
  const isIndeterminate = value === undefined;
  const clampedValue = isIndeterminate ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div className={className} style={{ width: '100%' }}>
      <div
        role="progressbar"
        aria-valuenow={isIndeterminate ? undefined : clampedValue}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          width: '100%',
          height: `${height}px`,
          backgroundColor: 'var(--mb-surface-alt)',
          borderRadius: `${height / 2}px`,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            height: '100%',
            backgroundColor: 'var(--mb-brand)',
            borderRadius: `${height / 2}px`,
            transition: isIndeterminate ? 'none' : 'width 200ms ease',
            ...(isIndeterminate
              ? {
                  width: '30%',
                  animation: 'progress-indeterminate 1.5s ease-in-out infinite',
                }
              : {
                  width: `${clampedValue}%`,
                }),
          }}
        />
      </div>
      {showLabel && !isIndeterminate && (
        <span
          style={{
            display: 'block',
            textAlign: 'center',
            marginTop: '4px',
            fontSize: '12px',
            color: 'var(--mb-text-secondary)',
          }}
        >
          {Math.round(clampedValue)}%
        </span>
      )}
      <style>{`
        @keyframes progress-indeterminate {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(200%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}
