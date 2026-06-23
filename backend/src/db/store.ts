import { openDatabase, type SqlDatabase } from "./sqlite";
import { runMigrations } from "./migrations";
import {
  createImportRunRepository,
  type ImportRunRepository,
} from "../repositories/importRunRepository";
import { createPriceRepository, type PriceRepository } from "../repositories/priceRepository";
import {
  createSyncStateRepository,
  type SyncStateRepository,
} from "../repositories/syncStateRepository";

/**
 * Central wiring for the SQLite-backed historical store: opens (or creates) the
 * database, brings the schema up to date via migrations, and exposes the
 * repositories. Used by the CLIs and — for historical/hybrid modes — by the app.
 *
 * Lazy by construction: nothing here runs unless a SQLite-backed mode or a CLI
 * actually needs it, so `mock`/`live` startup never opens a database.
 */
export interface HistoricalStore {
  db: SqlDatabase;
  prices: PriceRepository;
  importRuns: ImportRunRepository;
  syncState: SyncStateRepository;
  close(): void;
}

export interface OpenStoreOptions {
  location: string;
  now?: () => Date;
}

export function openHistoricalStore(options: OpenStoreOptions): HistoricalStore {
  const db = openDatabase({ location: options.location });
  runMigrations(db, options.now);
  return {
    db,
    prices: createPriceRepository(db),
    importRuns: createImportRunRepository(db),
    syncState: createSyncStateRepository(db),
    close() {
      db.close();
    },
  };
}
