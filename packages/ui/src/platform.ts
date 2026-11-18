import { Platform } from 'react-native';
import type { PlatformKind } from '@mail/core';

export function currentPlatform(): PlatformKind {
  switch (Platform.OS) {
    case 'ios':
      return 'ios';
    case 'android':
      return 'android';
    case 'macos':
      return 'macos';
    case 'windows':
      return 'windows';
    case 'web':
      return detectWebPlatform();
    default:
      return 'linux';
  }
}

export function isDesktopWeb(): boolean {
  return Platform.OS === 'web';
}

function detectWebPlatform(): PlatformKind {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  if (/mac os x|macintosh/.test(ua)) return 'macos';
  if (/windows/.test(ua)) return 'windows';
  return 'linux';
}
