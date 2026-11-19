// PostgresStore against a real database. Runs only when MAILER_TEST_DATABASE_URL points at an
// empty, throwaway database (the test drops and recreates the "mailer" schema).
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { PostgresStore } from './store';

const url = process.env.MAILER_TEST_DATABASE_URL;

describe.skipIf(!url)('PostgresStore', () => {
  it('converts a one-mailbox-per-provider table and keeps several addresses per member', async () => {
    const org = randomUUID();
    const user = randomUUID();
    const sql = postgres(url!, { onnotice: () => undefined });
    await sql`drop schema if exists mailer cascade`;
    await sql`create schema mailer`;
    await sql`create table mailer.mailboxes (
      org_id uuid not null, user_id uuid not null,
      provider text not null check (provider in ('gmail', 'outlook')),
      email text not null, display_name text, sealed_refresh_token text not null,
      scopes text[] not null default '{}', connected_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), primary key (org_id, user_id, provider))`;
    await sql`create table mailer.preferences (org_id uuid not null, user_id uuid not null,
      default_provider text check (default_provider in ('gmail', 'outlook')),
      primary key (org_id, user_id))`;
    await sql`insert into mailer.mailboxes (org_id, user_id, provider, email, sealed_refresh_token)
      values (${org}, ${user}, 'gmail', 'Old@Gmail.com', 'v1.x')`;
    await sql`insert into mailer.preferences values (${org}, ${user}, 'gmail')`;
    await sql.end();

    const store = await PostgresStore.open(url!);
    expect((await store.getMailbox(org, user, 'gmail:old@gmail.com'))?.email).toBe('old@gmail.com');
    expect(await store.getDefault(org, user)).toBe('gmail');
    const stamp = new Date().toISOString();
    const second = {
      orgId: org,
      userId: user,
      provider: 'gmail' as const,
      email: 'Second@gmail.com',
      displayName: null,
      sealedRefreshToken: 'v1.y',
      scopes: [],
      connectedAt: stamp,
      updatedAt: stamp,
    };
    await store.upsertMailbox(second);
    await store.upsertMailbox({ ...second, sealedRefreshToken: 'v1.z' });
    const list = await store.listMailboxes(org, user);
    expect(list.map((m) => m.email)).toEqual(['old@gmail.com', 'second@gmail.com']);
    expect(list[1]!.sealedRefreshToken).toBe('v1.z');
    expect(await store.findAddressOwners('gmail', 'SECOND@gmail.com')).toEqual([
      { orgId: org, userId: user },
    ]);
    await store.setDefault(org, user, 'gmail:second@gmail.com');
    expect(await store.getDefault(org, user)).toBe('gmail:second@gmail.com');
    await store.deleteMailbox(org, user, 'gmail:old@gmail.com');
    await store.close();

    const reopened = await PostgresStore.open(url!);
    expect(await reopened.listMailboxes(org, user)).toHaveLength(1);
    await reopened.close();
  });
});
