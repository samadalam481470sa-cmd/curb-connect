import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SewerDepthInput } from './SewerDepthInput';

describe('SewerDepthInput', () => {
  it('reports the depth and rate the builder types', () => {
    const onChange = vi.fn();
    render(<SewerDepthInput depthFt={0} extraCostPerFtPerLf={0} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Sewer depth in feet'), {
      target: { value: '6' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ depthFt: 6, extraCostPerFtPerLf: 0 });
    fireEvent.change(
      screen.getByLabelText('Extra cost per foot of sewer depth, per linear foot of main'),
      { target: { value: '2' } },
    );
    expect(onChange).toHaveBeenLastCalledWith({ depthFt: 0, extraCostPerFtPerLf: 2 });
  });

  it('treats a blank field as 0 (no effect)', () => {
    const onChange = vi.fn();
    render(<SewerDepthInput depthFt={6} extraCostPerFtPerLf={2} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Sewer depth in feet'), {
      target: { value: '' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ depthFt: 0, extraCostPerFtPerLf: 2 });
  });

  it('shows the estimated extra cost when the main length is known', () => {
    render(
      <SewerDepthInput
        depthFt={6}
        extraCostPerFtPerLf={2}
        onChange={() => {}}
        mainLengthFt={400}
      />,
    );
    const hint = screen.getByRole('status');
    expect(hint.textContent).toContain('Extra sewer depth (estimate): $4,800');
    expect(hint.textContent).toContain('400 ft of main');
  });

  it('shows no extra-cost hint when depth or rate is 0', () => {
    render(<SewerDepthInput depthFt={0} extraCostPerFtPerLf={2} onChange={() => {}} mainLengthFt={400} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
