import { useState, type ReactElement } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { contextAccent } from '@mail/core';
import { useTheme } from '../theme/MailThemeProvider';
import { useMailActions, useMailSnapshot } from '../store/MailStoreProvider';
import { typeStyle } from '../theme/typography';
import { Glyph } from './Glyph';

/**
 * Rail de 64 px do frame `@mail · Desktop`.
 *
 * Cada contexto é um tile de 48×58 com indicador de 8 px e rótulo de 10 px.
 * O rail não mostra contadores: no arquivo o estado de não lido fica nas linhas
 * e no cabeçalho da seção, não aqui.
 */
export function WorkspaceRail({ onAddAccount }: { onAddAccount?: () => void } = {}): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <View
      style={{
        width: theme.layout.sidebarWidth,
        backgroundColor: theme.colors.rail,
        borderRightWidth: theme.border.hairline,
        borderRightColor: theme.colors.borderSubtle,
        alignItems: 'center',
        paddingTop: theme.layout.railBrandTop,
        paddingBottom: theme.space[6]
      }}
    >
      <Text
        accessibilityLabel="@mail"
        style={{
          ...typeStyle(theme, 'railBrand'),
          color: theme.colors.textPrimary
        }}
      >
        @
      </Text>

      <View style={{ marginTop: theme.space[10], gap: theme.layout.contextTileGap }}>
        <ContextTile
          label="Tudo"
          accent={theme.colors.accent}
          selected={snapshot.view.contextId === 'all'}
          onPress={() => actions.setContext('all')}
        />
        {snapshot.contexts.map((context) => (
          <ContextTile
            key={context.id}
            label={context.name}
            accent={theme.colors[contextAccent(context.kind)]}
            selected={snapshot.view.contextId === context.id}
            muted={context.muted}
            onPress={() => actions.setContext(context.id)}
          />
        ))}
      </View>

      <View style={{ flex: 1 }} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Alternar tema"
        onPress={() => actions.setThemeMode(snapshot.ui.themeMode === 'light' ? 'dark' : 'light')}
        style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
      >
        <Glyph name="settings" size={18} color={theme.colors.textSecondary} />
      </Pressable>

      <View style={{ width: 1, height: 18, backgroundColor: theme.colors.borderSubtle, marginVertical: theme.space[2] }} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Abrir perfil e configurações"
        onPress={() => setSettingsOpen(true)}
        style={{ padding: theme.space[1] }}
      >
        <Glyph name="user" size={18} color={theme.colors.textSecondary} />
      </Pressable>

      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <Pressable
          accessibilityLabel="Fechar configurações"
          onPress={() => setSettingsOpen(false)}
          style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'flex-start', backgroundColor: 'rgba(0,0,0,0.18)' }}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              width: 340,
              margin: theme.space[5],
              padding: theme.space[5],
              borderRadius: theme.radius.xxl,
              backgroundColor: theme.colors.surface,
              shadowColor: theme.colors.shadow,
              shadowOpacity: 0.2,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 }
            }}
          >
            <Text style={{ ...typeStyle(theme, 'readerTitle'), color: theme.colors.textPrimary }}>Configurações</Text>
            <Text style={{ ...typeStyle(theme, 'body'), color: theme.colors.textSecondary, marginTop: theme.space[2] }}>
              {snapshot.accounts.length} {snapshot.accounts.length === 1 ? 'conta conectada' : 'contas conectadas'}
            </Text>
            <View style={{ gap: theme.space[2], marginTop: theme.space[4] }}>
              {snapshot.accounts.map((account) => (
                <View key={account.id} style={{ padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
                  <Text style={{ ...typeStyle(theme, 'rowName'), color: theme.colors.textPrimary }}>{account.displayName}</Text>
                  <Text style={{ ...typeStyle(theme, 'rowMeta'), color: theme.colors.textSecondary }}>{account.email} · {account.channel === 'chat' ? 'Chat' : 'E-mail'}</Text>
                </View>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Adicionar conta Google"
              onPress={() => {
                setSettingsOpen(false);
                onAddAccount?.();
              }}
              style={{ marginTop: theme.space[4], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.accent, alignItems: 'center' }}
            >
              <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.surface }}>Adicionar conta Google</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

interface ContextTileProps {
  label: string;
  accent: string;
  selected: boolean;
  muted?: boolean;
  onPress: () => void;
}

function ContextTile({ label, accent, selected, muted = false, onPress }: ContextTileProps): ReactElement {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`Contexto ${label}`}
      onPress={onPress}
      style={{
        width: theme.layout.contextTileWidth,
        height: theme.layout.contextTileHeight,
        borderRadius: theme.radius.xxl,
        backgroundColor: selected ? theme.colors.accentMuted : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: theme.radius.pill,
          backgroundColor: selected ? theme.colors.accent : accent,
          opacity: muted ? 0.4 : 1
        }}
      />
      <Text
        numberOfLines={1}
        style={{
          ...typeStyle(theme, 'railContext', selected ? 'medium' : 'regular'),
          color: selected ? theme.colors.accent : theme.colors.textSecondary
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Agrupamento de contextos do frame mobile: três indicadores sobrepostos
 * (6 px, deslocados 4 px) e o título de 22 px ao lado.
 */
export function MobileContextCluster(): ReactElement {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', width: 18, height: 12 }}>
      {[theme.colors.contextWork, theme.colors.contextStudies, theme.colors.contextPersonal].map((color, index) => (
        <View
          key={index}
          style={{
            position: 'absolute',
            left: index * 4,
            top: index === 1 ? -4 : 0,
            width: 6,
            height: 6,
            borderRadius: theme.radius.pill,
            backgroundColor: color
          }}
        />
      ))}
    </View>
  );
}
