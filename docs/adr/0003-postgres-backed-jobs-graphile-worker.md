# ADR 0003: Postgres-backed durable jobs (graphile-worker) instead of Redis for now

- Status: Accepted
- Date: 2026-10-26
- Requirements: BE-076, BE-080, LCH-093, LCH-096

## Context

The handoff suggests "Redis and durable orchestration for background work". Background work
includes sending proposals and notifications, rendering PDFs, calling the vision worker, imagery
acquisition and payment/webhook follow-ups. Every one of these must happen only if the triggering
business change committed (no email for a rolled-back proposal, no double charge on retry). There
is no Redis on the development machine, and early volumes are small (an open business decision:
jobs/day).

## Decision

Use **graphile-worker** on the same PostgreSQL database. A job is inserted with the business
change in the **same transaction**, which makes the job table a transactional outbox. Jobs carry
idempotency keys and are written to be safely retryable. No Redis is introduced.

## Consequences

- Exactly one stateful dependency (PostgreSQL) to run, back up and secure; local setup and CI
  stay simple.
- Atomicity between data changes and side effects comes for free, without a separate outbox relay.
- Throughput is bounded by Postgres; long-running or very high-volume work would compete with OLTP
  traffic. Workers must keep jobs short and push heavy compute (vision, PDF) to separate processes.
- graphile-worker installs its own schema (`graphile_worker`); migrations and the test reset must
  account for it.

## Revisit triggers

- Sustained job throughput or latency needs that measurably degrade database performance.
- A need for long-running, multi-step workflows with human waits and timers beyond what retries
  and scheduled jobs express cleanly (consider a workflow engine such as Temporal).
- Caching or rate-limit state that must be shared across many API instances (Redis may then be
  added for that purpose, not for durability).
