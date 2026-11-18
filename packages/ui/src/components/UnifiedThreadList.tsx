import { useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, SectionList, Text, TextInput, View } from 'react-native';
import {
  contextAccent,
  formatShortcut,
  groupByDate,
  type FeedResult,
  type ThreadId,
  type UnifiedThread
} from '@mail/core';
import { useTheme } from '../theme/MailThemeProvider';
import { useMailActions, useMailSnapshot } from '../store/MailStoreProvider';
import { currentPlatform } from '../platform';
import { typeStyle } from '../theme/typography';
import { ChannelTabs } from './ChannelTabs';
import { MobileContextCluster } from './ContextSwitcher';
import { Glyph } from './LucideGlyph';
import { ThreadRow } from './ThreadRow';

export interface UnifiedThreadListProps {
  feed: FeedResult;
  onSelectThread: (threadId: ThreadId) => void;
  onCompose?: () => void;
  onOpenSettings?: () => void;
  /** Em telas pequenas a lista ocupa a tela inteira. */
  fullScreen?: boolean;
}

/**
 * Caixa unificada de 360 px do frame `@mail · Desktop`.
 *
 * A ordem vertical é fixa: título (20/24) + chevron + escrever, busca de 34 px,
 * segmentado de 32 px e, dentro da lista, cabeçalhos de data com contagem.
 */
