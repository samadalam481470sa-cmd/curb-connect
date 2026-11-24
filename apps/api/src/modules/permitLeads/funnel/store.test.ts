import { describe, expect, it } from 'vitest';
import { createMemoryFunnelStageStore } from './store';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

describe('memory funnel stage store', () => {
  it('starts every lead at new and allows the happy path', async () => {
    const store = createMemoryFunnelStageStore();
    expect(await store.getStages(ORG)).toEqual([]);
    expect(await store.setStage(ORG, 'austin:A-1', 'contacted')).toBe(true);
    expect(await store.setStage(ORG, 'austin:A-1', 'quoted')).toBe(true);
    expect(await store.setStage(ORG, 'austin:A-1', 'won')).toBe(true);
    const [row] = await store.getStages(ORG);
    expect(row).toMatchObject({ leadKey: 'austin:A-1', stage: 'won', callCount: 0 });
  });

  it('blocks illegal transitions and leaves the stage unchanged', async () => {
    const store = createMemoryFunnelStageStore();
    expect(await store.setStage(ORG, 'austin:A-1', 'won')).toBe(false);
    expect(await store.getStages(ORG)).toEqual([]);
    await store.setStage(ORG, 'austin:A-1', 'contacted');
    expect(await store.setStage(ORG, 'austin:A-1', 'won')).toBe(false);
    const [row] = await store.getStages(ORG);
    expect(row!.stage).toBe('contacted');
  });

  it('logging a call moves a new lead to contacted and records the note', async () => {
    const store = createMemoryFunnelStageStore();
    const call = await store.logCall(ORG, 'collin:C-1', 'answered', 'Owner wants a quote next week');
    expect(call).toMatchObject({ outcome: 'answered', note: 'Owner wants a quote next week' });
    const [stage] = await store.getStages(ORG);
    expect(stage).toMatchObject({
      leadKey: 'collin:C-1',
      stage: 'contacted',
      callCount: 1,
      lastNote: 'Owner wants a quote next week',
    });
    expect(await store.getCalls(ORG, 'collin:C-1')).toHaveLength(1);
  });

  it('rejects empty notes and unknown outcomes without storing anything', async () => {
    const store = createMemoryFunnelStageStore();
    expect(await store.logCall(ORG, 'collin:C-1', 'answered', '   ')).toBeNull();
    expect(await store.logCall(ORG, 'collin:C-1', 'maybe' as never, 'Hello')).toBeNull();
    expect(await store.getStages(ORG)).toEqual([]);
    expect(await store.getCalls(ORG, 'collin:C-1')).toEqual([]);
  });

  it('keeps companies isolated', async () => {
    const store = createMemoryFunnelStageStore();
    await store.setStage(ORG, 'austin:A-1', 'contacted');
    await store.logCall(OTHER_ORG, 'austin:A-1', 'voicemail', 'Left a message');
    expect(await store.getStages(ORG)).toHaveLength(1);
    expect(await store.getStages(OTHER_ORG)).toHaveLength(1);
    expect(await store.getCalls(ORG, 'austin:A-1')).toEqual([]);
  });

  it('lets a lost lead reopen to new', async () => {
    const store = createMemoryFunnelStageStore();
    await store.setStage(ORG, 'austin:A-1', 'lost');
    expect(await store.setStage(ORG, 'austin:A-1', 'new')).toBe(true);
  });
});
