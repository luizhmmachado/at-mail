import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import { themes, type ResolvedTheme, type ThemeMode } from '@mail/core';

const ThemeContext = createContext<ResolvedTheme>(themes.light);

export interface MailThemeProviderProps {
  mode?: ThemeMode;
  children: ReactNode;
}

export function MailThemeProvider({ mode = 'light', children }: MailThemeProviderProps): ReactElement {
  const value = useMemo(() => themes[mode], [mode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ResolvedTheme {
  return useContext(ThemeContext);
}

/** Atalho para o caso mais comum: só as cores semânticas. */
export function useColors() {
  return useTheme().colors;
}
