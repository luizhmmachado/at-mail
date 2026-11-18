import type { ReactElement } from 'react';
import { View } from 'react-native';

/**
 * Ícones desenhados com Views, sem dependência externa.
 *
 * O frame usa vetores de 12–21 px com traço entre 1 e 1,5 px. As formas abaixo
 * reproduzem esses pesos; trocar por uma icon font mudaria a métrica óptica e
 * exigiria novo ajuste de tamanho em cada ponto do layout.
 */

export type GlyphName =
  | 'mail'
  | 'chat'
  | 'search'
  | 'compose'
  | 'chevron-down'
  | 'chevron-up'
  | 'dots'
  | 'archive'
  | 'trash'
  | 'clock'
  | 'up'
  | 'down'
  | 'settings'
  | 'user'
  | 'plus'
  | 'arrow'
  | 'reply'
  | 'attach'
  | 'file'
  | 'inbox'
  | 'star';

export interface GlyphProps {
  name: GlyphName;
  size?: number;
  color: string;
  strokeWidth?: number;
}

export function Glyph({ name, size = 18, color, strokeWidth = 1.2 }: GlyphProps): ReactElement {
  const border = { borderColor: color, borderWidth: strokeWidth };

  switch (name) {
    case 'mail':
      return (
        <View style={{ width: size, height: size * 0.74 }}>
          <View style={{ ...border, position: 'absolute', inset: 0, borderRadius: size * 0.12 }} />
          <View
            style={{
              position: 'absolute',
              left: size * 0.12,
              top: size * 0.08,
              width: size * 0.36,
              height: size * 0.36,
              borderLeftWidth: strokeWidth,
              borderTopWidth: strokeWidth,
              borderColor: color,
              transform: [{ rotate: '45deg' }]
            }}
          />
          <View
            style={{
              position: 'absolute',
              right: size * 0.12,
              top: size * 0.08,
              width: size * 0.36,
              height: size * 0.36,
              borderRightWidth: strokeWidth,
              borderTopWidth: strokeWidth,
              borderColor: color,
              transform: [{ rotate: '-45deg' }]
            }}
          />
        </View>
      );

    case 'chat':
      return (
        <View style={{ width: size, height: size * 0.94 }}>
          <View style={{ ...border, width: size * 0.94, height: size * 0.78, borderRadius: size * 0.24 }} />
          <View
            style={{
              position: 'absolute',
              left: size * 0.2,
              bottom: 0,
              width: size * 0.24,
              height: size * 0.24,
              borderLeftWidth: strokeWidth,
              borderBottomWidth: strokeWidth,
              borderColor: color,
              transform: [{ rotate: '-45deg' }]
            }}
          />
        </View>
      );

    case 'search':
      return (
        <View style={{ width: size, height: size }}>
          <View
            style={{
              ...border,
              width: size * 0.72,
              height: size * 0.72,
              borderRadius: size
            }}
          />
          <View
            style={{
              position: 'absolute',
              right: 0,
              bottom: size * 0.04,
              width: size * 0.36,
              height: strokeWidth,
              backgroundColor: color,
              transform: [{ rotate: '45deg' }]
            }}
          />
        </View>
      );

    case 'compose':
      return (
        <View style={{ width: size, height: size }}>
          <View style={{ ...border, position: 'absolute', inset: 0, borderRadius: size * 0.12 }} />
          <View
            style={{
              position: 'absolute',
              right: size * 0.06,
              top: size * 0.18,
              width: size * 0.5,
              height: strokeWidth * 1.8,
              borderRadius: strokeWidth,
              backgroundColor: color,
              transform: [{ rotate: '-45deg' }]
            }}
          />
        </View>
      );

    case 'chevron-down':
    case 'chevron-up':
    case 'up':
    case 'down': {
      const rotation = name === 'chevron-up' || name === 'up' ? '-135deg' : '45deg';
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <View
            style={{
              width: size * 0.34,
              height: size * 0.34,
              borderRightWidth: strokeWidth,
              borderBottomWidth: strokeWidth,
              borderColor: color,
              transform: [{ rotate: rotation }]
            }}
          />
        </View>
      );
    }

    case 'dots':
      return (
        <View style={{ width: size, height: size, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: size * 0.12 }}>
          {[0, 1, 2].map((index) => (
            <View key={index} style={{ width: strokeWidth * 1.6, height: strokeWidth * 1.6, borderRadius: size, backgroundColor: color }} />
          ))}
        </View>
      );

    case 'archive':
      return (
        <View style={{ width: size, height: size, alignItems: 'center' }}>
          <View style={{ ...border, width: size, height: size * 0.22, borderRadius: size * 0.06 }} />
          <View
            style={{
              width: size * 0.82,
              height: size * 0.52,
              borderLeftWidth: strokeWidth,
              borderRightWidth: strokeWidth,
              borderBottomWidth: strokeWidth,
              borderColor: color,
              alignItems: 'center',
              paddingTop: size * 0.16
            }}
          >
            <View style={{ width: size * 0.34, height: strokeWidth, backgroundColor: color }} />
          </View>
        </View>
      );

    case 'trash':
      return (
        <View style={{ width: size, height: size, alignItems: 'center' }}>
          <View style={{ width: size * 0.7, height: strokeWidth, backgroundColor: color }} />
          <View style={{ position: 'absolute', top: 0, width: size * 0.2, height: size * 0.12, borderLeftWidth: strokeWidth, borderRightWidth: strokeWidth, borderTopWidth: strokeWidth, borderColor: color }} />
          <View style={{ ...border, width: size * 0.58, height: size * 0.74, borderTopWidth: 0, borderRadius: size * 0.08 }} />
        </View>
      );

    case 'clock':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ ...border, width: size * 0.9, height: size * 0.9, borderRadius: size }} />
          <View style={{ position: 'absolute', top: size * 0.28, width: strokeWidth, height: size * 0.26, backgroundColor: color }} />
          <View style={{ position: 'absolute', left: size * 0.5, width: size * 0.22, height: strokeWidth, backgroundColor: color }} />
        </View>
      );

    case 'settings':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ ...border, width: size * 0.58, height: size * 0.58, borderRadius: size }} />
          {[0, 45, 90, 135].map((angle) => (
            <View
              key={angle}
              style={{
                position: 'absolute',
                width: size,
                height: strokeWidth,
                backgroundColor: color,
                transform: [{ rotate: `${angle}deg` }]
              }}
            />
          ))}
          <View style={{ position: 'absolute', width: size * 0.16, height: size * 0.16, borderRadius: size, backgroundColor: color }} />
        </View>
      );

    case 'user':
      return (
        <View style={{ width: size, height: size, alignItems: 'center' }}>
          <View style={{ ...border, width: size * 0.36, height: size * 0.36, borderRadius: size, marginTop: size * 0.06 }} />
          <View
            style={{
              ...border,
              width: size * 0.76,
              height: size * 0.36,
              borderBottomWidth: 0,
              borderTopLeftRadius: size,
              borderTopRightRadius: size,
              marginTop: size * 0.06
            }}
          />
        </View>
      );

    case 'plus':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', width: size, height: strokeWidth, backgroundColor: color }} />
          <View style={{ position: 'absolute', height: size, width: strokeWidth, backgroundColor: color }} />
        </View>
      );

    case 'arrow':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: size * 0.62, height: strokeWidth, backgroundColor: color }} />
          <View
            style={{
              position: 'absolute',
              right: size * 0.14,
              width: size * 0.26,
              height: size * 0.26,
              borderRightWidth: strokeWidth,
              borderTopWidth: strokeWidth,
              borderColor: color,
              transform: [{ rotate: '45deg' }]
            }}
          />
        </View>
      );

    case 'reply':
      return (
        <View style={{ width: size, height: size, justifyContent: 'center' }}>
          <View style={{ width: size * 0.7, height: size * 0.5, borderLeftWidth: strokeWidth, borderTopWidth: strokeWidth, borderColor: color, borderTopLeftRadius: size * 0.24, marginLeft: size * 0.1 }} />
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: size * 0.16,
              width: size * 0.26,
              height: size * 0.26,
              borderLeftWidth: strokeWidth,
              borderBottomWidth: strokeWidth,
              borderColor: color,
              transform: [{ rotate: '45deg' }]
            }}
          />
        </View>
      );

    case 'attach':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ ...border, width: size * 0.46, height: size * 0.84, borderRadius: size, borderTopColor: 'transparent', transform: [{ rotate: '-30deg' }] }} />
        </View>
      );

    case 'file':
      return (
        <View style={{ width: size, height: size }}>
          <View style={{ ...border, position: 'absolute', inset: 0, borderRadius: size * 0.12 }} />
          <View style={{ position: 'absolute', right: 0, top: 0, width: size * 0.34, height: size * 0.34, borderLeftWidth: strokeWidth, borderBottomWidth: strokeWidth, borderColor: color }} />
        </View>
      );

    case 'inbox':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ ...border, width: size, height: size * 0.68, borderRadius: size * 0.16, justifyContent: 'flex-end' }}>
            <View style={{ height: size * 0.2, borderTopWidth: strokeWidth, borderColor: color }} />
          </View>
        </View>
      );

    case 'star':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: size * 0.5, height: size * 0.5, borderLeftWidth: strokeWidth, borderTopWidth: strokeWidth, borderColor: color, transform: [{ rotate: '45deg' }] }} />
        </View>
      );

    default:
      return <View style={{ width: size, height: size }} />;
  }
}
