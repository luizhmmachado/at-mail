import { useMemo, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  contextAccent,
  formatShortcut,
  type ContextWorkspace,
  type FeedResult,
  type ShortcutAction
} from '@mail/core';
import { useTheme } from '../theme/MailThemeProvider';
import { useAppStore, useMailActions, useMailSnapshot } from '../store/MailStoreProvider';
import { currentPlatform } from '../platform';

export interface ContextSwitcherProps {
  feed: FeedResult;
  compact?: boolean;
}

const PRESET_SHORTCUT: Record<string, ShortcutAction> = {
  work: 'context-work',
  studies: 'context-studies',
  personal: 'context-personal'
};

export function ContextSwitcher({ feed, compact = false }: ContextSwitcherProps): ReactElement {
  const theme = useTheme();
  const store = useAppStore();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();

  const unreadByContext = useMemo(() => {
    const result: Record<string, number> = {};
    for (const context of snapshot.contexts) {
      result[context.id] = store.unreadForContext(context.id);
    }
    return result;
  }, [snapshot.contexts, snapshot.messages, store]);

  const totalUnread = Object.values(unreadByContext).reduce((sum, value) => sum + value, 0);
  const isAll = snapshot.view.contextId === 'all';

  return (
    <View style={{ flex: 1, paddingHorizontal: compact ? 4 : theme.space[2] }}>
      {!compact && (
        <Text
          style={{
            fontFamily: theme.fonts.sans,
            fontSize: theme.typography.size.micro,
            letterSpacing: theme.typography.tracking.wide,
            textTransform: 'uppercase',
            color: theme.colors.textTertiary,
            paddingHorizontal: theme.space[2],
            paddingTop: theme.space[4],
            paddingBottom: theme.space[2]
          }}
        >
          Contextos
        </Text>
      )}

      <ContextRow
        label="Tudo"
        shortcut={formatShortcut('context-all', currentPlatform())}
        unread={totalUnread}
        selected={isAll}
        accentRole="custom"
        isAll
        compact={compact}
        onPress={() => actions.setContext('all')}
      />

      <View style={{ height: theme.space[1] }} />

      <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
        {snapshot.contexts.map((context) => (
          <ContextRow
            key={context.id}
            label={context.name}
            shortcut={formatShortcut(shortcutFor(context), currentPlatform())}
            unread={unreadByContext[context.id] ?? 0}
            selected={snapshot.view.contextId === context.id}
            accentRole={context.kind}
            compact={compact}
            muted={context.muted}
            onPress={() => actions.setContext(context.id)}
          />
        ))}
      </ScrollView>

      {!compact && (
        <View style={{ marginTop: theme.space[4] }}>
          <Text
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: theme.typography.size.micro,
              letterSpacing: theme.typography.tracking.wide,
              textTransform: 'uppercase',
              color: theme.colors.textTertiary,
              paddingHorizontal: theme.space[2],
              paddingBottom: theme.space[2]
            }}
          >
            Contas
          </Text>
          {snapshot.accounts.map((account) => {
            const context = snapshot.contexts.find((item) => item.id === account.contextId);
            return (
              <View
                key={account.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space[2],
                  paddingHorizontal: theme.space[2],
                  paddingVertical: theme.space[1]
                }}
              >
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: theme.radius.pill,
                    backgroundColor:
                      account.status === 'reauth-required' || account.status === 'error'
                        ? theme.colors.danger
                        : theme.colors[contextAccent(context?.kind ?? 'custom')]
                  }}
                />
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    fontFamily: theme.fonts.sans,
                    fontSize: theme.typography.size.small,
                    color: theme.colors.textSecondary
                  }}
                >
                  {account.email}
                </Text>
                <Text
                  style={{
                    fontFamily: theme.fonts.mono,
                    fontSize: theme.typography.size.micro,
                    color: theme.colors.textTertiary
                  }}
                >
                  {account.channel === 'chat' ? 'chat' : 'mail'}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

interface ContextRowProps {
  label: string;
  unread: number;
  selected: boolean;
  accentRole: string;
  shortcut?: string;
  compact: boolean;
  muted?: boolean;
  isAll?: boolean;
  onPress: () => void;
}

function ContextRow({
  label,
  unread,
  selected,
  accentRole,
  shortcut,
  compact,
  muted = false,
  isAll = false,
  onPress
}: ContextRowProps): ReactElement {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);

  const background = selected
    ? theme.colors.surfaceSelected
    : hovered
      ? theme.colors.surfaceHover
      : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`Contexto ${label}${unread > 0 ? `, ${unread} não lidas` : ''}`}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        paddingHorizontal: theme.space[2],
        height: 34,
        marginHorizontal: 2,
        borderRadius: theme.radius.md,
        backgroundColor: background
      }}
    >
      {isAll ? (
        <View style={{ width: 10, height: 10, flexDirection: 'row', gap: 2 }}>
          <View style={{ flex: 1, borderRadius: 1, backgroundColor: theme.colors.contextWork }} />
          <View style={{ flex: 1, borderRadius: 1, backgroundColor: theme.colors.contextStudies }} />
          <View style={{ flex: 1, borderRadius: 1, backgroundColor: theme.colors.contextPersonal }} />
        </View>
      ) : (
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors[contextAccent(accentRole)],
            opacity: muted ? 0.35 : 1
          }}
        />
      )}

      {!compact && (
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: theme.fonts.sans,
            fontSize: theme.typography.size.small,
            fontWeight: selected ? theme.weights.medium : theme.weights.regular,
            color: selected ? theme.colors.textPrimary : theme.colors.textSecondary
          }}
        >
          {label}
        </Text>
      )}

      {unread > 0 && (
        <Text
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: theme.typography.size.micro,
            color: selected ? theme.colors.textPrimary : theme.colors.textTertiary
          }}
        >
          {unread > 99 ? '99+' : unread}
        </Text>
      )}

      {!compact && shortcut !== undefined && selected && (
        <Text
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: theme.typography.size.micro,
            color: theme.colors.textTertiary
          }}
        >
          {shortcut}
        </Text>
      )}
    </Pressable>
  );
}

function shortcutFor(context: ContextWorkspace): ShortcutAction {
  return PRESET_SHORTCUT[context.kind] ?? 'context-all';
}
