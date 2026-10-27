import type { Database } from '../client';
import { demoSeedSteps } from './demo';

/**
 * A named, idempotent seed step (safe to re-run). Seeds create only clearly fictional demo
 * records. Steps run in dependency order with the owner connection (RLS bypassed).
 */
export interface SeedStep {
  name: string;
  run: (db: Database) => Promise<void>;
}

export const seedSteps: readonly SeedStep[] = [...demoSeedSteps];
