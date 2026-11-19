import rawTokens from './figma.tokens.json';

/**
 * Fonte única de verdade visual.
 *
 * Os valores vivem em `figma.tokens.json`, gerado a partir do arquivo Figma
 * (`FIGMA_FILE_KEY=qqjxZUMeAj95mXV7wYtTEw`) por `scripts/figma-sync-tokens.mjs`.
 * Nenhum componente deve declarar cor, tamanho, espaçamento ou raio literal.
 */

export type ThemeMode = 'light' | 'dark';
export type ThemePreference = ThemeMode | 'system';

export type ColorRole = keyof typeof rawTokens.color;

type ThemedValue<T> = { light: T; dark: T };

export type Tokens = typeof rawTokens;

export const DESIGN_META = rawTokens.meta;

export const tokens = rawTokens as Tokens;

export const isProvisionalDesign = rawTokens.meta.status !== 'extracted';

export const color = rawTokens.color;
export const typography = rawTokens.typography;
export const space = rawTokens.space;
export const radius = rawTokens.radius;
export const border = rawTokens.border;
export const layout = rawTokens.layout;
export const motion = rawTokens.motion;

export type SemanticColors = { [K in ColorRole]: string };

export type FontWeightToken = '300' | '400' | '500' | '600' | '700';

export type ThemeWeights = {
  regular: FontWeightToken;
  medium: FontWeightToken;
  semibold: FontWeightToken;
};

const weights = typography.weight as unknown as ThemeWeights;

export function resolveColors(mode: ThemeMode): SemanticColors {
  const resolved = {} as SemanticColors;
  for (const role of Object.keys(color) as ColorRole[]) {
    const themed = color[role] as ThemedValue<string>;
    resolved[role] = themed[mode];
  }
  return resolved;
}

export type ResolvedTheme = {
  mode: ThemeMode;
  colors: SemanticColors;
  fonts: { sans: string; mono: string };
  weights: ThemeWeights;
  typography: typeof typography;
  space: typeof space;
  radius: typeof radius;
  border: typeof border;
  layout: typeof layout;
  motion: typeof motion;
};

export const themes: Record<ThemeMode, ResolvedTheme> = {
  light: {
    mode: 'light',
    colors: resolveColors('light'),
    fonts: { sans: typography.familySans.light, mono: typography.familyMono.light },
    weights,
    typography,
    space,
    radius,
    border,
    layout,
    motion
  },
  dark: {
    mode: 'dark',
    colors: resolveColors('dark'),
    fonts: { sans: typography.familySans.dark, mono: typography.familyMono.dark },
    weights,
    typography,
    space,
    radius,
    border,
    layout,
    motion
  }
};

export function themeFor(mode: ThemeMode): ResolvedTheme {
  return themes[mode];
}

/** Converte os tokens em variáveis CSS (`--mail-color-canvas`, ...). */
export function cssVariables(mode: ThemeMode): Record<string, string> {
  const vars: Record<string, string> = {};
  const theme = themes[mode];

  for (const [role, value] of Object.entries(theme.colors)) {
    vars[`--mail-color-${kebab(role)}`] = value;
  }
  for (const [key, value] of Object.entries(theme.space)) {
    vars[`--mail-space-${key}`] = `${value}px`;
  }
  for (const [key, value] of Object.entries(theme.radius)) {
    vars[`--mail-radius-${key}`] = `${value}px`;
  }
  for (const [key, value] of Object.entries(theme.typography.size)) {
    vars[`--mail-text-${kebab(key)}`] = `${value}px`;
  }
  for (const [key, value] of Object.entries(theme.typography.line)) {
    vars[`--mail-leading-${kebab(key)}`] = `${value}px`;
  }
  vars['--mail-font-sans'] = theme.typography.familySans[mode];
  vars['--mail-font-mono'] = theme.typography.familyMono[mode];
  vars['--mail-motion-fast'] = `${theme.motion.fast}ms`;
  vars['--mail-motion-base'] = `${theme.motion.base}ms`;
  vars['--mail-motion-easing'] = theme.motion.easing;

  return vars;
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * O Figma expressa letter-spacing em % do tamanho da fonte (ex.: -1% em 12px = -0.12px),
 * que é exatamente o que o React Native espera depois de convertido para px.
 */
export function letterSpacing(fontSize: number, level: keyof typeof typography.tracking = 'tight'): number {
  const percent = typography.tracking[level];
  return Number(((fontSize * percent) / 100).toFixed(2));
}

export function contextAccent(role: string): ColorRole {
  switch (role) {
    case 'work':
      return 'contextWork';
    case 'studies':
      return 'contextStudies';
    case 'personal':
      return 'contextPersonal';
    default:
      return 'contextCustom';
  }
}
