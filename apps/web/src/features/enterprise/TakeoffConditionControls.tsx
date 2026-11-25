'use client';

import {
  EnterpriseTakeoffCondition,
  EnterpriseTakeoffConditionAssignment,
  EnterpriseTakeoffConditionAssignmentInput,
  EnterpriseTakeoffConditionInput,
  EnterpriseTakeoffConditionKind,
  EnterpriseTakeoffConditionWorkspace,
  type EnterpriseTakeoffTaggableMeasurement,
} from '@fieldline/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { TakeoffMeasurementReview } from './TakeoffMeasurementReview';

type Condition = z.infer<typeof EnterpriseTakeoffCondition>;
type Workspace = z.infer<typeof EnterpriseTakeoffConditionWorkspace>;
type Measurement = z.infer<typeof EnterpriseTakeoffTaggableMeasurement>;
type Assignment = z.infer<typeof EnterpriseTakeoffConditionAssignmentInput>;
const kindLabels = {
  floor: 'Floor',
  room: 'Room',
  material: 'Material',
  phase: 'Phase',
  trade: 'Trade',
  alternate: 'Alternate',
};
const quantity = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 8 });

function measurementLabel(row: Measurement) {
  const value = quantity.format(row.value);
  if (row.kind === 'count') return 'Count · ' + value + (row.value === 1 ? ' object' : ' objects');
  if (row.kind === 'area') return 'Area · ' + value + ' sq ' + row.unit;
  return 'Length · ' + value + ' ' + row.unit;
}

function message(cause: unknown) {
  if (cause instanceof z.ZodError) return cause.issues[0]?.message ?? 'Check the condition fields.';
  return isApiError(cause) && cause.kind !== 'network' ? cause.message : errorHint(cause);
}

