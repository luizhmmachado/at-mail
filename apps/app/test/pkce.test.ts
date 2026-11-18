import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { asciiBytes, base64Url, sha256, sha256Base64Url } from '../src/sha256';

describe('PKCE (RFC 7636)', () => {
  it('calcula o SHA-256 igual ao node:crypto', () => {
    for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000)]) {
      const expected = createHash('sha256').update(Buffer.from(text, 'latin1')).digest('hex');
      const actual = Buffer.from(sha256(asciiBytes(text))).toString('hex');
      assert.equal(actual, expected, `entrada de ${text.length} bytes`);
    }
  });

  it('produz o code_challenge do exemplo do RFC 7636', () => {
    assert.equal(
      sha256Base64Url('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });

  it('codifica em base64url sem padding', () => {
    assert.equal(base64Url(new Uint8Array([])), '');
    assert.equal(base64Url(new Uint8Array([1])), 'AQ');
    assert.equal(base64Url(new Uint8Array([1, 2])), 'AQI');
    assert.equal(base64Url(new Uint8Array([1, 2, 3])), 'AQID');
    assert.equal(base64Url(new Uint8Array([0xfb, 0xff])), '-_8');
  });
});
