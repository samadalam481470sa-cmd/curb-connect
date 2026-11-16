import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSlowNotice } from './useSlowNotice';

describe('useSlowNotice', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns on only after the wait passes, and resets when loading ends', () => {
    const { result, rerender } = renderHook(({ waiting }) => useSlowNotice(waiting, 6000), {
      initialProps: { waiting: true },
    });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(5999));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
    rerender({ waiting: false });
    expect(result.current).toBe(false);
  });

  it('never turns on when loading finishes quickly', () => {
    const { result, rerender } = renderHook(({ waiting }) => useSlowNotice(waiting, 6000), {
      initialProps: { waiting: true },
    });
    act(() => vi.advanceTimersByTime(2000));
    rerender({ waiting: false });
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current).toBe(false);
  });
});
