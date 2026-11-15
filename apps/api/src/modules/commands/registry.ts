// Typed command registry (COS starter C, ADD-014). Modules register one handler per command type at
// import time; POST /v1/commands and the typed resource endpoints both dispatch through
// executeCommand() (./pipeline.ts), so every write shares one pipeline: authenticate -> internal
// user -> tenant + resource membership -> validate -> receipt lookup -> revision check -> one
// transaction (aggregate + audit + outbox + receipt) -> receipt.
import { type Action, COMMAND_PAYLOADS, type CommandType } from '@fieldline/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Tx } from '../../db/runtime';

export interface CommandContext {
  request: FastifyRequest;
  tx: Tx;
  orgId: string;
  userId: string;
  membershipId: string;
  now: Date;
  correlationId: string;
}

export interface FieldDiff {
  field: string;
  server: unknown;
  yours: unknown;
}

export interface LoadedAggregate<S> {
  revision: number;
  state: S;
}

export interface CommandOutcome {
  /** The aggregate revision after the command (unchanged for an accepted no-op). */
  serverRevision: number;
  /** False for an accepted no-op (nothing changed): no audit row or outbox event is written. */
  changed: boolean;
  audit?: { action: string; before: unknown; after: unknown; reason?: string | null };
  /** Outbox event written in the same transaction (domain_events). */
  event?: { type: string; payload: Record<string, unknown> };
}

export interface CommandHandler<T extends CommandType = CommandType, S = unknown> {
  type: T;
  aggregateType: string;
  /** RBAC action evaluated server-side before anything else is read. */
  permission: Action;
  /** Locks (FOR UPDATE) and loads the aggregate inside the tenant transaction; null = 404. */
  load(ctx: CommandContext, aggregateId: string): Promise<LoadedAggregate<S> | null>;
  /** Business prerequisites on the current state; throw an HttpProblem to reject. */
  validate?(ctx: CommandContext, state: S, payload: z.infer<(typeof COMMAND_PAYLOADS)[T]>): Promise<void> | void;
  /**
   * Non-sensitive diff between the server state and what the client proposed (409 body). Never
   * include internal costs, tokens or another tenant's data.
   */
  diff(state: S, payload: z.infer<(typeof COMMAND_PAYLOADS)[T]>): FieldDiff[];
  execute(
    ctx: CommandContext,
    aggregate: LoadedAggregate<S>,
    payload: z.infer<(typeof COMMAND_PAYLOADS)[T]>,
  ): Promise<CommandOutcome>;
}

const handlers = new Map<CommandType, CommandHandler<CommandType, unknown>>();

/** Registers a handler; a duplicate registration is a programming error. */
export function registerCommand<T extends CommandType, S>(handler: CommandHandler<T, S>): void {
  if (handlers.has(handler.type)) throw new Error(`command ${handler.type} is already registered`);
  handlers.set(handler.type, handler as unknown as CommandHandler<CommandType, unknown>);
}

export function commandHandler(type: string): CommandHandler<CommandType, unknown> | null {
  return handlers.get(type as CommandType) ?? null;
}

export function registeredCommandTypes(): CommandType[] {
  return [...handlers.keys()].sort();
}

/** Payload schema for a command type from packages/contracts. */
export function payloadSchema(type: CommandType): z.ZodType {
  return COMMAND_PAYLOADS[type] as unknown as z.ZodType;
}
