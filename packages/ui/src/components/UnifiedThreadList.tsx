import { useMemo, type ReactElement } from 'react';
import { Pressable, SectionList, Text, TextInput, View } from 'react-native';
import { formatShortcut, groupByDate, type FeedResult, type ThreadId, type UnifiedThread } from '@mail/core';
import { useTheme } from '../theme/MailThemeProvider';
import { useMailActions, useMailSnapshot } from '../store/MailStoreProvider';
import { currentPlatform } from '../platform';
import { ChannelTabs } from './ChannelTabs';
import { ThreadRow } from './ThreadRow';

export interface UnifiedThreadListProps {
  feed: FeedResult;
  onSelectThread: (threadId: ThreadId) => void;
  /** Em telas pequenas a lista ocupa a tela inteira. */
  fullScreen?: boolean;
}

export function UnifiedThreadList({ feed, onSelectThread, fullScreen = false }: UnifiedThreadListProps): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();

  const sections = useMemo(
    () => groupByDate(feed.threads).map((section) => ({ title: section.label, data: section.threads })),
    [feed.threads]
  );

  const contextLabel =
    snapshot.view.contextId === 'all'
      ? 'Tudo'
      : (snapshot.contexts.find((context) => context.id === snapshot.view.contextId)?.name ?? 'Tudo');

  const platform = currentPlatform();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <View
        style={{
          paddingHorizontal: theme.space[3],
          paddingTop: theme.space[3],
          paddingBottom: theme.space[2],
          gap: theme.space[2]
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Text
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: theme.typography.size.titleLarge,
              lineHeight: theme.typography.line.titleLarge,
              fontWeight: theme.weights.semibold,
              letterSpacing: theme.typography.tracking.tight,
              color: theme.colors.textPrimary
            }}
          >
            {contextLabel}
          </Text>
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: theme.typography.size.micro,
              color: theme.colors.textTertiary
            }}
          >
            {feed.threads.length} conversas · {feed.totalUnread} não lidas
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[2],
              height: 30,
              paddingHorizontal: theme.space[2] + 2,
              borderRadius: theme.radius.md,
              borderWidth: theme.border.hairline,
              borderColor: theme.colors.borderSubtle,
              backgroundColor: theme.colors.surfaceSunken
            }}
          >
            <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>⌕</Text>
            <TextInput
              accessibilityLabel="Buscar em todas as contas"
              value={snapshot.view.query}
              onChangeText={(value) => actions.setQuery(value)}
              placeholder="Buscar assunto, pessoa ou contexto"
              placeholderTextColor={theme.colors.textTertiary}
              style={{
                flex: 1,
                fontFamily: theme.fonts.sans,
                fontSize: theme.typography.size.small,
                color: theme.colors.textPrimary
              }}
            />
            {snapshot.view.query.length === 0 && (
              <Text
                style={{
                  fontFamily: theme.fonts.mono,
                  fontSize: theme.typography.size.micro,
                  color: theme.colors.textTertiary
                }}
              >
                {formatShortcut('search', platform)}
              </Text>
            )}
          </View>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: snapshot.view.unreadOnly }}
            accessibilityLabel="Mostrar apenas não lidas"
            onPress={() => actions.setUnreadOnly(!snapshot.view.unreadOnly)}
            style={{
              height: 30,
              paddingHorizontal: theme.space[2] + 2,
              justifyContent: 'center',
              borderRadius: theme.radius.md,
              borderWidth: theme.border.hairline,
              borderColor: snapshot.view.unreadOnly ? theme.colors.accent : theme.colors.borderSubtle,
              backgroundColor: snapshot.view.unreadOnly ? theme.colors.accentMuted : 'transparent'
            }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.sans,
                fontSize: theme.typography.size.micro,
                fontWeight: theme.weights.medium,
                color: snapshot.view.unreadOnly ? theme.colors.accent : theme.colors.textSecondary
              }}
            >
              Não lidas
            </Text>
          </Pressable>
        </View>
      </View>

      <ChannelTabs feed={feed} />

      <SectionList<UnifiedThread, { title: string }>
        sections={sections}
        keyExtractor={(thread) => thread.id}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: theme.typography.size.micro,
              letterSpacing: theme.typography.tracking.wide,
              textTransform: 'uppercase',
              color: theme.colors.textTertiary,
              paddingHorizontal: theme.space[3],
              paddingTop: theme.space[3],
              paddingBottom: theme.space[1],
              backgroundColor: theme.colors.surface
            }}
          >
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <ThreadRow
            thread={item}
            selected={snapshot.view.selectedThreadId === item.id}
            showContextDot={snapshot.view.contextId === 'all'}
            onPress={() => onSelectThread(item.id)}
          />
        )}
        ListEmptyComponent={<EmptyState query={snapshot.view.query} />}
        contentContainerStyle={{ paddingBottom: fullScreen ? theme.space[10] : theme.space[6] }}
      />
    </View>
  );
}

function EmptyState({ query }: { query: string }): ReactElement {
  const theme = useTheme();
  return (
    <View style={{ padding: theme.space[6], gap: theme.space[2] }}>
      <Text
        style={{
          fontFamily: theme.fonts.sans,
          fontSize: theme.typography.size.bodyLarge,
          fontWeight: theme.weights.medium,
          color: theme.colors.textPrimary
        }}
      >
        {query.length > 0 ? 'Nada encontrado' : 'Caixa livre'}
      </Text>
      <Text
        style={{
          fontFamily: theme.fonts.sans,
          fontSize: theme.typography.size.small,
          color: theme.colors.textTertiary
        }}
      >
        {query.length > 0
          ? `Nenhuma conversa corresponde a “${query}”. Tente from:, context: ou in:chat.`
          : 'Nenhuma conversa neste contexto. Ao chegar algo novo, aparece aqui.'}
      </Text>
    </View>
  );
}
