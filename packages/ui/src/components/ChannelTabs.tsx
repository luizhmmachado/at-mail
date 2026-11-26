import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ChannelFilter, FeedResult } from '@mail/core';
import { useTheme } from '../theme/MailThemeProvider';
import { useMailActions, useMailSnapshot } from '../store/MailStoreProvider';
import { typeStyle } from '../theme/typography';

export interface ChannelTabsProps {
  feed: FeedResult;
  variant?: 'desktop' | 'mobile';
}

const TABS: { id: ChannelFilter; label: string }[] = [
  { id: 'all', label: 'Unified' },
  { id: 'email', label: 'Email' },
  { id: 'chat', label: 'Chat' }
];

/**
 * Controle segmentado do frame: trilho de 320×32 (350×36 no mobile), raio 6/7,
 * polegar branco de 26/30 com raio 4/5 e rótulos de 12 px.
 */
export function ChannelTabs({ feed, variant = 'desktop' }: ChannelTabsProps): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();
  const mobile = variant === 'mobile';

  const height = mobile ? theme.layout.mobileSegmentHeight : theme.layout.segmentHeight;
  const radius = mobile ? theme.layout.mobileSegmentRadius : theme.layout.segmentRadius;
  const thumbRadius = mobile ? theme.layout.mobileSegmentThumbRadius : theme.layout.segmentThumbRadius;
  const inset = theme.layout.segmentThumbInset;

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        height,
        padding: inset,
        borderRadius: radius,
        backgroundColor: mobile ? theme.colors.segmentTrackMobile : theme.colors.segmentTrack
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
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${tab.label}${unread > 0 ? `, ${unread} unread` : ''}`}
            onPress={() => actions.setChannel(tab.id)}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: thumbRadius,
              backgroundColor: selected ? theme.colors.segmentThumb : 'transparent'
            }}
          >
            <Text
              style={{
                ...typeStyle(theme, 'segment', selected ? 'medium' : 'regular'),
                color: selected ? theme.colors.textPrimary : theme.colors.textSecondary
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
