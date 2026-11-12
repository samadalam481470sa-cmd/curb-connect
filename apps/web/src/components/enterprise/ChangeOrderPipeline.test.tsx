import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChangeOrder } from '../../types/enterprise';
import { ChangeOrderPipeline } from './ChangeOrderPipeline';

const order: ChangeOrder = {
  id: 'co-1',
  project_id: 'project-1',
  co_number: 'PCO-001',
  title: 'Additional concrete removal',
  description: 'Owner-requested scope change',
  status: 'submitted_to_owner',
  cost_impact_amount: 2350.25,
  schedule_impact_days: 2,
  created_at: '2026-01-01T00:00:00Z',
};

describe('ChangeOrderPipeline', () => {
  it('shows real amount only and does not expose approval without permission', () => {
    render(
      <ChangeOrderPipeline
        changeOrders={[order]}
        canAdvance={false}
        canApprove={false}
        pendingId={null}
        onUpdateCOStatus={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getAllByText('$2,350.25').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Approve CO' })).toBeNull();
    expect(screen.getByText(/Owner approval permission required/)).toBeTruthy();
  });

  it('submits exactly an approval stage change when authorized', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <ChangeOrderPipeline
        changeOrders={[order]}
        canAdvance={false}
        canApprove
        pendingId={null}
        onUpdateCOStatus={save}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve CO' }));
    expect(save).toHaveBeenCalledWith('co-1', 'approved');
  });

  it('keeps rejected orders out of pending and approved totals', () => {
    render(
      <ChangeOrderPipeline
        changeOrders={[{ ...order, status: 'rejected' }]}
        canAdvance={false}
        canApprove={false}
        pendingId={null}
        onUpdateCOStatus={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getAllByText('$0.00')).toHaveLength(2);
  });
});
