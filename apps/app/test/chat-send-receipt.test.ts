import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseChatSendReceipt } from '../src/chat-send-receipt';

describe('recibo de envio do Google Chat', () => {
  it('aceita a resposta legada sem recibo', () => {
    assert.equal(parseChatSendReceipt({ sent: true }), undefined);
  });

  it('valida o identificador e horário da mensagem retornados pela API', () => {
    assert.deepEqual(parseChatSendReceipt({
      messageName: 'spaces/space-1/messages/message-1',
      spaceResourceName: 'spaces/space-1',
      receivedAt: 1_763_558_400_000
    }), {
      messageName: 'spaces/space-1/messages/message-1',
      spaceResourceName: 'spaces/space-1',
      receivedAt: 1_763_558_400_000
    });
  });

  it('rejeita um recibo inválido', () => {
    assert.throws(() => parseChatSendReceipt({ sent: true, messageName: 'invalid' }));
  });
});