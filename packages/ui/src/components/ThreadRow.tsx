import { useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  contextAccent,
  formatThreadTime,
  threadParticipantsLabel,
  type ContextId,
  type UnifiedThread
} from '@mail/core';
import { useTheme } from '../theme/MailThemeProvider';
import { useMailSnapshot } from '../store/MailStoreProvider';
import { typeStyle } from '../theme/typography';
import { Glyph } from './LucideGlyph';

export interface ThreadRowProps {
  thread: UnifiedThread;
  selected: boolean;
  showContextDot: boolean;
  onPress: () => void;
  variant?: 'desktop' | 'mobile';
  isLast?: boolean;
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
  showContextDot,
  onPress,
  variant = 'desktop',
  isLast = false
}: ThreadRowProps): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const [hovered, setHovered] = useState(false);
  const mobile = variant === 'mobile';

  const primaryContextId: ContextId | undefined = thread.contextIds[0];
  const context = snapshot.contexts.find((item) => item.id === primaryContextId);
  const accent = theme.colors[contextAccent(context?.kind ?? 'custom')];
  const unread = thread.unreadCount > 0;
  const dotSize = mobile ? 5 : 6;
  const contentInset = mobile ? theme.layout.mobileRowContentInset : theme.layout.rowContentInset;
  const inset = theme.layout.rowDotInset;

  const background = selected
    ? theme.colors.surfaceSelected
    : hovered
      ? theme.colors.surfaceHover
      : theme.colors.surface;

  const nameRole = mobile ? 'rowNameMobile' : 'rowName';
  const subjectRole = mobile ? 'rowSubjectMobile' : 'rowSubject';
  const snippetRole = mobile ? 'rowSnippetMobile' : 'rowSnippet';
  const metaRole = mobile ? 'rowMetaMobile' : 'rowMeta';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Não lida. ' : ''}${threadParticipantsLabel(thread)}. ${thread.subject}`}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={{
        height: mobile ? theme.layout.mobileRowHeight : theme.layout.rowHeight,
        backgroundColor: background,
        justifyContent: 'center'
      }}
    >
      {selected && !mobile && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: theme.border.bar,
            backgroundColor: theme.colors.selectedBar
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
          <View style={{ width: contentInset - inset, alignItems: 'flex-start' }}>
            <View
              accessibilityLabel={context === undefined ? undefined : `Contexto ${context.name}`}
              style={{
                width: dotSize,
                height: dotSize,
                borderRadius: theme.radius.pill,
                backgroundColor: accent,
                opacity: showContextDot ? 1 : 0
              }}
            />
          </View>
          <Text numberOfLines={1} style={{ ...typeStyle(theme, nameRole), flex: 1, color: theme.colors.textPrimary }}>
            {threadParticipantsLabel(thread, 2)}
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
            {thread.subject}
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
  );
}
