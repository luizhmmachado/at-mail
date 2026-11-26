import { useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, SectionList, Text, TextInput, View, type ImageSourcePropType } from 'react-native';
import {
  contextAccent,
  formatShortcut,
  groupByDate,
  type FeedResult,
  type ThreadId,
  type UnifiedThread
} from '@mail/core';
import { useTheme } from '../theme/MailThemeProvider';
import { useAppStore, useMailActions, useMailSnapshot } from '../store/MailStoreProvider';
import { currentPlatform } from '../platform';
import { typeStyle } from '../theme/typography';
import { ChannelTabs } from './ChannelTabs';
import { Glyph } from './LucideGlyph';
import { ThreadRow } from './ThreadRow';

export interface UnifiedThreadListProps {
  appIcon?: ImageSourcePropType;
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
export function UnifiedThreadList({ appIcon, feed, onSelectThread, onCompose, onOpenSettings, fullScreen = false }: UnifiedThreadListProps): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionThread, setActionThread] = useState<UnifiedThread>();

  const sections = useMemo(
    () => groupByDate(feed.threads).map((section) => ({ title: section.label, data: section.threads })),
    [feed.threads]
  );

  const mobile = fullScreen;
  const title =
    snapshot.view.emailFolder === 'archived'
      ? 'Arquivados'
      : snapshot.view.emailFolder === 'trash'
      ? 'Lixeira'
      : snapshot.view.starredOnly
      ? 'Favoritos'
      : snapshot.view.contextId === 'all'
      ? 'Todas as caixas'
      : (snapshot.contexts.find((context) => context.id === snapshot.view.contextId)?.name ?? 'Todas as caixas');
  const selectionMode = snapshot.ui.selectingThreads;
  const selectedCount = snapshot.ui.selectedThreadIds.length;

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
          {mobile && appIcon && (
            <View style={{ marginRight: 4 }}>
              <Image source={appIcon} accessibilityLabel="@mail" style={{ width: 26, height: 26, borderRadius: 5 }} />
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
              {selectionMode ? `${selectedCount} ${selectedCount === 1 ? 'selecionado' : 'selecionados'}` : title}
            </Text>
            <Glyph name="chevron-down" size={mobile ? 20 : 18} color={theme.colors.textSecondary} />
          </Pressable>

          <View style={{ flex: 1 }} />

          {selectionMode && (
            <Pressable accessibilityRole="button" accessibilityLabel="Cancelar seleção" onPress={actions.clearThreadSelection}>
              <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.accent }}>Cancelar</Text>
            </Pressable>
          )}

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
        <FolderTabs />
        {!selectionMode && snapshot.view.channel !== 'chat' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Selecionar e-mails"
            onPress={() => actions.setSelectingThreads(true)}
            style={{ position: mobile ? 'relative' : 'absolute', alignSelf: mobile ? 'flex-end' : undefined, right: mobile ? undefined : theme.space[4], top: mobile ? undefined : 78, marginTop: mobile ? 8 : 0, paddingVertical: 4 }}
          >
            <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.accent }}>Selecionar</Text>
          </Pressable>
        )}
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
              {selectionMode && !mobile && section === sections[0] && (
                <Pressable accessibilityRole="button" onPress={actions.selectAllThreads}>
                  <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.accent }}>Selecionar todos</Text>
                </Pressable>
              )}
            </View>
          );
        }}
        renderItem={({ item, index, section }) => (
          <ThreadRow
            thread={item}
            selected={snapshot.view.selectedThreadId === item.id}
            showContextIndicator={snapshot.view.contextId === 'all'}
            variant={mobile ? 'mobile' : 'desktop'}
            isLast={index === section.data.length - 1}
            selectionMode={selectionMode && item.channel === 'email'}
            selectedForAction={item.channel === 'email' && snapshot.ui.selectedThreadIds.includes(item.id)}
            onToggleSelection={() => actions.toggleThreadSelection(item.id)}
            onOpenActions={() => setActionThread(item)}
            onPress={() => onSelectThread(item.id)}
          />
        )}
        ListEmptyComponent={<EmptyState query={snapshot.view.query} loading={snapshot.sync.status === 'syncing' && snapshot.sync.lastSyncedAt === undefined} />}
        contentContainerStyle={{ paddingBottom: fullScreen ? theme.space[10] : theme.space[6] }}
      />

      {mobile && selectionMode && selectedCount > 0 && <BulkActionBar />}

      <Modal transparent animationType="slide" visible={actionThread !== undefined} onRequestClose={() => setActionThread(undefined)}>
        {actionThread !== undefined && (
          <Pressable accessibilityLabel="Fechar ações do e-mail" onPress={() => setActionThread(undefined)} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
            <Pressable onPress={(event) => event.stopPropagation()} style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.xxl, borderTopRightRadius: theme.radius.xxl, padding: theme.space[4], gap: 3 }}>
              <Text numberOfLines={1} style={{ ...typeStyle(theme, 'readerName'), color: theme.colors.textPrimary }}>{actionThread.subject}</Text>
              <Text style={{ ...typeStyle(theme, 'composeHint'), color: theme.colors.textSecondary, marginBottom: theme.space[2] }}>
                {actionThread.participants[0]?.name ?? 'E-mail'}
              </Text>
              <ActionSheetButton label={actionThread.unreadCount > 0 ? 'Marcar como lido' : 'Marcar como não lido'} onPress={() => { actions.markThreadRead(actionThread.id, actionThread.unreadCount > 0); setActionThread(undefined); }} />
              <ActionSheetButton label={actionThread.flags.isStarred ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} onPress={() => { void actions.toggleThreadStar(actionThread.id); setActionThread(undefined); }} />
              <ActionSheetButton label={actionThread.emailFolder === 'inbox' ? 'Arquivar e-mail' : 'Mover para a caixa de entrada'} onPress={() => { actionThread.emailFolder === 'inbox' ? actions.archiveThread(actionThread.id) : actions.restoreThread(actionThread.id); setActionThread(undefined); }} />
              <ActionSheetButton label={actionThread.emailFolder === 'trash' ? 'Mover para a caixa de entrada' : 'Mover para a lixeira'} danger={actionThread.emailFolder !== 'trash'} onPress={() => { actionThread.emailFolder === 'trash' ? actions.restoreThread(actionThread.id) : actions.trashThread(actionThread.id); setActionThread(undefined); }} />
              <ActionSheetButton label="Selecionar e-mail" onPress={() => { actions.toggleThreadSelection(actionThread.id); setActionThread(undefined); }} />
              <ActionSheetButton label="Cancelar" onPress={() => setActionThread(undefined)} />
            </Pressable>
          </Pressable>
        )}
      </Modal>

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
              selected={snapshot.view.contextId === 'all' && !snapshot.view.starredOnly}
              onPress={() => {
                actions.setContext('all');
                setMenuOpen(false);
              }}
            />
            <ContextOption
              label="Favoritos"
              accent={theme.colors.accent}
              selected={snapshot.view.starredOnly}
              onPress={() => {
                actions.setStarredOnly(true);
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

function FolderTabs(): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();
  const folders = [
    ['inbox', 'Caixa'],
    ['archived', 'Arquivados'],
    ['trash', 'Lixeira']
  ] as const;
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', height: 38, marginTop: 6, borderBottomWidth: theme.border.hairline, borderBottomColor: theme.colors.borderSubtle }}>
      {folders.map(([id, label]) => {
        const selected = snapshot.view.emailFolder === id;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => actions.setEmailFolder(id)}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderBottomWidth: selected ? 2 : 0, borderBottomColor: theme.colors.accent }}
          >
            <Text style={{ ...typeStyle(theme, 'segment', selected ? 'medium' : 'regular'), color: selected ? theme.colors.accent : theme.colors.textSecondary }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function BulkActionBar(): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();
  const store = useAppStore();
  const apply = (action: 'read' | 'unread' | 'favorite' | 'archive' | 'trash'): void => {
    if (action === 'archive') actions.moveThreads(snapshot.ui.selectedThreadIds, 'archived');
    if (action === 'trash') actions.moveThreads(snapshot.ui.selectedThreadIds, 'trash');
    for (const id of snapshot.ui.selectedThreadIds) {
      if (action === 'read') actions.markThreadRead(id, true);
      if (action === 'unread') actions.markThreadRead(id, false);
      if (action === 'favorite') {
        const thread = store.getThread(id);
        if (thread !== undefined && !thread.flags.isStarred) void actions.toggleThreadStar(id);
      }
    }
    actions.clearThreadSelection();
  };
  const count = snapshot.ui.selectedThreadIds.length;
  return (
    <View style={{ paddingHorizontal: theme.space[3], paddingTop: theme.space[2], paddingBottom: theme.space[1], borderTopWidth: theme.border.hairline, borderTopColor: theme.colors.borderSubtle, backgroundColor: theme.colors.surface }}>
      <Text style={{ ...typeStyle(theme, 'composeHint'), color: theme.colors.textSecondary, marginBottom: 4 }}>
        Aplicar a {count} {count === 1 ? 'e-mail' : 'e-mails'}
      </Text>
      <View style={{ flexDirection: 'row' }}>
        <BulkAction label="Lido" onPress={() => apply('read')} />
        <BulkAction label="Não lido" onPress={() => apply('unread')} />
        <BulkAction label="Favorito" onPress={() => apply('favorite')} />
        <BulkAction label="Arquivar" onPress={() => apply('archive')} />
        <BulkAction label="Excluir" danger onPress={() => apply('trash')} />
      </View>
    </View>
  );
}

function BulkAction({ label, danger = false, onPress }: { label: string; danger?: boolean; onPress: () => void }): ReactElement {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ ...typeStyle(theme, 'composeHint', 'medium'), color: danger ? theme.colors.danger : theme.colors.textPrimary, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

function ActionSheetButton({ label, danger = false, onPress }: { label: string; danger?: boolean; onPress: () => void }): ReactElement {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ height: 48, alignItems: 'flex-start', justifyContent: 'center', paddingHorizontal: theme.space[1] }}>
      <Text style={{ ...typeStyle(theme, 'body'), color: danger ? theme.colors.danger : theme.colors.textPrimary }}>{label}</Text>
    </Pressable>
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
          : 'Nenhuma conversa neste contexto ou pasta. Ao chegar algo novo, aparece aqui.'}
      </Text>
    </View>
  );
}
