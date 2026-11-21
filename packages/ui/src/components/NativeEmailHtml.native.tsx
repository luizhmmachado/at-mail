import type { ReactElement } from 'react';
import { WebView } from 'react-native-webview';
import type { NativeEmailHtmlProps } from './NativeEmailHtml';
import { isNativeEmailNavigationAllowed, NATIVE_EMAIL_BASE_URL } from './email-html-policy';

export function NativeEmailHtml({ html, height, backgroundColor }: NativeEmailHtmlProps): ReactElement {
  return <WebView
    accessibilityLabel="Corpo do e-mail"
    source={{ html, baseUrl: NATIVE_EMAIL_BASE_URL }}
    originWhitelist={['*']}
    onShouldStartLoadWithRequest={(request) => isNativeEmailNavigationAllowed(request.url)}
    javaScriptEnabled={false}
    domStorageEnabled={false}
    allowFileAccess={false}
    allowFileAccessFromFileURLs={false}
    allowUniversalAccessFromFileURLs={false}
    mixedContentMode="never"
    thirdPartyCookiesEnabled={false}
    sharedCookiesEnabled={false}
    setSupportMultipleWindows={false}
    nestedScrollEnabled
    containerStyle={{ height, flex: 0, backgroundColor }}
    style={{ backgroundColor }}
  />;
}