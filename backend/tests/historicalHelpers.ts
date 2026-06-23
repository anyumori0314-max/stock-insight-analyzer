import { openDatabase, type SqlDatabase } from "../src/db/sqlite";
import { runMigrations } from "../src/db/migrations";
import { createPriceRepository, type PriceRepository } from "../src/repositories/priceRepository";
import {
  createImportRunRepository,
  type ImportRunRepository,
} from "../src/repositories/importRunRepository";
import {
  createSyncStateRepository,
  type SyncStateRepository,
} from "../src/repositories/syncStateRepository";

/**
 * Opens an in-memory, migrated SQLite store for a single test. No disk is
 * touched, so tests are isolated and leave no DB files behind. Call `close()` in
 * an afterEach.
 */
export interface TestStore {
  db: SqlDatabase;
  prices: PriceRepository;
  importRuns: ImportRunRepository;
  syncState: SyncStateRepository;
  close(): void;
}

export function openTestStore(now?: () => Date): TestStore {
  const db = openDatabase({ location: ":memory:" });
  runMigrations(db, now);
  return {
    db,
    prices: createPriceRepository(db),
    importRuns: createImportRunRepository(db),
    syncState: createSyncStateRepository(db),
    close: () => db.close(),
  };
}
