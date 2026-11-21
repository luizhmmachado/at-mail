import { parse } from 'node-html-parser';

export const NATIVE_EMAIL_BASE_URL = 'https://email.atmail.invalid/';
export const EMAIL_LINK_BRIDGE_SCRIPT = "document.addEventListener('click',function(event){var element=event.target;while(element&&element.nodeType===1&&element.tagName!=='A')element=element.parentElement;if(!event.isTrusted||!element||!element.hasAttribute('href'))return;event.preventDefault();window.parent.postMessage({type:'atmail:email-link',url:element.getAttribute('href')},'*');},true);";
export const EMAIL_LINK_BRIDGE_HASH = 'VoJVjU/Bbqe0LuEQmpvT/tGGBNcOlp2rjeyY/7gf0jw=';

export function emailImagePreferenceKey(sender: string): string {
  return `atmail.images.${Array.from(sender.trim().toLowerCase(), (character) => character.codePointAt(0)!.toString(16)).join('.')}`;
}

export function emailContentSecurityPolicy(imagesAllowed: boolean, linkBridge = false): string {
  const imageSources = imagesAllowed ? 'https: data:' : 'data:';
  return `default-src 'none'; img-src ${imageSources}; style-src 'unsafe-inline' https:; font-src https: data:; base-uri 'none'; form-action 'none'${linkBridge ? `; script-src 'sha256-${EMAIL_LINK_BRIDGE_HASH}'` : ''}`;
}

export function isNativeEmailNavigationAllowed(url: string): boolean {
  return url === 'about:blank' || url === NATIVE_EMAIL_BASE_URL;
}

export function safeMessageLink(value: string): string | undefined {
  try {
    const trimmed = value.trim();
    const url = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'mailto:') return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function prepareEmailHtml(html: string, web = false): string {
  const document = parse(html, { comment: true });
  for (const element of document.querySelectorAll('script, base')) element.remove();
  for (const element of document.querySelectorAll('meta')) {
    const directive = element.getAttribute('http-equiv')?.trim().toLowerCase();
    if (directive === 'refresh' || directive === 'content-security-policy') element.remove();
  }
  for (const anchor of document.querySelectorAll('a')) {
    const url = safeMessageLink(anchor.getAttribute('href') ?? '');
    if (url === undefined) anchor.removeAttribute('href');
    else anchor.setAttribute('href', url);
    anchor.setAttribute('target', web ? '_blank' : '_self');
    anchor.setAttribute('rel', 'noopener noreferrer');
  }
  return document.toString();
}