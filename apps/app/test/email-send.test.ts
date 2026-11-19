import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAppStore, createSeedData } from '@mail/core';
import { createLocalEmailMessage, parseEmailSendReceipt } from '../src/email-send';

describe('envio imediato de e-mail', () => {
  it('usa o mesmo identificador da sincronização para não duplicar o envio confirmado', () => {
    const seed = createSeedData();
    const account = seed.accounts.find((item) => item.channel === 'email')!;
    const store = createAppStore({ accounts: [account], contexts: seed.contexts });
    const request = { to: ['other@example.com'], body: 'Reply', subject: 'Re: Test', inReplyTo: '<original@example.com>',
      attachments: [{ fileName: 'test.txt', mimeType: 'text/plain', sizeInBytes: 3, base64: 'YWJj' }] };
    const receipt = parseEmailSendReceipt({ sent: true, messageId: 'message-1', threadId: 'thread-1', receivedAt: 123, rfcMessageId: '<message-1@example.com>' })!;
    const local = createLocalEmailMessage(account, request, receipt);
    store.actions.upsertMessages([local]);
    store.actions.upsertMessages([{ ...local, snippet: 'From sync' }]);
    assert.equal(store.getSnapshot().messages.length, 1);
    assert.equal(local.id, `gmail:${account.id}:message-1`);
    assert.equal(local.providerThreadId, 'thread-1');
    assert.equal(local.folder, 'sent');
    assert.equal(local.inReplyTo, '<original@example.com>');
    assert.equal(local.rfcMessageId, '<message-1@example.com>');
    assert.equal(local.attachments.length, 1);
    assert.equal('base64' in local.attachments[0]!, false);
  });

  it('aceita confirmação legada e rejeita recibos incompletos ou inválidos', () => {
    assert.equal(parseEmailSendReceipt({ sent: true }), undefined);
    for (const invalid of [null, {}, { sent: true, messageId: 'id' },
      { messageId: '../id', threadId: 'thread', receivedAt: 123 },
      { messageId: 'id', threadId: 'thread', receivedAt: Infinity }]) {
      assert.throws(() => parseEmailSendReceipt(invalid));
    }
  });
});
