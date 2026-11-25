export type DownloadPlatform = 'android' | 'windows' | 'linux';

const RELEASE_API = 'https://api.github.com/repos/luizhmmachado/at-mail/releases/latest';
const RELEASE_BASE = 'https://github.com/luizhmmachado/at-mail/releases/download';
const ASSET_PATTERNS: Record<DownloadPlatform, RegExp> = {
  android: /^app-release\.apk$/,
  windows: /^@mail_[A-Za-z0-9.+_-]+_x64-setup\.exe$/,
  linux: /^@mail_[A-Za-z0-9.+_-]+_amd64\.AppImage$/
};

export function releaseDownloadUrl(release: unknown, platform: DownloadPlatform): string {
  if (release === null || typeof release !== 'object') throw new Error('Release inválida.');
  const { tag_name: tag, assets } = release as { tag_name?: unknown; assets?: unknown };
  if (typeof tag !== 'string' || !/^v[0-9][A-Za-z0-9.+_-]*$/.test(tag) || !Array.isArray(assets)) {
    throw new Error('Release inválida.');
  }
  const matching = assets.filter((asset: unknown) => {
    if (asset === null || typeof asset !== 'object') return false;
    const { name, state } = asset as { name?: unknown; state?: unknown };
    return typeof name === 'string' && state === 'uploaded' && ASSET_PATTERNS[platform].test(name);
  });
  if (matching.length !== 1) throw new Error('O instalador para esta plataforma não está disponível na última release.');
  const { name } = matching[0] as { name: string };
  return `${RELEASE_BASE}/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

export async function latestDownloadUrl(platform: DownloadPlatform): Promise<string> {
  const response = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error('Não foi possível consultar a última release.');
  return releaseDownloadUrl(await response.json(), platform);
}
