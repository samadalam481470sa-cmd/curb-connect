// State machines as data (STR-006, CP-056, OPS-062): each machine is a transition table the API
// enforces on every status change and the web app reads to decide which actions to offer.
// Transitions are stored as events (roof_order_events, job_events, ...) with the actor and inputs.

export interface StateMachineDefinition<S extends string> {
  /** Machine name, used in error messages and audit events. */
  name: string;
  states: readonly S[];
  initial: S;
  /** Allowed next states for every state. Terminal states map to an empty list. */
  transitions: { readonly [K in S]: readonly S[] };
}

export interface StateMachine<S extends string> extends StateMachineDefinition<S> {
  terminal: readonly S[];
  canTransition(from: S, to: S): boolean;
  /** Throws InvalidTransitionError when `from -> to` is not in the table. */
  assertTransition(from: S, to: S): void;
  nextStates(from: S): readonly S[];
  isTerminal(state: S): boolean;
  isState(value: string): value is S;
}

export class InvalidTransitionError extends Error {
  readonly machine: string;
  readonly from: string;
  readonly to: string;
  /** Maps to the `invalid_transition` problem code. */
  readonly code = 'invalid_transition' as const;

  constructor(machine: string, from: string, to: string) {
    super(`${machine}: transition ${from} -> ${to} is not allowed`);
    this.name = 'InvalidTransitionError';
    this.machine = machine;
    this.from = from;
    this.to = to;
  }
}

/**
 * Validates and freezes a definition: every state has an entry, every target is a known state,
 * no self-transitions (a no-op is not an event) and every state is reachable from `initial`.
 */
export function defineStateMachine<const S extends string>(
  definition: StateMachineDefinition<S>,
): StateMachine<S> {
  const known = new Set<string>(definition.states);
  if (known.size !== definition.states.length) {
    throw new Error(`${definition.name}: duplicate state names`);
  }
  if (!known.has(definition.initial)) {
    throw new Error(`${definition.name}: initial state ${definition.initial} is not a state`);
  }
  for (const state of definition.states) {
    const targets = definition.transitions[state];
    if (!targets) throw new Error(`${definition.name}: no transition entry for ${state}`);
    for (const target of targets) {
      if (!known.has(target)) throw new Error(`${definition.name}: unknown target ${target}`);
      if (target === state) throw new Error(`${definition.name}: self-transition on ${state}`);
    }
  }
  for (const key of Object.keys(definition.transitions)) {
    if (!known.has(key)) throw new Error(`${definition.name}: transition key ${key} is not a state`);
  }
  const reachable = new Set<string>([definition.initial]);
  const queue: S[] = [definition.initial];
  while (queue.length > 0) {
    const current = queue.shift() as S;
    for (const next of definition.transitions[current]) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  const unreachable = definition.states.filter((s) => !reachable.has(s));
  if (unreachable.length > 0) {
    throw new Error(`${definition.name}: unreachable states ${unreachable.join(', ')}`);
  }

  const terminal = definition.states.filter((s) => definition.transitions[s].length === 0);
  const machine: StateMachine<S> = {
    ...definition,
    terminal,
    canTransition: (from, to) => definition.transitions[from]?.includes(to) ?? false,
    assertTransition(from, to) {
      if (!machine.canTransition(from, to)) {
        throw new InvalidTransitionError(definition.name, from, to);
      }
    },
    nextStates: (from) => definition.transitions[from] ?? [],
    isTerminal: (state) => definition.transitions[state]?.length === 0,
    isState: (value): value is S => known.has(value),
  };
  return Object.freeze(machine);
}
