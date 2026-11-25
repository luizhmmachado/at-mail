import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { latestDownloadUrl, releaseDownloadUrl } from '../src/downloads.ts';

describe('downloads da última release', () => {
  const release = {
    tag_name: 'v1.0.2',
    assets: [
      { name: 'app-release.apk', state: 'uploaded' },
      { name: '@mail_1.0.2_x64-setup.exe', state: 'uploaded' },
      { name: '@mail_1.0.2_x64_en-US.msi', state: 'uploaded' },
      { name: '@mail_1.0.2_amd64.AppImage', state: 'uploaded' },
      { name: '@mail_1.0.2_amd64.deb', state: 'uploaded' }
    ]
  };

  it('seleciona o arquivo correto e usa a tag da release consultada', () => {
    assert.equal(releaseDownloadUrl(release, 'android'), 'https://github.com/luizhmmachado/at-mail/releases/download/v1.0.2/app-release.apk');
    assert.equal(releaseDownloadUrl(release, 'windows'), 'https://github.com/luizhmmachado/at-mail/releases/download/v1.0.2/%40mail_1.0.2_x64-setup.exe');
    assert.equal(releaseDownloadUrl(release, 'linux'), 'https://github.com/luizhmmachado/at-mail/releases/download/v1.0.2/%40mail_1.0.2_amd64.AppImage');
    assert.match(releaseDownloadUrl({ ...release, tag_name: 'v1.0.3' }, 'android'), /\/v1\.0\.3\//);
  });

  it('informa arquivo ausente, ambíguo ou dados inválidos', () => {
    assert.throws(() => releaseDownloadUrl({ ...release, assets: [] }, 'windows'), /não está disponível/);
    assert.throws(() => releaseDownloadUrl({ ...release, assets: [release.assets[0], release.assets[0]] }, 'android'), /não está disponível/);
    assert.throws(() => releaseDownloadUrl({ ...release, tag_name: '../outra' }, 'android'), /inválida/);
    assert.throws(() => releaseDownloadUrl({ ...release, assets: [{ name: 'app-release.apk', state: 'new' }] }, 'android'), /não está disponível/);
  });

  it('apresenta falha quando a consulta à API é rejeitada', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
    await assert.rejects(latestDownloadUrl('linux'), /Não foi possível consultar/);
  });
});
