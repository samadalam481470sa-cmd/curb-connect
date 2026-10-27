import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';
import { Sheet } from './Sheet';
import { LiveRegion, ToastProvider, useToast } from './Toast';

afterEach(cleanup);

function DialogHarness({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Void invoice
      </button>
      <ConfirmDialog
        open={open}
        title="Void invoice INV-12?"
        description="This cannot be undone."
        confirmLabel="Void"
        tone="danger"
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

describe('ConfirmDialog', () => {
  it('focuses Cancel, traps Tab, closes on Escape and restores focus', () => {
    render(<DialogHarness onConfirm={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'Void invoice' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('alertdialog', { name: 'Void invoice INV-12?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Void' });
    expect(document.activeElement).toBe(cancel);
    confirm.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('runs onConfirm', async () => {
    const onConfirm = vi.fn();
    render(<DialogHarness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Void invoice' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Void' }));
    });
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe('Sheet', () => {
  it('is a labelled modal dialog that closes with Escape and the close button', () => {
    const onClose = vi.fn();
    render(
      <Sheet open title="Facet details" onClose={onClose}>
        <p>Pitch 6/12</p>
      </Sheet>,
    );
    expect(screen.getByRole('dialog', { name: 'Facet details' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('Toast', () => {
  function Trigger() {
    const toast = useToast();
    return (
      <>
        <button
          type="button"
          onClick={() => toast.show({ message: 'Estimate saved', tone: 'success' })}
        >
          ok
        </button>
        <button
          type="button"
          onClick={() => toast.show({ message: 'Sync failed', tone: 'danger' })}
        >
          fail
        </button>
      </>
    );
  }

  it('announces in polite or assertive live regions and auto-dismisses non-errors', () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider>
          <Trigger />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'ok' }));
      fireEvent.click(screen.getByRole('button', { name: 'fail' }));
      expect(screen.getByRole('status').textContent).toContain('Estimate saved');
      expect(screen.getByRole('alert').textContent).toContain('Sync failed');
      act(() => {
        vi.advanceTimersByTime(7000);
      });
      expect(screen.queryByText('Estimate saved')).toBeNull();
      expect(screen.getByText('Sync failed')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
      expect(screen.queryByText('Sync failed')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('LiveRegion exposes a status message', () => {
    render(<LiveRegion message="Facet 3 deleted" />);
    expect(screen.getByRole('status').textContent).toBe('Facet 3 deleted');
  });
});
