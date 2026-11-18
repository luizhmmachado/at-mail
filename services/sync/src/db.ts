import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface Db {
  sqlite: DatabaseSync;
  close(): void;
}

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, picture TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS credentials (account_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL, email TEXT NOT NULL, encrypted_refresh_token TEXT NOT NULL, scopes TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL, channel TEXT NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL, context_id TEXT NOT NULL, sync_cursor TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS vault_records (user_id TEXT NOT NULL, kind TEXT NOT NULL, record_id TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL, PRIMARY KEY (user_id, kind, record_id));
    CREATE TABLE IF NOT EXISTS vault_meta (user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
  `);
  return { sqlite, close: () => sqlite.close() };
}
