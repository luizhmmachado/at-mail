import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDb } from '../src/db';
import { readVault, writeVault } from '../src/vault';

describe('vault de estado', () => {
  it('atribui revisões monotônicas e devolve somente deltas', () => {
    const db = openDb(':memory:');
    const first = writeVault(db.sqlite, 'u1', [{ kind: 'context', id: 'work', updatedAt: 10, payload: { name: 'Trabalho' } }]);
    assert.equal(first.applied, 1);
    assert.equal(first.revision, 1);
    const delta = readVault(db.sqlite, 'u1', 0);
    assert.equal(delta.records[0]?.id, 'work');
    assert.equal(delta.revision, 1);
    db.close();
  });

  it('rejeita uma atualização mais antiga sem apagar a mais nova', () => {
    const db = openDb(':memory:');
    writeVault(db.sqlite, 'u1', [{ kind: 'message-state', id: 'm1', updatedAt: 20, payload: { isRead: true } }]);
    const stale = writeVault(db.sqlite, 'u1', [{ kind: 'message-state', id: 'm1', updatedAt: 19, payload: { isRead: false } }]);
    assert.equal(stale.applied, 0);
    const record = readVault(db.sqlite, 'u1').records[0];
    assert.deepEqual(record?.payload, { isRead: true });
    db.close();
  });
});
