export const NATIVE_EMAIL_BASE_URL = 'https://email.atmail.invalid/';

export function emailImagePreferenceKey(sender: string): string {
  return `atmail.images.${Array.from(sender.trim().toLowerCase(), (character) => character.codePointAt(0)!.toString(16)).join('.')}`;
}

export function emailContentSecurityPolicy(imagesAllowed: boolean): string {
  const imageSources = imagesAllowed ? 'https: data:' : 'data:';
  return `default-src 'none'; img-src ${imageSources}; style-src 'unsafe-inline' https:; font-src https: data:; base-uri 'none'; form-action 'none'`;
}

export function isNativeEmailNavigationAllowed(url: string): boolean {
  return url === 'about:blank' || url === NATIVE_EMAIL_BASE_URL;
}