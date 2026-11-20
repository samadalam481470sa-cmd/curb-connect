import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { dropCachesOnAuthFailure } from './session';

function seeded(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(['auth-providers'], { providers: [{ id: 'microsoft' }] });
  client.setQueryData(['sign-in-probe'], undefined);
  client.setQueryData(['jobs', 'org-1'], [{ id: 'job-1' }]);
  return client;
}

describe('dropCachesOnAuthFailure', () => {
  it.each(['/sign-in', '/sign-up', '/access'])(
    'keeps the sign-in options on %s, where a 401 from the probe is expected',
    (pathname) => {
      const client = seeded();
      expect(dropCachesOnAuthFailure(client, pathname)).toBe(false);
      expect(client.getQueryData(['auth-providers'])).toEqual({
        providers: [{ id: 'microsoft' }],
      });
      // Tenant data is still dropped.
      expect(client.getQueryData(['jobs', 'org-1'])).toBeUndefined();
    },
  );

  it('drops every cached response inside the app and asks to leave', () => {
    const client = seeded();
    expect(dropCachesOnAuthFailure(client, '/jobs')).toBe(true);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('does not treat look-alike paths as auth pages', () => {
    const client = seeded();
    expect(dropCachesOnAuthFailure(client, '/sign-in-help')).toBe(true);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});
