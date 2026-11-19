import type { Db } from './db.js';

export interface VaultRecord { kind: string; id: string; updatedAt: number; deleted?: boolean; payload: unknown }

export async function readVault(db: Db, userId: string, since = 0): Promise<{ revision: number; records: VaultRecord[] }> {
  const meta = (await db.query<{ revision: string }>('SELECT revision FROM atmail_vault_meta WHERE user_id = $1', [userId])).rows[0];
  const rows = (await db.query<{ kind: string; record_id: string; updated_at: string; deleted: boolean; payload: unknown }>('SELECT kind, record_id, updated_at, deleted, payload FROM atmail_vault_records WHERE user_id = $1 AND revision > $2 ORDER BY revision', [userId, since])).rows;
  return { revision: Number(meta?.revision ?? 0), records: rows.map((row) => ({ kind: row.kind, id: row.record_id, updatedAt: Number(row.updated_at), deleted: row.deleted, payload: row.payload })) };
}

export async function writeVault(db: Db, userId: string, incoming: VaultRecord[]): Promise<{ revision: number; applied: number }> {
  return db.transaction(async (client) => {
    const meta = (await client.query<{ revision: string }>('SELECT revision FROM atmail_vault_meta WHERE user_id = $1 FOR UPDATE', [userId])).rows[0];
    let revision = Number(meta?.revision ?? 0);
    let applied = 0;
    for (const record of incoming) {
      if (!record.kind || !record.id || !Number.isFinite(record.updatedAt)) continue;
      const current = (await client.query<{ updated_at: string }>('SELECT updated_at FROM atmail_vault_records WHERE user_id = $1 AND kind = $2 AND record_id = $3', [userId, record.kind, record.id])).rows[0];
      if (current && Number(current.updated_at) > record.updatedAt) continue;
      revision += 1;
      // `JSON.stringify(undefined)` devolveria undefined e violaria o NOT NULL.
      const payload = JSON.stringify(record.payload ?? null) ?? 'null';
      await client.query(`INSERT INTO atmail_vault_records (user_id, kind, record_id, revision, updated_at, deleted, payload) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT(user_id, kind, record_id) DO UPDATE SET revision=excluded.revision, updated_at=excluded.updated_at, deleted=excluded.deleted, payload=excluded.payload`, [userId, record.kind, record.id, revision, record.updatedAt, record.deleted === true, payload]);
      applied += 1;
    }
    await client.query('INSERT INTO atmail_vault_meta (user_id, revision) VALUES ($1, $2) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision', [userId, revision]);
    return { revision, applied };
  });
}
