import type { TextStyle } from 'react-native';
import type { ResolvedTheme } from '@mail/core';

export type TypeRole = keyof ResolvedTheme['typography']['roles'];
export type FontWeight = 'regular' | 'medium' | 'semibold';

/**
 * Cada peso do Inter é um arquivo separado (`Inter_600SemiBold`), então o peso
 * não pode ser aplicado com `fontWeight` — no nativo isso sintetiza negrito e
 * desalinha as métricas. A família é escolhida pelo peso.
 */
const FAMILY: Record<FontWeight, string> = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold'
};

const WEIGHT_BY_TOKEN: Record<string, FontWeight> = {
  '400': 'regular',
  '500': 'medium',
  '600': 'semibold'
};

export function fontFamilyFor(weight: FontWeight): string {
  return FAMILY[weight];
}

/**
 * Traduz um papel tipográfico do Figma em estilo do React Native.
 *
 * Os papéis (`rowName`, `readerBody`, ...) existem porque o Figma mede tamanho e
 * entrelinha em pares específicos — 12/15 na linha, 14/25 no corpo da mensagem —
 * e o token isolado de `size` não carrega essa intenção. O letter-spacing do
 * arquivo é sempre -1% do tamanho da fonte (ex.: 12px → -0.12px).
 */
export function typeStyle(theme: ResolvedTheme, role: TypeRole, weight?: FontWeight): TextStyle {
  const spec = theme.typography.roles[role];
  const percent = theme.typography.tracking.tight;
  const chosen = weight ?? WEIGHT_BY_TOKEN[spec.weight] ?? 'regular';
  return {
    fontFamily: FAMILY[chosen],
    fontSize: spec.size,
    lineHeight: spec.line,
    letterSpacing: Number(((spec.size * percent) / 100).toFixed(2))
  };
}

/** Só as métricas, sem família e sem peso — útil para herdar o estilo do container. */
export function typeMetrics(theme: ResolvedTheme, role: TypeRole): { fontSize: number; lineHeight: number } {
  const spec = theme.typography.roles[role];
  return { fontSize: spec.size, lineHeight: spec.line };
}
