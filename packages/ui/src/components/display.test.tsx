import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell, BottomNav, Breadcrumbs, Sidebar, TopBar, WorkspaceSwitcher } from './AppShell';
import { ConfidenceLabel } from './ConfidenceLabel';
import { DataTable } from './DataTable';
import { ViewStateBoundary } from './EmptyState';
import { EstimateLayerSection } from './EstimateLayer';
import { ProvenanceBadge } from './ProvenanceBadge';
import { RiskNotice } from './RiskNotice';
import { StatusPill } from './StatusPill';
import { Stepper } from './Stepper';
import { Tabs } from './Tabs';
import { PROVENANCE_SOURCES, CONFIDENCE_LEVELS } from '../types';

afterEach(cleanup);

describe('Tabs', () => {
  it('supports arrow, Home and End keys with roving tabindex', () => {
    render(
      <Tabs
        label="Report sections"
        items={[
          { value: 'summary', label: 'Summary', panel: <p>Summary panel</p> },
          { value: 'pitch', label: 'Pitch', panel: <p>Pitch panel</p> },
          { value: 'notes', label: 'Notes', panel: <p>Notes panel</p> },
        ]}
      />,
    );
    const [summary, pitch, notes] = screen.getAllByRole('tab');
    expect(summary!.getAttribute('aria-selected')).toBe('true');
    expect(pitch!.tabIndex).toBe(-1);
    summary!.focus();
    fireEvent.keyDown(summary!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(pitch);
    expect(screen.getByRole('tabpanel', { name: 'Pitch' }).textContent).toBe('Pitch panel');
    fireEvent.keyDown(pitch!, { key: 'End' });
    expect(document.activeElement).toBe(notes);
    fireEvent.keyDown(notes!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(summary);
  });
});

describe('DataTable', () => {
  const rows = [
    { id: 'a', name: 'Front slope', area: 412 },
    { id: 'b', name: 'Back slope', area: null },
    { id: 'c', name: 'Dormer', area: 38 },
  ];
  const columns = [
    {
      id: 'name',
      header: 'Facet',
      cell: (r: (typeof rows)[number]) => r.name,
      primary: true,
      sortValue: (r: (typeof rows)[number]) => r.name,
    },
    {
      id: 'area',
      header: 'Area (sq ft)',
      cell: (r: (typeof rows)[number]) => (r.area === null ? 'Unknown' : String(r.area)),
      sortValue: (r: (typeof rows)[number]) => r.area,
      align: 'end' as const,
    },
  ];

  it('is a captioned table with sortable headers and unknowns last', () => {
    render(<DataTable caption="Facets" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const table = screen.getByRole('table', { name: 'Facets' });
    const sortArea = within(table).getByRole('button', { name: /Area/ });
    fireEvent.click(sortArea);
    const header = sortArea.closest('th')!;
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    let names = within(table)
      .getAllByRole('rowheader')
      .map((c) => c.textContent);
    expect(names).toEqual(['Dormer', 'Front slope', 'Back slope']);
    fireEvent.click(sortArea);
    expect(header.getAttribute('aria-sort')).toBe('descending');
    names = within(table)
      .getAllByRole('rowheader')
      .map((c) => c.textContent);
    expect(names).toEqual(['Front slope', 'Dormer', 'Back slope']);
    expect(within(table).getAllByRole('cell')[0]!.getAttribute('data-label')).toBe('Area (sq ft)');
  });

  it('renders loading, empty, error and permission-denied variants', () => {
    const retry = vi.fn();
    const { rerender } = render(
      <DataTable caption="Jobs" columns={columns} rows={[]} rowKey={(r) => r.id} />,
    );
    expect(screen.getByRole('heading', { name: 'Nothing here yet' })).toBeTruthy();
    rerender(
      <DataTable
        caption="Jobs"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        state={{ status: 'loading' }}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('Loading');
    rerender(
      <DataTable
        caption="Jobs"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        state={{
          status: 'error',
          message: 'Server unavailable',
          correlationId: 'req-9',
          onRetry: retry,
        }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('req-9');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
    rerender(
      <DataTable
        caption="Jobs"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        state={{ status: 'permission_denied' }}
      />,
    );
    expect(screen.getByRole('heading', { name: /do not have access/ })).toBeTruthy();
  });
});

describe('status and trust components', () => {
  it('StatusPill spells out state as text', () => {
    render(<StatusPill machine="job" status="review_required" />);
    expect(document.body.textContent?.length).toBeGreaterThan(0);
  });

  it('every provenance source and confidence level renders a text label', () => {
    render(
      <>
        {PROVENANCE_SOURCES.map((s) => (
          <ProvenanceBadge key={s} source={s} />
        ))}
        {CONFIDENCE_LEVELS.map((l) => (
          <ConfidenceLabel key={l} level={l} />
        ))}
      </>,
    );
    expect(document.body.textContent).toMatch(/field verified/i);
    expect(document.body.textContent).toMatch(/unavailable/i);
  });

  it('RiskNotice is a labelled note with no dismiss control', () => {
    render(<RiskNotice kind="permit">Permit status unknown.</RiskNotice>);
    const note = screen.getByRole('note');
    expect(note.getAttribute('aria-labelledby')).toBeTruthy();
    expect(within(note).queryByRole('button')).toBeNull();
  });

  it('estimate layers are separate labelled regions with text markers', () => {
    render(
      <>
        <EstimateLayerSection layer="measured">a</EstimateLayerSection>
        <EstimateLayerSection layer="suggested">b</EstimateLayerSection>
        <EstimateLayerSection layer="assumption">c</EstimateLayerSection>
        <EstimateLayerSection layer="approved">d</EstimateLayerSection>
      </>,
    );
    const regions = screen.getAllByRole('region');
    expect(regions.map((r) => r.getAttribute('data-layer'))).toEqual([
      'measured',
      'suggested',
      'assumption',
      'approved',
    ]);
    expect(screen.getByRole('region', { name: /Pricing assumptions/ })).toBeTruthy();
  });

  it('Stepper marks the current step', () => {
    render(
      <Stepper
        label="Estimate progress"
        steps={[
          { id: '1', label: 'Measure', state: 'complete' },
          { id: '2', label: 'Price', state: 'current' },
          { id: '3', label: 'Dispatch', state: 'blocked', blockedReason: 'Utility locate missing' },
        ]}
      />,
    );
    const items = within(
      screen.getByRole('navigation', { name: 'Estimate progress' }),
    ).getAllByRole('listitem');
    expect(items[1]!.getAttribute('aria-current')).toBe('step');
    expect(items[2]!.textContent).toContain('Utility locate missing');
  });

  it('ViewStateBoundary renders children only when ready', () => {
    render(<ViewStateBoundary state={{ status: 'ready' }}>content</ViewStateBoundary>);
    expect(screen.getByText('content')).toBeTruthy();
  });
});

describe('AppShell', () => {
  it('provides a skip link, landmarks, current page and unavailable items', () => {
    const onSwitch = vi.fn();
    const items = [
      { id: 'jobs', label: 'Jobs', href: '/jobs', current: true },
      {
        id: 'reports',
        label: 'Reports',
        href: '/reports',
        unavailableReason: 'Not enabled for this workspace',
      },
    ];
    render(
      <AppShell
        topBar={
          <TopBar
            start={
              <WorkspaceSwitcher
                currentId="a"
                onSwitch={onSwitch}
                workspaces={[
                  { id: 'a', name: 'North Crew' },
                  { id: 'b', name: 'South Crew' },
                ]}
              />
            }
            end={<Breadcrumbs items={[{ label: 'Jobs', href: '/jobs' }, { label: 'Job 14' }]} />}
          />
        }
        sidebar={<Sidebar items={items} />}
        bottomNav={<BottomNav items={items} label="Phone" />}
      >
        body
      </AppShell>,
    );
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe(
      '#fl-main',
    );
    expect(screen.getByRole('main')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Jobs' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(within(nav).queryByRole('link', { name: /Reports/ })).toBeNull();
    expect(screen.getByText('Job 14').getAttribute('aria-current')).toBe('page');

    const trigger = screen.getByRole('button', { name: /Switch workspace/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'South Crew' }));
    expect(onSwitch).toHaveBeenCalledWith('b');
    expect(document.activeElement).toBe(trigger);
  });
});
