// Schema integration tests against fieldline_test (BE-074 G): migrations apply, composite tenant
// FKs reject cross-tenant references, RLS hides other orgs' rows for the restricted app role,
// append-only and locked-version triggers hold, unique constraints hold. Each test runs inside a
// transaction that is rolled back, so the test database is left unchanged.
import { randomUUID } from 'node:crypto';
import postgres, { type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Tx = TransactionSql<Record<string, never>>;
class Rollback extends Error {}

let sql: postgres.Sql;

beforeAll(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  sql = postgres(url, { max: 1, onnotice: () => {} });
});

afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      await fn(tx as unknown as Tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** Runs fn in a savepoint and returns the Postgres error code it raised (or null). */
async function pgErrorCode(tx: Tx, fn: (sp: Tx) => Promise<unknown>): Promise<string | null> {
  try {
    await tx.savepoint(async (sp) => {
      await fn(sp as unknown as Tx);
    });
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
}

async function createOrg(tx: Tx): Promise<string> {
  const id = randomUUID();
  await tx`insert into organizations (id, slug, legal_name, display_name)
           values (${id}, ${`test-${id}`}, 'Test Org (fictional)', 'Test Org')`;
  return id;
}

async function createProperty(tx: Tx, orgId: string): Promise<string> {
  const id = randomUUID();
  await tx`insert into properties (id, org_id, original_query, location, is_fictional)
           values (${id}, ${orgId}, '1 Example Lane, Fictionville', 'SRID=4326;POINT(0.001 0.001)', true)`;
  return id;
}

async function createApprovedRevision(tx: Tx, orgId: string): Promise<string> {
  const bookId = randomUUID();
  const revId = randomUUID();
  await tx`insert into price_books (id, org_id, name, product_line) values (${bookId}, ${orgId}, ${`book ${bookId}`}, 'curb')`;
  await tx`insert into price_book_revisions (id, org_id, price_book_id, revision_number) values (${revId}, ${orgId}, ${bookId}, 1)`;
  await tx`insert into price_items (org_id, price_book_revision_id, code, label, category, cost_component, unit, unit_rate)
           values (${orgId}, ${revId}, 'CUT_LF', 'Saw cutting', 'labor', 'cutting', 'linear_ft', '20')`;
  await tx`update price_book_revisions set status = 'approved' where id = ${revId}`;
  return revId;
}

describe('migrations', () => {
  it('applied every migration in drizzle/', async () => {
    const rows = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(rows[0]!.n).toBeGreaterThanOrEqual(3);
  });

  it('created the core tables with PostGIS columns', async () => {
    const rows = await sql`
      select table_name, udt_name from information_schema.columns
      where table_schema = 'public' and column_name in ('location', 'boundary') order by table_name`;
    const byTable = Object.fromEntries(rows.map((r) => [r.table_name, r.udt_name]));
    expect(byTable.properties).toBe('geography');
    expect(byTable.jurisdictions).toBe('geometry');
    expect(byTable.service_areas).toBe('geometry');
  });

  it('enables and forces RLS on every table with org_id', async () => {
    const rows = await sql`
      select c.relname from pg_class c
      join information_schema.columns col on col.table_name = c.relname and col.table_schema = 'public'
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and col.column_name = 'org_id'
        and not (c.relrowsecurity and c.relforcerowsecurity)`;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('has a restricted app role that cannot bypass RLS', async () => {
    const rows = await sql`select rolsuper, rolbypassrls from pg_roles where rolname = 'fieldline_app'`;
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe('tenant isolation', () => {
  it('rejects a cross-tenant composite foreign key', async () => {
    await inRollback(async (tx) => {
      const orgA = await createOrg(tx);
      const orgB = await createOrg(tx);
      const propertyB = await createProperty(tx, orgB);
      const code = await pgErrorCode(
        tx,
        (sp) => sp`insert into structures (org_id, property_id, label) values (${orgA}, ${propertyB}, 'Main')`,
      );
      expect(code).toBe('23503');
      // Same-tenant reference works.
      const ok = await pgErrorCode(
        tx,
        (sp) => sp`insert into structures (org_id, property_id, label) values (${orgB}, ${propertyB}, 'Main')`,
      );
      expect(ok).toBeNull();
    });
  });

  it('RLS hides other orgs rows and blocks cross-org writes for fieldline_app', async () => {
    await inRollback(async (tx) => {
      const orgA = await createOrg(tx);
      const orgB = await createOrg(tx);
      const propA = await createProperty(tx, orgA);
      await createProperty(tx, orgB);

      await tx`set local role fieldline_app`;
      const none = await tx`select id from properties`;
      expect(none).toHaveLength(0); // no app.org_id -> nothing visible

      await tx`select set_config('app.org_id', ${orgA}, true)`;
      const visible = await tx`select id, org_id from properties`;
      expect(visible.map((r) => r.id)).toEqual([propA]);
      const orgs = await tx`select id from organizations`;
      expect(orgs.map((r) => r.id)).toEqual([orgA]);

      const code = await pgErrorCode(
        tx,
        (sp) => sp`insert into properties (org_id, original_query) values (${orgB}, 'x')`,
      );
      expect(code).toBe('42501');
      const updated = await tx`update properties set label = 'hijack' where org_id = ${orgB} returning id`;
      expect(updated).toHaveLength(0);
    });
  });
});

describe('append-only and immutable records', () => {
  it('audit_events cannot be updated or deleted', async () => {
    await inRollback(async (tx) => {
      const orgId = await createOrg(tx);
      const [row] = await tx`insert into audit_events (org_id, actor_type, action, resource_type)
                             values (${orgId}, 'system', 'test.created', 'test') returning id`;
      expect(await pgErrorCode(tx, (sp) => sp`update audit_events set action = 'x' where id = ${row!.id}`)).toBe('FL001');
      expect(await pgErrorCode(tx, (sp) => sp`delete from audit_events where id = ${row!.id}`)).toBe('FL001');
    });
  });

  it('approved price book revisions and their items are immutable', async () => {
    await inRollback(async (tx) => {
      const orgId = await createOrg(tx);
      const revId = await createApprovedRevision(tx, orgId);
      expect(
        await pgErrorCode(tx, (sp) => sp`update price_book_revisions set overhead_rate = '0.5' where id = ${revId}`),
      ).toBe('FL002');
      expect(await pgErrorCode(tx, (sp) => sp`delete from price_book_revisions where id = ${revId}`)).toBe('FL002');
      expect(
        await pgErrorCode(tx, (sp) => sp`update price_items set unit_rate = '1' where price_book_revision_id = ${revId}`),
      ).toBe('FL002');
      expect(
        await pgErrorCode(
          tx,
          (sp) => sp`insert into price_items (org_id, price_book_revision_id, code, label, category, cost_component, unit)
                     values (${orgId}, ${revId}, 'NEW', 'New', 'fee', 'other_allowance', 'each')`,
        ),
      ).toBe('FL002');
      // Lifecycle moves remain possible.
      expect(
        await pgErrorCode(tx, (sp) => sp`update price_book_revisions set status = 'retired' where id = ${revId}`),
      ).toBeNull();
    });
  });

  it('estimate revisions are immutable snapshots', async () => {
    await inRollback(async (tx) => {
      const orgId = await createOrg(tx);
      const revId = await createApprovedRevision(tx, orgId);
      const propertyId = await createProperty(tx, orgId);
      const [project] = await tx`insert into curb_projects (org_id, number, property_id, service_code)
                                 values (${orgId}, 'CP-1', ${propertyId}, 'driveway_opening') returning id`;
      const [estimate] = await tx`insert into estimates (org_id, number, product_line, curb_project_id)
                                  values (${orgId}, 'E-1', 'curb', ${project!.id}) returning id`;
      const [er] = await tx`
        insert into estimate_revisions (org_id, estimate_id, revision_number, status, price_book_revision_id,
          inputs, scenarios, lines, subtotal_minor, total_minor, low_total_minor, high_total_minor,
          engine_version, gating_result, quote_kind)
        values (${orgId}, ${estimate!.id}, 1, 'review_required', ${revId}, '{}', '{}', '[]',
          549120, 549120, 500000, 600000, 'test-1', '{"blockers":[]}', 'budgetary_range')
        returning id`;
      expect(await pgErrorCode(tx, (sp) => sp`update estimate_revisions set total_minor = 1 where id = ${er!.id}`)).toBe('FL001');
      // A non-firm revision can never be binding (check constraint).
      expect(
        await pgErrorCode(
          tx,
          (sp) => sp`
            insert into estimate_revisions (org_id, estimate_id, revision_number, status, price_book_revision_id,
              inputs, scenarios, lines, subtotal_minor, total_minor, low_total_minor, high_total_minor,
              engine_version, gating_result, quote_kind, is_binding)
            values (${orgId}, ${estimate!.id}, 2, 'review_required', ${revId}, '{}', '{}', '[]',
              1, 1, 1, 1, 'test-1', '{}', 'budgetary_range', true)`,
        ),
      ).toBe('23514');
    });
  });

  it('submitted roof report versions and their facets are immutable; drafts are editable', async () => {
    await inRollback(async (tx) => {
      const orgId = await createOrg(tx);
      const propertyId = await createProperty(tx, orgId);
      const [order] = await tx`insert into roof_orders (org_id, number, property_id, mode)
                               values (${orgId}, 'RO-1', ${propertyId}, 'diy') returning id`;
      const [report] = await tx`insert into roof_reports (org_id, roof_order_id) values (${orgId}, ${order!.id}) returning id`;
      const [v] = await tx`insert into roof_report_versions (org_id, roof_report_id, version_number)
                           values (${orgId}, ${report!.id}, 1) returning id`;
      await tx`insert into roof_facets (org_id, report_version_id, key, vertex_keys) values (${orgId}, ${v!.id}, 'f1', '{a,b,c}')`;
      expect(await pgErrorCode(tx, (sp) => sp`update roof_report_versions set geometry = '{}' where id = ${v!.id}`)).toBeNull();
      await tx`update roof_report_versions set status = 'submitted' where id = ${v!.id}`;
      expect(
        await pgErrorCode(tx, (sp) => sp`update roof_report_versions set geometry = '{"x":1}' where id = ${v!.id}`),
      ).toBe('FL002');
      expect(
        await pgErrorCode(tx, (sp) => sp`update roof_facets set label = 'x' where report_version_id = ${v!.id}`),
      ).toBe('FL002');
      expect(
        await pgErrorCode(tx, (sp) => sp`update roof_report_versions set status = 'approved' where id = ${v!.id}`),
      ).toBeNull();
    });
  });
});

describe('unique constraints', () => {
  it('external identities are unique per (issuer, subject)', async () => {
    await inRollback(async (tx) => {
      const [u] = await tx`insert into users (display_name) values ('Test user') returning id`;
      const subject = randomUUID();
      await tx`insert into external_identities (user_id, provider, issuer, subject) values (${u!.id}, 'dev_idp', 'http://idp.test', ${subject})`;
      expect(
        await pgErrorCode(
          tx,
          (sp) => sp`insert into external_identities (user_id, provider, issuer, subject) values (${u!.id}, 'dev_idp', 'http://idp.test', ${subject})`,
        ),
      ).toBe('23505');
    });
  });

  it('media sha256 is unique per org, not globally', async () => {
    await inRollback(async (tx) => {
      const orgA = await createOrg(tx);
      const orgB = await createOrg(tx);
      const insert = (sp: Tx, orgId: string) => sp`
        insert into media_assets (org_id, owner_type, owner_id, original_object_key, sha256, mime_type, size_bytes)
        values (${orgId}, 'organization', ${orgId}, ${randomUUID()}, 'abc123', 'image/jpeg', 10)`;
      expect(await pgErrorCode(tx, (sp) => insert(sp, orgA))).toBeNull();
      expect(await pgErrorCode(tx, (sp) => insert(sp, orgA))).toBe('23505');
      expect(await pgErrorCode(tx, (sp) => insert(sp, orgB))).toBeNull();
    });
  });

  it('memberships are unique per (org, user)', async () => {
    await inRollback(async (tx) => {
      const orgId = await createOrg(tx);
      const [u] = await tx`insert into users (display_name) values ('Member') returning id`;
      await tx`insert into memberships (org_id, user_id, role) values (${orgId}, ${u!.id}, 'owner')`;
      expect(
        await pgErrorCode(tx, (sp) => sp`insert into memberships (org_id, user_id, role) values (${orgId}, ${u!.id}, 'admin')`),
      ).toBe('23505');
    });
  });
});
