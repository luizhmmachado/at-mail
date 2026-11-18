import { useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  contextAccent,
  formatRelativeTime,
  threadParticipantsLabel,
  type ContextId,
  type UnifiedThread
} from '@mail/core';
import { useTheme } from '../theme/MailThemeProvider';
import { useMailSnapshot } from '../store/MailStoreProvider';

export interface ThreadRowProps {
  thread: UnifiedThread;
  selected: boolean;
  showContextDot: boolean;
  onPress: () => void;
}

export function ThreadRow({ thread, selected, showContextDot, onPress }: ThreadRowProps): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const [hovered, setHovered] = useState(false);

  const primaryContextId: ContextId | undefined = thread.contextIds[0];
  const context = snapshot.contexts.find((item) => item.id === primaryContextId);
  const accent = theme.colors[contextAccent(context?.kind ?? 'custom')];
  const unread = thread.unreadCount > 0;

  const background = selected
    ? theme.colors.surfaceSelected
    : hovered
      ? theme.colors.surfaceHover
      : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Não lida. ' : ''}${thread.subject}. ${threadParticipantsLabel(thread)}`}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={{
        flexDirection: 'row',
        minHeight: theme.layout.rowHeight,
        backgroundColor: background
      }}
    >
      <View
        style={{
          width: 2,
          marginVertical: theme.space[2],
          borderRadius: theme.radius.pill,
          backgroundColor: selected ? accent : 'transparent'
        }}
      />

      <View style={{ flex: 1, paddingHorizontal: theme.space[3], paddingVertical: theme.space[2] + 2, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: theme.typography.size.micro,
              color: thread.channel === 'chat' ? theme.colors.channelChat : theme.colors.channelEmail
            }}
          >
            {thread.channel === 'chat' ? '#' : '✉'}
          </Text>

          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontFamily: theme.fonts.sans,
              fontSize: theme.typography.size.small,
              fontWeight: unread ? theme.weights.semibold : theme.weights.regular,
              color: unread ? theme.colors.textPrimary : theme.colors.textSecondary
            }}
          >
            {threadParticipantsLabel(thread, 2)}
          </Text>

          {showContextDot && (
            <View
              accessibilityLabel={`Contexto ${context?.name ?? 'custom'}`}
              style={{
                width: 5,
                height: 5,
                borderRadius: theme.radius.pill,
                backgroundColor: accent
              }}
            />
          )}

          {thread.flags.hasAttachments && (
            <Text style={{ fontSize: theme.typography.size.micro, color: theme.colors.textTertiary }}>⌘</Text>
          )}

          {thread.flags.isStarred && (
            <Text style={{ fontSize: theme.typography.size.micro, color: theme.colors.warning }}>★</Text>
          )}

          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: theme.typography.size.micro,
              color: theme.colors.textTertiary
            }}
          >
            {formatRelativeTime(thread.lastActivityAt)}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          {unread && (
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.unreadDot
              }}
            />
          )}
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontFamily: theme.fonts.sans,
              fontSize: theme.typography.size.body,
              fontWeight: unread ? theme.weights.medium : theme.weights.regular,
              color: unread ? theme.colors.textPrimary : theme.colors.textSecondary
            }}
          >
            {thread.subject}
          </Text>
          {thread.flags.isMentioned && (
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: theme.typography.size.micro,
                color: theme.colors.channelChat
              }}
            >
              @
            </Text>
          )}
        </View>

        <Text
          numberOfLines={1}
          style={{
            fontFamily: theme.fonts.sans,
            fontSize: theme.typography.size.small,
            color: theme.colors.textTertiary,
            paddingLeft: unread ? theme.space[2] + 1 : 0
          }}
        >
          {thread.snippet}
        </Text>
      </View>
    </Pressable>
  );
}
