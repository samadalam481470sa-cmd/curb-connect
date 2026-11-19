'use client';

// AI Home Builder projects (saved, versioned designs). Creates a preliminary concept from a free-text
// brief, lists saved projects, shows each version's deterministic checks and assumptions, exports the
// latest version as IFC, and imports an IFC file as a new project. Preliminary only: not permit-ready.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { useApi, useSession, orgKey } from '../../lib/session';
import { z } from 'zod';

const Project = z.object({
  id: z.string(),
  name: z.string(),
  brief: z.string(),
  targetAreaSqFt: z.number(),
  budgetCents: z.number(),
  createdAt: z.string(),
});
const ProjectList = z.array(Project);
const Issue = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  message: z.string(),
});
const VersionSummary = z.object({
  versionNumber: z.number(),
  issues: z.array(Issue),
  assumptions: z.array(z.string()),
  createdAt: z.string(),
});
const Detail = z.object({ project: Project, versions: z.array(VersionSummary) });
const Created = z.object({ project: Project, version: VersionSummary.extend({ design: z.unknown() }) });
const ImportResult = z.object({ project: Project, warnings: z.array(z.string()) });

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function HomeProjectsView() {
  return (
    <RouteGate routeId="build">
      <HomeProjectsInner />
    </RouteGate>
  );
}

function HomeProjectsInner() {
  const { api } = useApi();
  const session = useSession();
  const orgId = session.orgId;
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [brief, setBrief] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const projects = useQuery({
    queryKey: orgKey(orgId, 'home-projects'),
    queryFn: () => api.get('/v1/home/projects', { schema: ProjectList }),
  });

  const detail = useQuery({
    queryKey: orgKey(orgId, 'home-project', selected),
    queryFn: () => api.get(`/v1/home/projects/${selected}`, { schema: Detail }),
    enabled: !!selected,
  });

  const create = useMutation({
    mutationFn: (): Promise<z.output<typeof Created>> =>
      api.post('/v1/home/projects', { name, brief }, { schema: Created }),
    onSuccess: async (result) => {
      setNotice(`Created “${result.project.name}” with a preliminary version 1. Review the checks before relying on it.`);
      setName('');
      setBrief('');
      setSelected(result.project.id);
      await queryClient.invalidateQueries({ queryKey: orgKey(orgId, 'home-projects') });
    },
    onError: (error) => setNotice(errorHint(error)),
  });

  const importIfc = useMutation({
    mutationFn: (text: string): Promise<z.output<typeof ImportResult>> =>
      api.post('/v1/home/import-ifc', { ifc: text }, { schema: ImportResult }),
    onSuccess: async (result) => {
      const warn = result.warnings.length ? ` ${result.warnings.length} wall(s) could not be read.` : '';
      setNotice(`Imported “${result.project.name}”.${warn}`);
      setSelected(result.project.id);
      await queryClient.invalidateQueries({ queryKey: orgKey(orgId, 'home-projects') });
    },
    onError: (error) => setNotice(errorHint(error)),
  });

  function onCreate(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    create.mutate();
  }

  async function onImportFile(file: File | undefined) {
    if (!file) return;
    setNotice(null);
    if (file.size > 5 * 1024 * 1024) {
      setNotice('IFC file is larger than 5 MB.');
      return;
    }
    importIfc.mutate(await file.text());
  }

  const latest = detail.data?.versions[0];

  return (
    <main className="home-projects" style={{ padding: 16, display: 'grid', gap: 16, maxWidth: 1100 }}>
      <header>
        <a href="/build" style={{ fontSize: 14 }}>← House Builder</a>
        <h1 style={{ margin: '4px 0 0' }}>Home projects</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--muted, #555)' }}>
          Preliminary concepts from a brief, saved as versions. Not a permit-ready or engineered design.
        </p>
      </header>

      {notice && (
        <div role="status" style={{ padding: 12, borderRadius: 8, background: 'var(--surface-2, #f3f4f6)' }}>
          {notice}
        </div>
      )}

      <section style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <form onSubmit={onCreate} aria-label="New home project" style={{ display: 'grid', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>New from brief</h2>
          <label style={{ display: 'grid', gap: 4 }}>
            Project name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            Brief
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              required
              maxLength={4000}
              rows={4}
              placeholder="e.g. 4,500 sq ft, two-story, five bedrooms, four baths, three-car garage, $950,000 in Texas"
            />
          </label>
          <button type="submit" disabled={create.isPending || !name.trim() || !brief.trim()}>
            {create.isPending ? 'Planning…' : 'Create preliminary design'}
          </button>
        </form>

        <div style={{ display: 'grid', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Import IFC</h2>
          <p style={{ margin: 0, fontSize: 14 }}>Imports walls and storeys. Openings and slabs are not imported.</p>
          <input
            type="file"
            accept=".ifc,application/x-step"
            aria-label="Choose an IFC file"
            disabled={importIfc.isPending}
            onChange={(e) => void onImportFile(e.target.files?.[0])}
          />
        </div>
      </section>

      <section style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <div>
          <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Saved projects</h2>
          {projects.isPending && <p>Loading…</p>}
          {projects.isError && <p role="alert">{errorHint(projects.error)}</p>}
          {projects.data?.length === 0 && <p>No projects yet.</p>}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {projects.data?.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={selected === p.id}
                  onClick={() => setSelected(p.id)}
                  style={{ width: '100%', textAlign: 'left', fontWeight: selected === p.id ? 700 : 400 }}
                >
                  {p.name}
                  <span style={{ display: 'block', fontSize: 13, color: 'var(--muted, #555)' }}>
                    {p.targetAreaSqFt.toLocaleString('en-US')} sq ft · budget {usd.format(p.budgetCents / 100)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div aria-live="polite">
          {!selected && <p>Select a project to see its versions and checks.</p>}
          {selected && detail.isPending && <p>Loading project…</p>}
          {selected && detail.isError && <p role="alert">{errorHint(detail.error)}</p>}
          {detail.data && (
            <article style={{ display: 'grid', gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{detail.data.project.name}</h2>
              {detail.data.project.brief && <p style={{ margin: 0 }}>{detail.data.project.brief}</p>}
              {latest ? (
                <>
                  <a
                    href={`/v1/home/projects/${detail.data.project.id}/export.ifc`}
                    download
                    style={{ justifySelf: 'start' }}
                  >
                    Download latest as IFC (v{latest.versionNumber})
                  </a>
                  <h3 style={{ margin: '6px 0 0', fontSize: 15 }}>Checks (v{latest.versionNumber})</h3>
                  {latest.issues.length === 0 ? (
                    <p style={{ margin: 0 }}>No issues found by the deterministic checks.</p>
                  ) : (
                    <ul>
                      {latest.issues.map((issue, i) => (
                        <li key={`${issue.code}-${i}`}>
                          <strong>{issue.severity}</strong>: {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  <h3 style={{ margin: '6px 0 0', fontSize: 15 }}>Assumptions</h3>
                  {latest.assumptions.length === 0 ? (
                    <p style={{ margin: 0 }}>None recorded.</p>
                  ) : (
                    <ul>
                      {latest.assumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p>No versions yet.</p>
              )}
              <p style={{ fontSize: 13, color: 'var(--muted, #555)' }}>
                {detail.data.versions.length} version(s). Engineering, permits and final pricing still require a qualified review.
              </p>
            </article>
          )}
        </div>
      </section>
    </main>
  );
}