export function TakeoffConditionControls({
  projectId,
  sheetPath,
  taxonomyPath,
  sheetId,
}: {
  projectId: string;
  sheetPath: string;
  taxonomyPath: string;
  sheetId: string;
}) {
  const path = sheetPath + '/conditions';
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = [...orgKey(session.orgId, 'enterprise'), 'takeoff-conditions', sheetId];
  const [floorId, setFloorId] = useState('');
  const [selected, setSelected] = useState<Measurement | null>(null);
  const list = useInfiniteQuery({
    queryKey: [...key, floorId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, {
        query: { cursor: pageParam, floorId: floorId || undefined },
        schema: EnterpriseTakeoffConditionWorkspace,
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const original = client.getQueryData<InfiniteData<Workspace>>([...key, '']);
  const taxonomy = list.data?.pages[0]?.conditions ?? original?.pages[0]?.conditions ?? [];
  const floors = taxonomy.filter((condition) => condition.kind === 'floor');
  const measurements = list.data?.pages.flatMap((page) => page.measurements) ?? [];
  const canWrite = session.can('estimate:write');
  const refresh = () => client.invalidateQueries({ queryKey: key });

  return (
    <section aria-label="Measurement conditions" className="enterprise-takeoff-calibration">
      <h4>Measurement conditions</h4>
      {canWrite && (
        <ConditionForm
          path={taxonomyPath}
          floors={floors}
          onSaved={() =>
            client.invalidateQueries({
              queryKey: [...orgKey(session.orgId, 'enterprise'), 'takeoff-conditions'],
            })
          }
        />
      )}
      {floors.length > 0 && (
        <label>
          Filter measurements by floor
          <select
            value={floorId}
            onChange={(event) => {
              setSelected(null);
              setFloorId(event.target.value);
            }}
          >
            <option value="">All floors</option>
            {floors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {floor.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {list.isPending && <p role="status">Loading measurements and conditions…</p>}
      {list.isError && (
        <div>
          <p role="alert" className="enterprise-error">
            {message(list.error)}
          </p>
          <button type="button" onClick={() => void list.refetch()}>
            Retry loading conditions
          </button>
        </div>
      )}
      {list.isSuccess && !measurements.length && (
        <p>
          {floorId
            ? 'No measurements are tagged to this floor.'
            : 'Save a measurement to assign its conditions.'}
        </p>
      )}
      {!!measurements.length && (
        <ul className="enterprise-change-history">
          {measurements.map((measurement) => (
            <li key={measurement.kind + ':' + measurement.id}>
              <strong>{measurementLabel(measurement)}</strong>
              {measurement.conditions.map((assignment) => {
                const condition = taxonomy.find(({ id }) => id === assignment.conditionId);
                const floor = taxonomy.find(({ id }) => id === assignment.floorId);
                const room = taxonomy.find(({ id }) => id === assignment.roomId);
                return (
                  <span key={assignment.id}>
                    {[
                      condition?.name,
                      floor?.id !== condition?.id ? floor?.name : null,
                      room?.id !== condition?.id ? room?.name : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                );
              })}
              {canWrite && selected?.id !== measurement.id && (
                <button
                  type="button"
                  aria-label={'Tag ' + measurementLabel(measurement)}
                  onClick={() => setSelected(measurement)}
                >
                  Apply condition
                </button>
              )}
              {selected?.id === measurement.id && (
                <AssignmentForm
                  key={measurement.id}
                  path={path}
                  measurement={selected}
                  taxonomy={taxonomy}
                  onCancel={() => {
                    setSelected(null);
                    void refresh();
                  }}
                  onSaved={async () => {
                    setSelected(null);
                    await refresh();
                  }}
                />
              )}
              <TakeoffMeasurementReview
                projectId={projectId}
                path={
                  sheetPath +
                  '/measurements/' +
                  measurement.kind +
                  '/' +
                  measurement.id +
                  '/reviews'
                }
                sheetId={sheetId}
                label={measurementLabel(measurement)}
              />
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <button
          type="button"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          Load more taggable measurements
        </button>
      )}
    </section>
  );
}

function ConditionForm({
  path,
  floors,
  onSaved,
}: {
  path: string;
  floors: Condition[];
  onSaved: () => Promise<void>;
}) {
  const { api } = useApi();
  const [kind, setKind] = useState<Condition['kind']>('floor');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const create = useMutation({
    mutationFn: (input: z.infer<typeof EnterpriseTakeoffConditionInput>) =>
      api.post(path, input, { schema: EnterpriseTakeoffCondition }),
    onSuccess: onSaved,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setError('');
    setSaved('');
    try {
      const body = EnterpriseTakeoffConditionInput.parse({
        kind,
        name: values.get('name'),
        parentFloorId: kind === 'room' ? values.get('parentFloorId') || null : null,
      });
      const result = await create.mutateAsync(body);
      const name = form.elements.namedItem('name');
      if (name instanceof HTMLInputElement) name.value = '';
      setSaved(kindLabels[result.kind] + ' added · ' + result.name);
    } catch (cause) {
      setError(message(cause));
    }
  }

  return (
    <details>
      <summary>Add a project condition</summary>
      <form className="enterprise-form" onSubmit={(event) => void submit(event)}>
        <label>
          Condition type
          <select
            value={kind}
            onChange={(event) => setKind(EnterpriseTakeoffConditionKind.parse(event.target.value))}
          >
            {EnterpriseTakeoffConditionKind.options.map((option) => (
              <option key={option} value={option}>
                {kindLabels[option]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Condition name <input name="name" required minLength={2} maxLength={100} />
        </label>
        {kind === 'room' && (
          <label>
            Parent floor
            <select name="parentFloorId" required defaultValue="">
              <option value="">Choose a floor</option>
              {floors.map((floor) => (
                <option key={floor.id} value={floor.id}>
                  {floor.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" disabled={create.isPending || (kind === 'room' && !floors.length)}>
          {create.isPending ? 'Adding condition…' : 'Add condition'}
        </button>
        {error && (
          <p role="alert" className="enterprise-error">
            {error}
          </p>
        )}
        {saved && <p role="status">{saved}</p>}
      </form>
    </details>
  );
}

function AssignmentForm({
  path,
  measurement,
  taxonomy,
  onCancel,
  onSaved,
}: {
  path: string;
  measurement: Measurement;
  taxonomy: Condition[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api } = useApi();
  const [conditionId, setConditionId] = useState('');
  const [floorId, setFloorId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState('');
  const floors = taxonomy.filter((condition) => condition.kind === 'floor');
  const rooms = taxonomy.filter(
    (condition) =>
      condition.kind === 'room' && (floorId === '' || condition.parentFloorId === floorId),
  );
  const apply = useMutation({
    mutationFn: (values: Assignment) =>
      api.post(path, values, {
        ifMatch: measurement.revision,
        schema: EnterpriseTakeoffConditionAssignment,
      }),
    onSuccess: onSaved,
  });
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      await apply.mutateAsync(
        EnterpriseTakeoffConditionAssignmentInput.parse({
          measurementKind: measurement.kind,
          measurementId: measurement.id,
          conditionId,
          floorId: floorId || null,
          roomId: roomId || null,
        }),
      );
    } catch (cause) {
      setError(message(cause));
    }
  }
  return (
    <form className="enterprise-form" onSubmit={(event) => void save(event)}>
      <label>
        Condition to apply
        <select
          value={conditionId}
          required
          onChange={(event) => {
            const id = event.target.value;
            setConditionId(id);
            const condition = taxonomy.find((entry) => entry.id === id);
            if (condition?.kind === 'floor') {
              setFloorId(condition.id);
              setRoomId('');
            }
            if (condition?.kind === 'room') {
              setFloorId(condition.parentFloorId ?? '');
              setRoomId(condition.id);
            }
          }}
        >
          <option value="">Choose a condition</option>
          {taxonomy.map((condition) => (
            <option key={condition.id} value={condition.id}>
              {kindLabels[condition.kind]} · {condition.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assignment floor (optional)
        <select
          value={floorId}
          onChange={(event) => {
            setFloorId(event.target.value);
            setRoomId('');
          }}
        >
          <option value="">No separate floor</option>
          {floors.map((floor) => (
            <option key={floor.id} value={floor.id}>
              {floor.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assignment room (optional)
        <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
          <option value="">No separate room</option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
      <div className="enterprise-actions">
        <button type="submit" disabled={apply.isPending || !conditionId}>
          {apply.isPending ? 'Applying condition…' : 'Save condition assignment'}
        </button>
        <button type="button" disabled={apply.isPending} onClick={onCancel}>
          Cancel assignment
        </button>
      </div>
    </form>
  );
}
