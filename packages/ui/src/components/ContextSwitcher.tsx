import { useState, type ReactElement } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { contextAccent } from '@mail/core';
import type { Account, AccountId, ContextId } from '@mail/core';
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
export interface WorkspaceRailProps {
  onAddAccount?: () => void;
  onOpenSettings?: () => void;
}

export function WorkspaceRail({ onAddAccount, onOpenSettings }: WorkspaceRailProps = {}): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();

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
        accessibilityLabel="Abrir configurações"
        onPress={onOpenSettings}
        style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
      >
        <Glyph name="settings" size={18} color={theme.colors.textSecondary} />
      </Pressable>

      <View style={{ width: 1, height: 18, backgroundColor: theme.colors.borderSubtle, marginVertical: theme.space[2] }} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Adicionar conta Google"
        onPress={onAddAccount}
        style={{ padding: theme.space[1] }}
      >
        <Glyph name="plus" size={18} color={theme.colors.textSecondary} />
      </Pressable>
    </View>
  );
}

export interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onAddAccount?: () => void;
  onMoveAccounts?: (accountIds: AccountId[], contextId: ContextId) => Promise<void>;
}

interface AccountGroup {
  key: string;
  accountIds: AccountId[];
  displayName: string;
  email: string;
  channels: string[];
  contextId?: ContextId;
}

export function SettingsModal({ visible, onClose, onAddAccount, onMoveAccounts }: SettingsModalProps): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();
  const { width } = useWindowDimensions();
  const [savingGroup, setSavingGroup] = useState<string>();
  const [error, setError] = useState<string>();
  const groups = groupAccounts(snapshot.accounts);

  async function moveGroup(group: AccountGroup, contextId: ContextId): Promise<void> {
    if (onMoveAccounts === undefined || group.contextId === contextId) return;
    setSavingGroup(group.key);
    setError(undefined);
    try {
      await onMoveAccounts(group.accountIds, contextId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível salvar o contexto da conta.');
    } finally {
      setSavingGroup(undefined);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space[4], backgroundColor: 'rgba(0,0,0,0.32)' }}>
        <Pressable accessibilityLabel="Fechar configurações" onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <View
          style={{
            width: Math.min(width - theme.space[8], 520),
            maxHeight: '88%',
            overflow: 'hidden',
            borderRadius: theme.radius.xxl,
            backgroundColor: theme.colors.surface,
            shadowColor: theme.colors.shadow,
            shadowOpacity: 0.2,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 8 }
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.space[5], paddingTop: theme.space[5] }}>
            <Text style={{ ...typeStyle(theme, 'inboxTitle'), color: theme.colors.textPrimary }}>Configurações</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Fechar configurações" onPress={onClose}>
              <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.accent }}>Fechar</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: theme.space[5], paddingTop: theme.space[4] }}>
            <Text style={{ ...typeStyle(theme, 'sectionLabel', 'medium'), color: theme.colors.textSecondary }}>TEMA DA PÁGINA</Text>
            <View style={{ flexDirection: 'row', gap: theme.space[2], marginTop: theme.space[2] }}>
              <ThemeOption label="Claro" selected={snapshot.ui.themeMode === 'light'} onPress={() => actions.setThemeMode('light')} />
              <ThemeOption label="Escuro" selected={snapshot.ui.themeMode === 'dark'} onPress={() => actions.setThemeMode('dark')} />
            </View>

            <View style={{ marginTop: theme.space[6], marginBottom: theme.space[2] }}>
              <Text style={{ ...typeStyle(theme, 'sectionLabel', 'medium'), color: theme.colors.textSecondary }}>CONTAS CONECTADAS</Text>
            </View>
            {groups.length === 0 ? (
              <Text style={{ ...typeStyle(theme, 'body'), color: theme.colors.textSecondary, paddingVertical: theme.space[4] }}>
                Nenhuma conta conectada.
              </Text>
            ) : groups.map((group) => (
              <View key={group.key} style={{ paddingVertical: theme.space[3], borderTopWidth: theme.border.hairline, borderTopColor: theme.colors.borderSubtle }}>
                <Text numberOfLines={1} style={{ ...typeStyle(theme, 'rowName'), color: theme.colors.textPrimary }}>{group.displayName}</Text>
                <Text numberOfLines={1} style={{ ...typeStyle(theme, 'rowMeta'), color: theme.colors.textSecondary, marginTop: theme.space[1] }}>
                  {group.email} · {group.channels.join(' + ')}
                </Text>
                <View style={{ flexDirection: 'row', gap: theme.space[1], marginTop: theme.space[3] }}>
                  {snapshot.contexts.map((context) => {
                    const selected = group.contextId === context.id;
                    return (
                      <Pressable
                        key={context.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Definir ${group.email} como ${context.name}`}
                        accessibilityState={{ selected, disabled: savingGroup !== undefined || onMoveAccounts === undefined }}
                        disabled={savingGroup !== undefined || onMoveAccounts === undefined || selected}
                        onPress={() => void moveGroup(group, context.id)}
                        style={{ flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.lg, backgroundColor: selected ? theme.colors.accentMuted : theme.colors.surfaceSunken }}
                      >
                        <Text numberOfLines={1} style={{ ...typeStyle(theme, 'segment', selected ? 'medium' : 'regular'), color: selected ? theme.colors.accent : theme.colors.textSecondary }}>
                          {context.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            {error !== undefined && (
              <Text accessibilityRole="alert" style={{ ...typeStyle(theme, 'body'), color: theme.colors.danger, marginTop: theme.space[3] }}>
                {error}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Adicionar conta Google"
              disabled={onAddAccount === undefined}
              onPress={() => {
                onClose();
                onAddAccount?.();
              }}
              style={{ minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2], marginTop: theme.space[5], borderRadius: theme.radius.lg, backgroundColor: theme.colors.accent }}
            >
              <Glyph name="plus" size={16} color={theme.colors.surface} />
              <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.surface }}>Adicionar conta Google</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ThemeOption({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }): ReactElement {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.lg, backgroundColor: selected ? theme.colors.accentMuted : theme.colors.surfaceSunken }}
    >
      <Text style={{ ...typeStyle(theme, 'button', selected ? 'medium' : 'regular'), color: selected ? theme.colors.accent : theme.colors.textSecondary }}>{label}</Text>
    </Pressable>
  );
}

function groupAccounts(accounts: readonly Account[]): AccountGroup[] {
  const groups = new Map<string, Account[]>();
  for (const account of accounts) {
    const providerGroup = account.provider === 'gmail' || account.provider === 'google-chat' ? 'google' : account.provider;
    const key = `${providerGroup}:${account.email.toLowerCase()}`;
    const group = groups.get(key) ?? [];
    group.push(account);
    groups.set(key, group);
  }
  return Array.from(groups, ([key, group]) => {
    const contextIds = Array.from(new Set(group.map((account) => account.contextId)));
    const displayAccount = group.find((account) => account.channel === 'email') ?? group[0];
    return {
      key,
      accountIds: group.map((account) => account.id),
      displayName: displayAccount?.displayName ?? group[0]?.email ?? '',
      email: group[0]?.email ?? '',
      channels: Array.from(new Set(group.map((account) => account.channel === 'chat' ? 'Chat' : 'E-mail'))),
      contextId: contextIds.length === 1 ? contextIds[0] : undefined
    };
  });
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
