import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalLength } from '../format/length';
import { Button, IconButton } from './Button';
import { Field } from './Field';
import { MeasurementInput } from './MeasurementInput';
import { MoneyInput } from './MoneyInput';
import { TextInput } from './TextInput';

afterEach(cleanup);

describe('Button', () => {
  it('loading and permission-denied buttons stay focusable but do not fire', () => {
    const onClick = vi.fn();
    render(
      <>
        <Button loading onClick={onClick}>
          Save
        </Button>
        <Button deniedReason="Estimator role required" onClick={onClick}>
          Approve
        </Button>
      </>,
    );
    const save = screen.getByRole('button', { name: /Save/ });
    const approve = screen.getByRole('button', { name: /Approve/ });
    expect(save.getAttribute('aria-busy')).toBe('true');
    expect(approve.getAttribute('aria-disabled')).toBe('true');
    expect(approve.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText(/Not available: Estimator role required/)).toBeTruthy();
    fireEvent.click(save);
    fireEvent.click(approve);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('IconButton uses its label as the accessible name', () => {
    render(<IconButton label="Delete facet" icon={<span>x</span>} />);
    expect(screen.getByRole('button', { name: 'Delete facet' })).toBeTruthy();
  });
});

describe('Field', () => {
  it('labels the control and wires hint and error', () => {
    render(
      <Field label="Customer name" hint="As on the permit" error="Required" required>
        <TextInput />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: /Customer name/ });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.hasAttribute('required')).toBe(true);
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    const text = describedBy
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
      .join(' ');
    expect(text).toContain('As on the permit');
    expect(text).toContain('Required');
  });
});

describe('MoneyInput', () => {
  function Harness({ onMinor }: { onMinor: (v: bigint | null) => void }) {
    const [value, setValue] = useState<bigint | null>(549120n);
    return (
      <Field label="Selling price">
        <MoneyInput
          currency="USD"
          valueMinor={value}
          onChangeMinor={(v) => {
            setValue(v);
            onMinor(v);
          }}
        />
      </Field>
    );
  }

  it('shows minor units formatted and emits minor units', () => {
    const onMinor = vi.fn();
    render(<Harness onMinor={onMinor} />);
    const input = screen.getByRole('textbox', { name: 'Selling price' }) as HTMLInputElement;
    expect(input.value).toBe('5,491.20');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '4118.40' } });
    expect(onMinor).toHaveBeenLastCalledWith(411840n);
  });

  it('rejects extra decimals instead of rounding', () => {
    const onMinor = vi.fn();
    render(<Harness onMinor={onMinor} />);
    const input = screen.getByRole('textbox', { name: 'Selling price' });
    fireEvent.change(input, { target: { value: '1.005' } });
    expect(onMinor).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('MeasurementInput', () => {
  function Harness({ onValue }: { onValue: (v: CanonicalLength | null) => void }) {
    const [value, setValue] = useState<CanonicalLength | null>(null);
    return (
      <Field label="Curb length">
        <MeasurementInput
          value={value}
          onChange={(v) => {
            setValue(v);
            onValue(v);
          }}
        />
      </Field>
    );
  }

  it('emits canonical meters and keeps the value when the unit changes', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole('textbox', { name: 'Curb length' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '18' } });
    fireEvent.blur(input);
    const last = onValue.mock.calls.at(-1)?.[0] as CanonicalLength;
    expect(last.state).toBe('known');
    if (last.state === 'known') expect(last.value).toBeCloseTo(5.4864, 6);
    const meters = screen.getByRole('button', { name: 'meters' });
    fireEvent.click(meters);
    expect(meters.getAttribute('aria-pressed')).toBe('true');
    expect(input.value).toBe('5.486');
    expect(onValue).toHaveBeenCalledTimes(1);
  });

  it('has an explicit Unknown state that is not zero', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Unknown' }));
    expect(onValue).toHaveBeenLastCalledWith({ state: 'unknown' });
    const input = screen.getByRole('textbox', { name: 'Curb length' }) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.value).toBe('');
  });

  it('flags negative input', () => {
    render(<Harness onValue={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Curb length' });
    act(() => {
      fireEvent.change(input, { target: { value: '-3' } });
    });
    expect(screen.getByText(/zero or more/)).toBeTruthy();
  });
});
