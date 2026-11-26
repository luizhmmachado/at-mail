import { useState, type ReactElement } from 'react';
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
  const [hovered, setHovered] = useState(false);
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

  const background = selectedForAction
    ? theme.colors.accentMuted
    : selected
    ? theme.colors.surfaceSelected
    : hovered
      ? theme.colors.surfaceHover
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
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
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

      <View
        style={{
          paddingLeft: mobile ? inset : inset,
          paddingRight: mobile ? theme.layout.mobilePaddingX : theme.layout.rowPaddingX,
          paddingVertical: mobile ? 10 : 9,
          gap: 4
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {selectionMode ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selectedForAction }}
              accessibilityLabel={selectedForAction ? 'Remover e-mail da seleção' : 'Selecionar e-mail'}
              onPress={onToggleSelection}
              style={{
                width: 18,
                height: 18,
                marginRight: contentInset - inset - 18,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1.5,
                borderColor: selectedForAction ? theme.colors.accent : theme.colors.borderStrong,
                borderRadius: 5,
                backgroundColor: selectedForAction ? theme.colors.accent : 'transparent'
              }}
            >
              {selectedForAction && <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '700' }}>✓</Text>}
            </Pressable>
          ) : <View style={{ width: contentInset - inset }} />}
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
          <View style={{ width: contentInset - inset }} />
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
          <View style={{ width: contentInset - inset }} />
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
    {thread.channel === 'email' && !selectionMode && mobile && (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ações para ${thread.subject}`}
        onPress={onOpenActions}
        style={{ position: 'absolute', top: 34, right: 20, padding: 4 }}
      >
        <Glyph name="dots" size={17} color={theme.colors.textSecondary} />
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
          right: mobile ? 48 : (theme.layout.rowPaddingX + (unread ? 13 : 0)),
          padding: 3
        }}
      >
        <Glyph name="star" size={14} color={thread.flags.isStarred ? theme.colors.accent : theme.colors.textSecondary} fill={thread.flags.isStarred ? theme.colors.accent : 'none'} />
      </Pressable>
    )}
    {thread.channel === 'email' && !selectionMode && hovered && !mobile && (
      <View
        style={{
          position: 'absolute',
          top: 19,
          right: 35,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          paddingHorizontal: 5,
          backgroundColor: background
        }}
      >
        <RowAction label={unread ? 'Marcar como lida' : 'Marcar como não lida'} onPress={() => actions.markThreadRead(thread.id, unread)}>
          <Glyph name="mail" size={14} color={theme.colors.textSecondary} />
        </RowAction>
        <RowAction label={thread.emailFolder === 'inbox' ? 'Arquivar' : 'Mover para a caixa de entrada'} onPress={() => thread.emailFolder === 'inbox' ? actions.archiveThread(thread.id) : actions.restoreThread(thread.id)}>
          <Glyph name={thread.emailFolder === 'inbox' ? 'archive' : 'inbox'} size={14} color={theme.colors.textSecondary} />
        </RowAction>
        <RowAction label={thread.emailFolder === 'trash' ? 'Mover para a caixa de entrada' : 'Excluir'} onPress={() => thread.emailFolder === 'trash' ? actions.restoreThread(thread.id) : actions.trashThread(thread.id)}>
          <Glyph name={thread.emailFolder === 'trash' ? 'inbox' : 'trash'} size={14} color={theme.colors.textSecondary} />
        </RowAction>
      </View>
    )}
    </View>
  );
}

function RowAction({ label, onPress, children }: { label: string; onPress: () => void; children: ReactElement }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={(event) => { event.stopPropagation(); onPress(); }} style={{ width: 25, height: 25, alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </Pressable>
  );
}
