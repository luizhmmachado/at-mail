import type { ReactElement } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import {
  contextAccent,
  formatThreadTime,
  threadParticipantsLabel,
  type ContextId,
  type UnifiedThread
} from '@mail/core';
import { useTheme } from '../theme/MailThemeProvider';
import { useMailActions, useMailSnapshot } from '../store/MailStoreProvider';
import { typeStyle } from '../theme/typography';
import { Glyph } from './LucideGlyph';

export interface ThreadRowProps {
  thread: UnifiedThread;
  selected: boolean;
  showContextIndicator: boolean;
  onPress: () => void;
  variant?: 'desktop' | 'mobile';
  isLast?: boolean;
  selectionMode?: boolean;
  selectedForAction?: boolean;
  onToggleSelection?: () => void;
  onOpenActions?: () => void;
}

/**
 * Linha da caixa unificada.
 *
 * Desktop: 72 px, conteúdo a 16 px, nome/subassunto em 12/15, trecho em 10,5/13
 * e divisor de 1 px recuado 24 px. Mobile: 84 px, conteúdo a 26 px e tipografia
 * uma escala acima (13/16 e 11/13).
 */
export function ThreadRow({
  thread,
  selected,
  showContextIndicator,
  onPress,
  variant = 'desktop',
  isLast = false,
  selectionMode = false,
  selectedForAction = false,
  onToggleSelection,
  onOpenActions
}: ThreadRowProps): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();
  const mobile = variant === 'mobile';

  const primaryContextId: ContextId | undefined = thread.contextIds[0];
  const context = snapshot.contexts.find((item) => item.id === primaryContextId);
  const accent = theme.colors[contextAccent(context?.kind ?? 'custom')];
  const chatAvatarUrl = thread.channel === 'chat' ? thread.participants.find((participant) => participant.avatarUrl)?.avatarUrl : undefined;
  const unread = thread.unreadCount > 0;
  const participantsLabel = threadParticipantsLabel(thread, 2);
  const primaryLabel = thread.channel === 'chat' ? thread.subject : participantsLabel;
  const secondaryLabel = thread.channel === 'chat' ? participantsLabel : thread.subject;
  const contentInset = mobile ? theme.layout.mobileRowContentInset : theme.layout.rowContentInset;
  const inset = theme.layout.rowDotInset;

  const background = selected
    ? theme.colors.surfaceSelected
    : theme.colors.surface;

  const nameRole = mobile ? 'rowNameMobile' : 'rowName';
  const subjectRole = mobile ? 'rowSubjectMobile' : 'rowSubject';
  const snippetRole = mobile ? 'rowSnippetMobile' : 'rowSnippet';
  const metaRole = mobile ? 'rowMetaMobile' : 'rowMeta';

  return (
    <View style={{ height: mobile ? theme.layout.mobileRowHeight : theme.layout.rowHeight }}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Não lida. ' : ''}${primaryLabel}. ${secondaryLabel}`}
      onPress={selectionMode ? onToggleSelection : onPress}
      onLongPress={mobile ? onOpenActions : undefined}
      style={{
        height: mobile ? theme.layout.mobileRowHeight : theme.layout.rowHeight,
        backgroundColor: background,
        justifyContent: 'center'
      }}
    >
      {(showContextIndicator || (selected && !mobile)) && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: showContextIndicator ? 4 : theme.border.bar,
            backgroundColor: showContextIndicator ? accent : theme.colors.selectedBar
          }}
        />
      )}

      {selectionMode && (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selectedForAction }}
          accessibilityLabel={selectedForAction ? 'Remover e-mail da seleção' : 'Selecionar e-mail'}
          onPress={onToggleSelection}
          style={{
            position: 'absolute',
            zIndex: 2,
            left: 0,
            top: (mobile ? theme.layout.mobileRowHeight : theme.layout.rowHeight) / 2 - (mobile ? 24 : 16),
            width: mobile ? 48 : 47,
            height: mobile ? 48 : 32,
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <View
            style={{
              width: mobile ? 18 : 14,
              height: mobile ? 18 : 14,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: selectedForAction ? theme.colors.accent : theme.colors.borderStrong,
              borderRadius: 4,
              backgroundColor: selectedForAction ? theme.colors.accent : 'transparent'
            }}
          >
            {selectedForAction && <Text style={{ color: '#ffffff', fontSize: mobile ? 12 : 10, fontWeight: '700' }}>✓</Text>}
          </View>
        </Pressable>
      )}

      <View
        style={{
          paddingLeft: mobile ? inset : inset,
          paddingRight: mobile ? theme.layout.mobilePaddingX : theme.layout.rowPaddingX,
          paddingVertical: mobile ? 10 : 9,
          gap: 4
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: contentInset - inset + (selectionMode ? mobile ? 22 : 18 : 0) }} />
          {chatAvatarUrl !== undefined && (
            <Image
              accessibilityLabel={`Foto de ${threadParticipantsLabel(thread, 1)}`}
              source={{ uri: chatAvatarUrl }}
              resizeMode="cover"
              style={{ width: 22, height: 22, marginRight: 7, borderRadius: theme.radius.pill }}
            />
          )}
          <Text numberOfLines={1} style={{ ...typeStyle(theme, nameRole), flex: 1, color: theme.colors.textPrimary }}>
            {primaryLabel}
          </Text>
          <Text
            style={{
              ...typeStyle(theme, metaRole),
              color: theme.colors.textSecondary,
              fontVariant: ['tabular-nums'],
              marginLeft: theme.space[2]
            }}
          >
            {formatThreadTime(thread.lastActivityAt)}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: contentInset - inset + (selectionMode ? mobile ? 22 : 18 : 0) }} />
          <View style={{ marginRight: mobile ? 7 : 7 }}>
            <Glyph
              name={thread.channel === 'chat' ? 'chat' : 'mail'}
              size={mobile ? 13 : 12}
              color={theme.colors.textSecondary}
            />
          </View>
          <Text
            numberOfLines={1}
            style={{
              ...typeStyle(theme, subjectRole),
              flex: 1,
              color: theme.colors.textPrimary
            }}
          >
            {secondaryLabel}
          </Text>
          {mobile && context !== undefined && (
            <Text
              numberOfLines={1}
              style={{
                ...typeStyle(theme, 'rowContextMobile'),
                color: theme.colors.textTertiary,
                marginLeft: theme.space[2]
              }}
            >
              {context.name}
            </Text>
          )}
          {thread.channel === 'email' && <View style={{ width: 20, marginLeft: theme.space[2] }} />}
          {unread && (
            <View
              accessibilityLabel="Não lida"
              style={{
                width: 5,
                height: 5,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.unreadDot,
                marginLeft: theme.space[2]
              }}
            />
          )}
        </View>

        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: contentInset - inset + (selectionMode ? mobile ? 22 : 18 : 0) }} />
          <Text
            numberOfLines={1}
            style={{
              ...typeStyle(theme, snippetRole),
              flex: 1,
              color: theme.colors.textSecondary
            }}
          >
            {thread.snippet}
          </Text>
        </View>
      </View>

      {!isLast && (
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: mobile ? theme.layout.mobileRowContentInset : theme.layout.dividerInset,
            right: mobile ? theme.layout.mobilePaddingX : theme.layout.rowPaddingX,
            height: theme.border.hairline,
            backgroundColor: theme.colors.divider
          }}
        />
      )}
    </Pressable>
    {thread.channel === 'email' && mobile && !selectionMode && thread.emailFolder !== 'inbox' && (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={thread.emailFolder === 'trash' ? 'Restaurar e-mail' : 'Mover e-mail para a caixa de entrada'}
        onPress={() => actions.restoreThread(thread.id)}
        style={{ position: 'absolute', right: theme.layout.mobilePaddingX, top: 42, minHeight: 28, justifyContent: 'center' }}
      >
        <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.accent }}>
          {thread.emailFolder === 'trash' ? 'Restore' : 'Move to inbox'}
        </Text>
      </Pressable>
    )}
    {thread.channel === 'email' && !selectionMode && (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={thread.flags.isStarred ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        accessibilityState={{ disabled: snapshot.ui.pendingStarThreadIds.includes(thread.id) }}
        disabled={snapshot.ui.pendingStarThreadIds.includes(thread.id)}
        onPress={() => void actions.toggleThreadStar(thread.id)}
        style={{
          position: 'absolute',
          top: mobile ? 35 : 29,
          right: mobile ? theme.layout.mobilePaddingX + (unread ? 13 : 0) : (theme.layout.rowPaddingX + (unread ? 13 : 0)),
          padding: 3
        }}
      >
        <Glyph name="star" size={14} color={thread.flags.isStarred ? theme.colors.accent : theme.colors.textSecondary} fill={thread.flags.isStarred ? theme.colors.accent : 'none'} />
      </Pressable>
    )}
    </View>
  );
}
