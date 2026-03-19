import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BatesDialog } from '../src/components/legal/BatesDialog';
import { HeaderFooterDialog } from '../src/components/legal/HeaderFooterDialog';
import { useDocumentStore } from '../src/stores/documentStore';
import { useUIStore } from '../src/stores/uiStore';
import { api } from '../src/services/api';

vi.mock('../src/services/api', () => ({
  api: {
    applyBatesNumbers: vi.fn(),
    applyHeadersFooters: vi.fn(),
  },
}));

const mockDocument = {
  sessionId: 'session-1',
  filePath: 'C:/docs/contract.pdf',
  fileName: 'contract.pdf',
  fileSize: 1024,
  pageCount: 3,
  currentVersion: 2,
  pages: [],
  createdAt: '2026-03-19T00:00:00Z',
  updatedAt: '2026-03-19T00:00:00Z',
};

describe('Phase 3 legal dialogs', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
    useUIStore.getState().reset();
    useDocumentStore.setState({
      document: mockDocument,
      currentPage: 1,
      loading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  it('submits Bates numbering with the current session and normalized range', async () => {
    const onClose = vi.fn();
    const onApplied = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.applyBatesNumbers).mockResolvedValue({
      success: true,
      first_label: 'MB-0007',
      last_label: 'MB-0009',
      page_count: 3,
    });

    render(<BatesDialog open onClose={onClose} onApplied={onApplied} />);

    fireEvent.change(screen.getByLabelText('Starting number'), {
      target: { value: '7' },
    });

    expect(screen.getByText(/MB-0007/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Bates' }));

    await waitFor(() => {
      expect(api.applyBatesNumbers).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          prefix: 'MB-',
          start_num: 7,
          zero_pad: 4,
          position: 'bottom-right',
          end_page: 0,
        }),
      );
    });

    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().toasts.at(-1)?.message).toBe('MB-0007 - MB-0009');
  });

  it('submits headers and footers with filename fallback and token content', async () => {
    const onClose = vi.fn();
    const onApplied = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.applyHeadersFooters).mockResolvedValue({
      success: true,
      page_count: 3,
    });

    render(<HeaderFooterDialog open onClose={onClose} onApplied={onApplied} />);

    fireEvent.change(screen.getByLabelText('Top left'), {
      target: { value: 'CONFIDENTIAL' },
    });

    expect(screen.getByText('CONFIDENTIAL')).toBeInTheDocument();
    expect(screen.getAllByText('1/3').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Apply Headers/Footers' }));

    await waitFor(() => {
      expect(api.applyHeadersFooters).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          top_left: 'CONFIDENTIAL',
          bottom_right: '{page}/{pages}',
          filename: 'contract.pdf',
          end_page: 0,
        }),
      );
    });

    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().toasts.at(-1)?.message).toBe('Applied headers and footers');
  });
});
