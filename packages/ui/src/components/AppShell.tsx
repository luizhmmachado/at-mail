import { useMemo, useState, type ReactElement } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import type { ThreadId } from '@mail/core';
import { MailThemeProvider, useTheme } from '../theme/MailThemeProvider';
import { useFeed, useMailActions, useMailSnapshot, useThreadSelectionHandler } from '../store/MailStoreProvider';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { CommandPalette } from './CommandPalette';
import { WorkspaceRail } from './ContextSwitcher';
import { Glyph, type GlyphName } from './Glyph';
import { ReaderPane } from './ReaderPane';
import { UnifiedThreadList } from './UnifiedThreadList';
import { typeStyle } from '../theme/typography';

type MobilePane = 'list' | 'reader';

export function AppShell(): ReactElement {
  const snapshot = useMailSnapshot();
  return (
    <MailThemeProvider mode={snapshot.ui.themeMode}>
      <ShellBody />
    </MailThemeProvider>
  );
}

function ShellBody(): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const { feed } = useFeed();
  const onSelectThread = useThreadSelectionHandler();
  const { width } = useWindowDimensions();
  const [mobilePane, setMobilePane] = useState<MobilePane>('list');

  const isMobile = width < theme.layout.mobileBreakpoint;

  useKeyboardShortcuts({ enabled: !isMobile });

  const selectedThread = useMemo(
    () => feed.threads.find((thread) => thread.id === snapshot.view.selectedThreadId),
    [feed.threads, snapshot.view.selectedThreadId]
  );

  const handleSelect = (threadId: ThreadId): void => {
    onSelectThread(threadId);
    if (isMobile) setMobilePane('reader');
  };

  if (isMobile) {
    const showReader = mobilePane === 'reader' && selectedThread !== undefined;
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
        <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
          {showReader ? (
            <ReaderPane thread={selectedThread} onBack={() => setMobilePane('list')} />
          ) : (
            <>
              <View style={{ flex: 1 }}>
                <UnifiedThreadList feed={feed} onSelectThread={handleSelect} fullScreen />
              </View>
              <MobileNav active={snapshot.view.channel} />
            </>
          )}
        </View>
        <CommandPalette />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.colors.canvas }}>
      <WorkspaceRail />

      <View
        style={{
          width: theme.layout.listWidth,
          borderRightWidth: theme.border.hairline,
          borderRightColor: theme.colors.borderSubtle,
          backgroundColor: theme.colors.surface
        }}
      >
        <UnifiedThreadList feed={feed} onSelectThread={handleSelect} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <ReaderPane thread={selectedThread} />
      </View>

      <CommandPalette />
    </View>
  );
}

/** Navegação inferior de 84 px do frame mobile. */
function MobileNav({ active }: { active: 'all' | 'email' | 'chat' }): ReactElement {
  const theme = useTheme();
  const actions = useMailActions();
  const snapshot = useMailSnapshot();

  return (
    <View
      accessibilityRole="tablist"
      style={{
        height: theme.layout.mobileBottomNavHeight,
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingTop: theme.space[3],
        borderTopWidth: theme.border.hairline,
        borderTopColor: theme.colors.borderSubtle,
        backgroundColor: theme.colors.surface
      }}
    >
      <NavItem
        name="inbox"
        label="Caixa"
        active={active !== 'chat'}
        onPress={() => actions.setChannel('all')}
      />
      <NavItem
        name="chat"
        label="Chat"
        active={active === 'chat'}
        onPress={() => actions.setChannel('chat')}
      />
      <NavItem
        name="compose"
        label="Escrever"
        active={false}
        onPress={() => {
          if (snapshot.view.selectedThreadId !== undefined) {
            actions.toggleCompose(true);
          } else {
            actions.toggleCommandPalette(true);
          }
        }}
      />
    </View>
  );
}

function NavItem({
  name,
  label,
  active,
  onPress
}: {
  name: GlyphName;
  label: string;
  active: boolean;
  onPress: () => void;
}): ReactElement {
  const theme = useTheme();
  const color = active ? theme.colors.accent : theme.colors.textSecondary;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', gap: 6 }}
    >
      <Glyph name={name} size={21} color={color} />
      <Text
        style={{
          ...typeStyle(theme, 'navLabel', active ? 'medium' : 'regular'),
          color
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
