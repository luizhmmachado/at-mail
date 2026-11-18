import type { DatabaseSync } from 'node:sqlite';

export interface VaultRecord { kind: string; id: string; updatedAt: number; deleted?: boolean; payload: unknown }

export function readVault(db: DatabaseSync, userId: string, since = 0): { revision: number; records: VaultRecord[] } {
  const meta = db.prepare('SELECT revision FROM vault_meta WHERE user_id = ?').get(userId) as { revision?: number } | undefined;
  const rows = db.prepare('SELECT kind, record_id, updated_at, deleted, payload FROM vault_records WHERE user_id = ? AND revision > ? ORDER BY revision').all(userId, since) as Array<{ kind: string; record_id: string; updated_at: number; deleted: number; payload: string }>;
  return { revision: meta?.revision ?? 0, records: rows.map((row) => ({ kind: row.kind, id: row.record_id, updatedAt: row.updated_at, deleted: row.deleted === 1, payload: JSON.parse(row.payload) })) };
}

export function writeVault(db: DatabaseSync, userId: string, incoming: VaultRecord[]): { revision: number; applied: number } {
  let revision = (db.prepare('SELECT revision FROM vault_meta WHERE user_id = ?').get(userId) as { revision?: number } | undefined)?.revision ?? 0;
  const update = db.prepare('SELECT updated_at FROM vault_records WHERE user_id = ? AND kind = ? AND record_id = ?');
  const upsert = db.prepare('INSERT INTO vault_records (user_id, kind, record_id, revision, updated_at, deleted, payload) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, kind, record_id) DO UPDATE SET revision=excluded.revision, updated_at=excluded.updated_at, deleted=excluded.deleted, payload=excluded.payload');
  let applied = 0;
  db.exec('BEGIN');
  try {
    for (const record of incoming) {
      if (!record.kind || !record.id || !Number.isFinite(record.updatedAt)) continue;
      const current = update.get(userId, record.kind, record.id) as { updated_at?: number } | undefined;
      if (current?.updated_at !== undefined && current.updated_at > record.updatedAt) continue;
      revision += 1;
      upsert.run(userId, record.kind, record.id, revision, record.updatedAt, record.deleted === true ? 1 : 0, JSON.stringify(record.payload));
      applied += 1;
    }
    db.prepare('INSERT INTO vault_meta (user_id, revision) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision').run(userId, revision);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { revision, applied };
}
