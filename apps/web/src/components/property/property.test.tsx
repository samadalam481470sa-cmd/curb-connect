// RF-017-QA / RF-024-QA (FE): address autocomplete never auto-picks among several matches, shows
// provenance and the synthetic label, structure scope must be decided per building before the
// property is confirmed, the pin can be moved without the map (keyboard/no-WebGL path), and the
// save state is honest.
import type { AddressCandidate } from '@fieldline/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AddressSearch } from './AddressSearch';
import { PropertyConfirm } from './PropertyConfirm';
import type { PropertyApi } from './types';

const ORG = '11111111-1111-4111-8111-111111111111';
const square = { type: 'Polygon' as const, coordinates: [[[0, 0], [0.0001, 0], [0.0001, 0.0001], [0, 0.0001], [0, 0]]] as [number, number][][] };

const campus: AddressCandidate = {
  provider: 'fixture',
  placeId: 'fixture:200-campus-loop',
  label: '200 Campus Loop, Testville',
  address: { line1: '200 Campus Loop', locality: 'Testville', countryCode: 'US' },
  location: { type: 'Point', coordinates: [0.02, 0.02] },
  confidence: 0.93,
  precision: 'rooftop',
  attribution: 'Synthetic fixture geocoder',
  storable: true,
  isSynthetic: true,
  structures: [
    { ref: 'a', label: 'Building A', kind: 'main_house', footprint: square, detectionConfidence: 0.88 },
    { ref: 'b', label: 'Detached garage', kind: 'detached_garage', footprint: square, detectionConfidence: 0.62 },
  ],
};

function property(over: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: '44444444-4444-4444-8444-444444444444',
    orgId: ORG,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    label: null,
    originalQuery: '200 Campus Loop',
    address: campus.address,
    normalizedAddress: campus.label,
    geocoder: { provider: 'fixture', placeId: campus.placeId, confidence: 0.93 },
    location: campus.location,
    confirmedLocation: null,
    needsReview: true,
    reviewReason: 'confirm_structures_in_scope',
    parcelId: null,
    jurisdictionId: null,
    jurisdiction: { status: 'resolved', jurisdictionId: null, candidates: [], manualVerificationRequired: false },
    scopeConfirmedAt: null,
    isFictional: true,
    structures: ['55555555-5555-4555-8555-555555555551', '55555555-5555-4555-8555-555555555552'].map((id, i) => ({
      id,
      orgId: ORG,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      propertyId: '44444444-4444-4444-8444-444444444444',
      label: i ? 'Detached garage' : 'Building A',
      kind: i ? 'detached_garage' : 'main_house',
      scopeStatus: 'included',
      footprint: null,
      stories: null,
    })),
    ...over,
  };
}

describe('AddressSearch', () => {
  it('lists every match with provenance and never picks one by itself', async () => {
    const onSelect = vi.fn();
    const api = {
      get: vi.fn().mockResolvedValue({ candidates: [campus, { ...campus, placeId: 'other', label: '200 Campus Loop, Otherville' }] }),
      post: vi.fn(),
    } as unknown as PropertyApi;
    render(<AddressSearch api={api} onSelect={onSelect} debounceMs={0} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '200 Campus' } });
    expect(await screen.findByText('200 Campus Loop, Otherville')).toBeTruthy();
    expect(screen.getByText(/2 matches/)).toBeTruthy();
    expect(screen.getAllByText(/Synthetic test data/).length).toBe(2);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ placeId: campus.placeId }), '200 Campus');
  });
});

describe('PropertyConfirm', () => {
  it('requires a decision for every building, then creates the property and confirms scope', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(property())
      .mockResolvedValueOnce({ receipt: { server_revision: 2 }, property: property({ revision: 2, scopeConfirmedAt: new Date().toISOString() }) });
    const api = { get: vi.fn(), post } as unknown as PropertyApi;
    const onConfirmed = vi.fn();
    render(<PropertyConfirm api={api} query="200 Campus Loop" candidate={campus} onConfirmed={onConfirmed} />);
    const button = screen.getByRole('button', { name: 'Confirm property' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/2 building\(s\) still need a decision/)).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText('In scope')[0]!);
    fireEvent.click(screen.getAllByLabelText('Not in scope')[1]!);
    // Keyboard / no-WebGL path: move the pin by coordinates.
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '0.0201' } });
    expect(screen.getByText(/original search result is kept/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm property' }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(post.mock.calls[0]![0]).toBe('/v1/properties');
    expect(post.mock.calls[0]![1]).toMatchObject({ originalQuery: '200 Campus Loop', confirmedLocation: { coordinates: [0.0201, 0.02] } });
    expect(post.mock.calls[1]![0]).toMatch(/\/scope$/);
    expect(post.mock.calls[1]![1].structures.map((s: { scopeStatus: string }) => s.scopeStatus)).toEqual(['included', 'excluded']);
    expect(screen.getByText('Saved to server')).toBeTruthy();
    expect(screen.getByText(/Shown for orientation only/)).toBeTruthy();
  });

  it('a failed save keeps the draft and says so', async () => {
    const api = { get: vi.fn(), post: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as PropertyApi;
    render(<PropertyConfirm api={api} query="200 Campus Loop" candidate={{ ...campus, structures: [] }} onConfirmed={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm property' }));
    expect(await screen.findByText(/Save failed — draft retained/)).toBeTruthy();
  });
});
