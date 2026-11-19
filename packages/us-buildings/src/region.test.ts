import { describe, expect, it } from 'vitest';
import { LAUNCH_REGION, isLaunchState, requireLaunchState } from './index';

describe('launch region', () => {
  it('is Texas plus its bordering states, and nothing else', () => {
    expect([...LAUNCH_REGION].sort()).toEqual(['AR', 'LA', 'NM', 'OK', 'TX']);
  });

  it('accepts launch states case-insensitively and rejects others', () => {
    expect(isLaunchState(' tx ')).toBe(true);
    expect(isLaunchState('CA')).toBe(false);
    expect(requireLaunchState('ok')).toBe('OK');
    expect(() => requireLaunchState('FL')).toThrow(/launch region/);
  });
});
