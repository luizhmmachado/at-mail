import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createAppStore, createSeedData } from '@mail/core';
import { createLocalEmailMessage, formattedEmailBody, parseEmailSendReceipt } from '../src/email-send';
import { appendClipboardImages } from '../../../packages/ui/src/components/clipboard-attachments';
import { isTextFormatted, toggleTextFormat } from '../../../packages/ui/src/components/text-format';
import { emailContentSecurityPolicy, emailImagePreferenceKey, EMAIL_LINK_BRIDGE_HASH, EMAIL_LINK_BRIDGE_SCRIPT, isNativeEmailNavigationAllowed, prepareEmailHtml, safeMessageLink } from '../../../packages/ui/src/components/email-html-policy';

describe('imagens de e-mail no mobile', () => {
  it('permite imagens HTTPS por padrão e bloqueia imagens remotas quando solicitado', () => {
    assert.match(emailContentSecurityPolicy(true), /img-src https: data:/);
    assert.match(emailContentSecurityPolicy(false), /img-src data:/);
    assert.doesNotMatch(emailContentSecurityPolicy(false), /img-src https:/);
    assert.match(emailContentSecurityPolicy(true), /default-src 'none'/);
  });

  it('mantém preferências por remetente e bloqueia navegação externa', () => {
    assert.equal(emailImagePreferenceKey(' Pessoa@Example.com '), emailImagePreferenceKey('pessoa@example.com'));
    assert.notEqual(emailImagePreferenceKey('pessoa@example.com'), emailImagePreferenceKey('outra@example.com'));
    assert.match(emailImagePreferenceKey('pessoa@example.com'), /^[A-Za-z0-9._-]+$/);
    assert.equal(isNativeEmailNavigationAllowed('https://email.atmail.invalid/'), true);
    assert.equal(isNativeEmailNavigationAllowed('about:blank'), true);
    assert.equal(isNativeEmailNavigationAllowed('https://example.com/'), false);
    assert.equal(isNativeEmailNavigationAllowed('file:///etc/passwd'), false);
  });

  it('aceita apenas links externos permitidos', () => {
    assert.equal(safeMessageLink('www.example.com/a'), 'https://www.example.com/a');
    assert.equal(safeMessageLink('//example.com/a'), 'https://example.com/a');
    assert.equal(safeMessageLink('https://example.com/a'), 'https://example.com/a');
    assert.equal(safeMessageLink('mailto:pessoa@example.com'), 'mailto:pessoa@example.com');
    assert.equal(safeMessageLink('javascript:alert(1)'), undefined);
    assert.equal(safeMessageLink('file:///etc/passwd'), undefined);
    assert.equal(safeMessageLink('/interno'), undefined);
  });

  it('prepara links sem scripts nem redirecionamentos automáticos', () => {
    const html = prepareEmailHtml('<html><head><base href="https://bad.example"><meta HTTP-EQUIV="Refresh" content="0;url=https://bad.example"><script>alert(1)</script></head><body><A HREF="https&#58;//example.com" TARGET="_self">link</A><a href="javascript:alert(1)">ruim</a><a href="file:///etc/passwd">arquivo</a></body></html>');
    assert.match(html, /href="https:\/\/example\.com\/"/i);
    assert.match(html, /target="_self"/i);
    assert.match(html, /rel="noopener noreferrer"/i);
    assert.doesNotMatch(html, /<script|<base|http-equiv="refresh"|javascript:|file:\/\//i);
    const webHtml = prepareEmailHtml('<a href="https://example.com" target="_self">link</a>', true);
    assert.match(webHtml, /target="_blank"/i);
  });

  it('permite apenas o script conhecido no iframe web', () => {
    assert.equal(createHash('sha256').update(EMAIL_LINK_BRIDGE_SCRIPT).digest('base64'), EMAIL_LINK_BRIDGE_HASH);
    assert.ok(emailContentSecurityPolicy(true, true).includes(`script-src 'sha256-${EMAIL_LINK_BRIDGE_HASH}'`));
    assert.doesNotMatch(emailContentSecurityPolicy(true), /script-src/);
    const desktop = JSON.parse(readFileSync(new URL('../../desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    const web = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'));
    assert.ok(desktop.app.security.csp.includes(`'sha256-${EMAIL_LINK_BRIDGE_HASH}'`));
    assert.ok(web.headers.some((entry: { headers: { key: string; value: string }[] }) => entry.headers.some((header) => header.key === 'Content-Security-Policy' && header.value.includes(`'sha256-${EMAIL_LINK_BRIDGE_HASH}'`))));
  });

  it('informa a altura do corpo ao carregar e quando seu tamanho muda', () => {
    const listeners = new Map<string, () => void>();
    const messages: { type: string; height: number }[] = [];
    const body = { scrollHeight: 1200, getBoundingClientRect: () => ({ height: 1100 }) };
    let resize: () => void = () => { throw new Error('Observador não registrado'); };
    class ResizeObserver {
      constructor(callback: () => void) { resize = callback; }
      observe(element: unknown): void { assert.equal(element, body); }
    }
    runInNewContext(EMAIL_LINK_BRIDGE_SCRIPT, {
      document: { body, addEventListener: (name: string, callback: () => void) => listeners.set(name, callback) },
      window: { parent: { postMessage: (message: { type: string; height: number }) => messages.push(message) }, addEventListener: () => {} },
      ResizeObserver
    });
    listeners.get('DOMContentLoaded')?.();
    assert.deepEqual({ ...messages.at(-1) }, { type: 'atmail:email-height', height: 1200 });
    body.scrollHeight = 400;
    body.getBoundingClientRect = () => ({ height: 350 });
    resize();
    assert.deepEqual({ ...messages.at(-1) }, { type: 'atmail:email-height', height: 400 });
  });
});

describe('alternância da formatação', () => {
  for (const marker of ['**', '*', '_', '~~', '~']) {
    it(`aplica e remove ${marker} em uma seleção ou cursor vazio`, () => {
      const applied = toggleTextFormat('texto', { start: 0, end: 5 }, marker);
      assert.equal(applied.text, `${marker}texto${marker}`);
      assert.equal(isTextFormatted(applied.text, applied.selection, marker), true);
      assert.deepEqual(toggleTextFormat(applied.text, applied.selection, marker), { text: 'texto', selection: { start: 0, end: 5 } });
      const empty = toggleTextFormat('', { start: 0, end: 0 }, marker);
      assert.equal(isTextFormatted(empty.text, empty.selection, marker), true);
      assert.deepEqual(toggleTextFormat(empty.text, empty.selection, marker), { text: '', selection: { start: 0, end: 0 } });
    });
  }

  it('remove apenas o trecho selecionado e mantém os demais formatados', () => {
    const result = toggleTextFormat('**olá mundo**', { start: 6, end: 11 }, '**');
    assert.deepEqual(result, { text: '**olá** mundo', selection: { start: 8, end: 13 } });
    assert.match(formattedEmailBody(result.text), /<strong>olá<\/strong> mundo/);
  });

  it('desativa a formatação no cursor ao final do trecho', () => {
    const result = toggleTextFormat('**texto**', { start: 7, end: 7 }, '**');
    assert.deepEqual(result, { text: '**texto**', selection: { start: 9, end: 9 } });
    assert.equal(isTextFormatted(result.text, result.selection, '**'), false);
  });

  it('mantém o itálico nas duas partes quando o cursor é desativado no meio', () => {
    const result = toggleTextFormat('_abcDEF_', { start: 4, end: 4 }, '_', '*');
    const inserted = `${result.text.slice(0, result.selection.start)}X${result.text.slice(result.selection.start)}`;
    assert.equal(inserted, '*abc*X*DEF*');
    assert.match(formattedEmailBody(inserted), /<em>abc<\/em>X<em>DEF<\/em>/);
    assert.equal(isTextFormatted(inserted, { start: 1, end: 4 }, '_', '*'), true);
    const removed = toggleTextFormat(inserted, { start: 1, end: 4 }, '_', '*');
    assert.equal(removed.text, 'abcX*DEF*');
    assert.match(formattedEmailBody(removed.text), /abcX<em>DEF<\/em>/);
  });
});

describe('imagens coladas como anexos', () => {
  it('adiciona imagens em base64 e ignora arquivos que não são imagens', async () => {
    const previous = [{ fileName: 'arquivo.txt', mimeType: 'text/plain', sizeInBytes: 3, base64: 'YWJj' }];
    const image = new File([new Uint8Array([0, 1, 255])], 'imagem.png', { type: 'image/png' });
    const text = new File(['texto'], 'outro.txt', { type: 'text/plain' });
    assert.deepEqual(await appendClipboardImages(previous, [image, text]), [previous[0], {
      fileName: 'imagem.png', mimeType: 'image/png', sizeInBytes: 3, base64: 'AAH/'
    }]);
  });

  it('rejeita imagens que excedem os limites sem alterar os anexos existentes', async () => {
    const image = new File(['a'], '', { type: 'image/png' });
    assert.equal((await appendClipboardImages([], [image]))[0]?.fileName, 'imagem-colada.png');
    const existing = Array.from({ length: 10 }, (_, index) => ({ fileName: String(index), mimeType: 'text/plain', sizeInBytes: 1, base64: 'YQ==' }));
    await assert.rejects(appendClipboardImages(existing, [image]), /máximo 10 arquivos/);
    await assert.rejects(appendClipboardImages([], [new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' })]), /3 MB/);
    assert.equal(existing.length, 10);
  });
});

describe('envio imediato de e-mail', () => {
  it('converte formatação sem interpretar HTML inserido no texto', () => {
    const html = formattedEmailBody('**negrito** _itálico_ ~~riscado~~\n<script>alert(1)</script>');
    assert.match(html, /<strong>negrito<\/strong>/);
    assert.match(html, /<em>itálico<\/em>/);
    assert.match(html, /<s>riscado<\/s>/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
  });
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
