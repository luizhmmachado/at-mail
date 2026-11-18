import { useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ChannelFilter, FeedResult } from '@mail/core';
import { useTheme } from '../theme/MailThemeProvider';
import { useMailActions, useMailSnapshot } from '../store/MailStoreProvider';

export interface ChannelTabsProps {
  feed: FeedResult;
}

const TABS: { id: ChannelFilter; label: string }[] = [
  { id: 'all', label: 'Tudo' },
  { id: 'email', label: 'E-mail' },
  { id: 'chat', label: 'Chat' }
];

export function ChannelTabs({ feed }: ChannelTabsProps): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[1],
        borderBottomWidth: theme.border.hairline,
        borderBottomColor: theme.colors.borderSubtle,
        paddingHorizontal: theme.space[3],
        paddingBottom: theme.space[2]
      }}
    >
      {TABS.map((tab) => {
        const selected = snapshot.view.channel === tab.id;
        const unread =
          tab.id === 'email'
            ? feed.unreadByChannel.email
            : tab.id === 'chat'
              ? feed.unreadByChannel.chat
              : feed.totalUnread;

        return (
          <TabButton
            key={tab.id}
            label={tab.label}
            unread={unread}
            selected={selected}
            onPress={() => actions.setChannel(tab.id)}
          />
        );
      })}
    </View>
  );
}

interface TabButtonProps {
  label: string;
  unread: number;
  selected: boolean;
  onPress: () => void;
}

function TabButton({ label, unread, selected, onPress }: TabButtonProps): ReactElement {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[1],
        paddingHorizontal: theme.space[2] + 2,
        paddingVertical: theme.space[1] + 1,
        borderRadius: theme.radius.md,
        backgroundColor: selected
          ? theme.colors.surfaceSelected
          : hovered
            ? theme.colors.surfaceHover
            : 'transparent'
      }}
    >
      <Text
        style={{
          fontFamily: theme.fonts.sans,
          fontSize: theme.typography.size.small,
          fontWeight: selected ? theme.weights.medium : theme.weights.regular,
          color: selected ? theme.colors.textPrimary : theme.colors.textSecondary
        }}
      >
        {label}
      </Text>
      {unread > 0 && (
        <Text
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: theme.typography.size.micro,
            color: selected ? theme.colors.textSecondary : theme.colors.textTertiary
          }}
        >
          {unread > 99 ? '99+' : unread}
        </Text>
      )}
    </Pressable>
  );
}