export function UnifiedThreadList({ feed, onSelectThread, onCompose, onOpenSettings, fullScreen = false }: UnifiedThreadListProps): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();
  const [menuOpen, setMenuOpen] = useState(false);

  const sections = useMemo(
    () => groupByDate(feed.threads).map((section) => ({ title: section.label, data: section.threads })),
    [feed.threads]
  );

  const mobile = fullScreen;
  const title =
    snapshot.view.contextId === 'all'
      ? 'Todas as caixas'
      : (snapshot.contexts.find((context) => context.id === snapshot.view.contextId)?.name ?? 'Todas as caixas');

  const platform = currentPlatform();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <View
        style={{
          paddingHorizontal: mobile ? theme.layout.mobilePaddingX : theme.layout.inboxPaddingX,
          paddingTop: mobile ? theme.space[5] : theme.layout.inboxTitleTop,
          paddingBottom: 0
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: mobile ? 6 : 8 }}>
          {mobile && (
            <View style={{ marginRight: 4 }}>
              <MobileContextCluster />
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Contexto atual: ${title}. Abrir seletor de contexto.`}
            onPress={() => setMenuOpen((open) => !open)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: mobile ? 10 : 9 }}
          >
            <Text
              numberOfLines={1}
              style={{
                ...typeStyle(theme, mobile ? 'mobileTitle' : 'inboxTitle'),
                color: theme.colors.textPrimary
              }}
            >
              {title}
            </Text>
            <Glyph name="chevron-down" size={mobile ? 20 : 18} color={theme.colors.textSecondary} />
          </Pressable>

          <View style={{ flex: 1 }} />

          {mobile ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Buscar em todas as contas"
                onPress={() => actions.toggleCommandPalette(true)}
                style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}
              >
                <Glyph name="search" size={22} color={theme.colors.textPrimary} />
              </Pressable>
              {onOpenSettings !== undefined && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Abrir configurações"
                  onPress={onOpenSettings}
                  style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Glyph name="settings" size={20} color={theme.colors.textPrimary} />
                </Pressable>
              )}
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Escrever resposta na conversa aberta"
              onPress={() => {
                if (onCompose) onCompose();
                else actions.toggleCompose(true);
              }}
              style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}
            >
              <Glyph name="compose" size={20} color={theme.colors.textPrimary} />
            </Pressable>
          )}
        </View>

        {!mobile && (
          <View
            style={{
              marginTop: 18,
              height: theme.layout.searchHeight,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 10,
              borderRadius: theme.radius.lg,
              borderWidth: theme.border.hairline,
              borderColor: theme.colors.borderSubtle,
              backgroundColor: theme.colors.surfaceSunken
            }}
          >
            <Glyph name="search" size={16} color={theme.colors.textSecondary} />
            <TextInput
              accessibilityLabel="Buscar em todas as contas"
              value={snapshot.view.query}
              onChangeText={(value) => actions.setQuery(value)}
              placeholder="Buscar em qualquer lugar"
              placeholderTextColor={theme.colors.textSecondary}
              style={{
                ...typeStyle(theme, 'search'),
                flex: 1,
                marginLeft: theme.space[2],
                paddingVertical: 0,
                color: theme.colors.textPrimary
              }}
            />
            {snapshot.view.query.length === 0 && (
              <Text style={{ ...typeStyle(theme, 'shortcut'), color: theme.colors.textSecondary }}>
                {formatShortcut('search', platform)}
              </Text>
            )}
          </View>
        )}

        <View style={{ marginTop: mobile ? 21 : 14 }}>
          <ChannelTabs feed={feed} variant={mobile ? 'mobile' : 'desktop'} />
        </View>
      </View>

      <SectionList<UnifiedThread, { title: string; data: UnifiedThread[] }>
        sections={sections}
        keyExtractor={(thread) => thread.id}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        renderSectionHeader={({ section }) => {
          const unread = section.data.reduce((sum, thread) => sum + thread.unreadCount, 0);
          return (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: mobile ? theme.layout.mobilePaddingX + 2 : theme.layout.rowPaddingX,
                paddingTop: theme.space[6],
                paddingBottom: theme.space[3],
                backgroundColor: theme.colors.surface
              }}
            >
              <Text
                style={{
                  ...typeStyle(theme, 'sectionLabel'),
                  color: theme.colors.textSecondary,
                  textTransform: 'uppercase'
                }}
              >
                {section.title}
              </Text>
              {unread > 0 && (
                <Text style={{ ...typeStyle(theme, 'sectionMeta'), color: theme.colors.textSecondary }}>
                  {unread} não {unread === 1 ? 'lida' : 'lidas'}
                </Text>
              )}
            </View>
          );
        }}
        renderItem={({ item, index, section }) => (
          <ThreadRow
            thread={item}
            selected={snapshot.view.selectedThreadId === item.id}
            showContextDot={snapshot.view.contextId === 'all'}
            variant={mobile ? 'mobile' : 'desktop'}
            isLast={index === section.data.length - 1}
            onPress={() => onSelectThread(item.id)}
          />
        )}
        ListEmptyComponent={<EmptyState query={snapshot.view.query} loading={snapshot.sync.status === 'syncing'} />}
        contentContainerStyle={{ paddingBottom: fullScreen ? theme.space[10] : theme.space[6] }}
      />

      {menuOpen && (
        <>
          <Pressable
            accessibilityLabel="Fechar seletor de contexto"
            onPress={() => setMenuOpen(false)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}
          />
          <View
            style={{
              position: 'absolute',
              top: mobile ? 62 : 58,
              left: mobile ? theme.layout.mobilePaddingX : theme.space[4],
              width: 260,
              zIndex: 11,
              padding: theme.space[1] + 2,
              borderRadius: theme.radius.xxl,
              borderWidth: theme.border.hairline,
              borderColor: theme.colors.borderSubtle,
              backgroundColor: theme.colors.surface,
              shadowColor: theme.colors.shadow,
              shadowOpacity: 1,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 8 }
            }}
          >
            <ContextOption
              label="Todas as caixas"
              accent={theme.colors.accent}
              selected={snapshot.view.contextId === 'all'}
              onPress={() => {
                actions.setContext('all');
                setMenuOpen(false);
              }}
            />
            {snapshot.contexts.map((context) => (
              <ContextOption
                key={context.id}
                label={context.name}
                accent={theme.colors[contextAccent(context.kind)]}
                selected={snapshot.view.contextId === context.id}
                onPress={() => {
                  actions.setContext(context.id);
                  setMenuOpen(false);
                }}
              />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function ContextOption({
  label,
  accent,
  selected,
  onPress
}: {
  label: string;
  accent: string;
  selected: boolean;
  onPress: () => void;
}): ReactElement {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        height: 34,
        paddingHorizontal: theme.space[2],
        borderRadius: theme.radius.lg,
        backgroundColor: selected ? theme.colors.accentMuted : 'transparent'
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: theme.radius.pill, backgroundColor: accent }} />
      <Text
        style={{
          ...typeStyle(theme, 'body'),
          flex: 1,
          color: selected ? theme.colors.accent : theme.colors.textPrimary
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function EmptyState({ query, loading }: { query: string; loading: boolean }): ReactElement {
  const theme = useTheme();
  return (
    <View style={{ padding: theme.space[6], gap: theme.space[2] }}>
      {loading && <ActivityIndicator accessibilityLabel="Carregando mensagens" color={theme.colors.accent} />}
      <Text style={{ ...typeStyle(theme, 'readerName'), color: theme.colors.textPrimary }}>
        {loading ? 'Carregando mensagens…' : query.length > 0 ? 'Nada encontrado' : 'Caixa livre'}
      </Text>
      <Text style={{ ...typeStyle(theme, 'body'), color: theme.colors.textSecondary }}>
        {loading
          ? 'Buscando suas mensagens e conversas.'
          : query.length > 0
          ? `Nenhuma conversa corresponde a “${query}”. Tente from:, context: ou in:chat.`
          : 'Nenhuma conversa neste contexto. Ao chegar algo novo, aparece aqui.'}
      </Text>
    </View>
  );
}
