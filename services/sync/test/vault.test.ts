import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDb } from '../src/db';
import { readVault, writeVault } from '../src/vault';

describe('vault de estado', { skip: !process.env.DATABASE_URL }, () => {
  it('atribui revisões monotônicas e devolve somente deltas', async () => {
    const db = await openDb(process.env.DATABASE_URL!);
    const first = await writeVault(db, 'u1', [{ kind: 'context', id: 'work', updatedAt: 10, payload: { name: 'Trabalho' } }]);
    assert.equal(first.applied, 1);
    assert.equal(first.revision, 1);
    const delta = await readVault(db, 'u1', 0);
    assert.equal(delta.records[0]?.id, 'work');
    assert.equal(delta.revision, 1);
    await db.close();
  });

  it('rejeita uma atualização mais antiga sem apagar a mais nova', async () => {
    const db = await openDb(process.env.DATABASE_URL!);
    await writeVault(db, 'u1', [{ kind: 'message-state', id: 'm1', updatedAt: 20, payload: { isRead: true } }]);
    const stale = await writeVault(db, 'u1', [{ kind: 'message-state', id: 'm1', updatedAt: 19, payload: { isRead: false } }]);
    assert.equal(stale.applied, 0);
    const record = (await readVault(db, 'u1')).records[0];
    assert.deepEqual(record?.payload, { isRead: true });
    await db.close();
  });
});
