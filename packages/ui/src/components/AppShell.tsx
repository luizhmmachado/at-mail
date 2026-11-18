import { useMemo, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { contextAccent, type ThreadId } from '@mail/core';
import { MailThemeProvider, useTheme } from '../theme/MailThemeProvider';
import { useFeed, useMailActions, useMailSnapshot, useThreadSelectionHandler } from '../store/MailStoreProvider';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { CommandPalette } from './CommandPalette';
import { ContextSwitcher } from './ContextSwitcher';
import { ReaderPane } from './ReaderPane';
import { UnifiedThreadList } from './UnifiedThreadList';

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
  const actions = useMailActions();
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
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.canvas }}>
        {mobilePane === 'list' || selectedThread === undefined ? (
          <>
            <MobileHeader />
            <UnifiedThreadList feed={feed} onSelectThread={handleSelect} fullScreen />
          </>
        ) : (
          <ReaderPane thread={selectedThread} onBack={() => setMobilePane('list')} />
        )}
        <CommandPalette />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.colors.canvas }}>
      <View
        style={{
          width: snapshot.ui.sidebarCollapsed ? theme.layout.sidebarCollapsedWidth : theme.layout.sidebarWidth,
          borderRightWidth: theme.border.hairline,
          borderRightColor: theme.colors.borderSubtle,
          backgroundColor: theme.colors.canvas
        }}
      >
        <Sidebar />
      </View>

      <View
        style={{
          width: theme.layout.listWidth,
          borderRightWidth: theme.border.hairline,
          borderRightColor: theme.colors.borderSubtle
        }}
      >
        <UnifiedThreadList feed={feed} onSelectThread={handleSelect} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <ReaderPane thread={selectedThread} />
      </View>

      <CommandPalette />
      <StatusBar />
    </View>
  );
}

function Sidebar(): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const { feed } = useFeed();
  const actions = useMailActions();
  const collapsed = snapshot.ui.sidebarCollapsed;

  const syncLabel =
    snapshot.sync.status === 'syncing'
      ? `sincronizando ${snapshot.sync.inFlightAccounts.length} contas`
      : snapshot.accounts.some((account) => account.status === 'reauth-required')
        ? 'reautorização necessária'
        : 'tudo sincronizado';

  return (
    <View style={{ flex: 1, paddingBottom: theme.space[2] }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          paddingHorizontal: collapsed ? 0 : theme.space[3],
          height: theme.layout.headerHeight
        }}
      >
        {!collapsed && (
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: theme.typography.size.bodyLarge,
              fontWeight: theme.weights.semibold,
              letterSpacing: theme.typography.tracking.tight,
              color: theme.colors.textPrimary
            }}
          >
            @mail
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={collapsed ? 'Expandir menu' : 'Recolher menu'}
          onPress={() => actions.toggleSidebar(!collapsed)}
          style={{ padding: theme.space[1] }}
        >
          <Text style={{ fontSize: 12, color: theme.colors.textTertiary }}>{collapsed ? '»' : '«'}</Text>
        </Pressable>
      </View>

      <ContextSwitcher feed={feed} compact={collapsed} />

      <View style={{ flex: 1 }} />

      <View style={{ paddingHorizontal: theme.space[3], gap: theme.space[2] }}>
        {!collapsed && (
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: theme.typography.size.micro,
              color: snapshot.sync.status === 'error' ? theme.colors.danger : theme.colors.textTertiary
            }}
          >
            {syncLabel}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Alternar tema"
          onPress={() => actions.setThemeMode(snapshot.ui.themeMode === 'light' ? 'dark' : 'light')}
          style={{
            alignSelf: collapsed ? 'center' : 'flex-start',
            paddingHorizontal: theme.space[2],
            paddingVertical: 3,
            borderRadius: theme.radius.sm,
            borderWidth: theme.border.hairline,
            borderColor: theme.colors.borderSubtle
          }}
        >
          <Text
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: theme.typography.size.micro,
              color: theme.colors.textSecondary
            }}
          >
            {collapsed ? (snapshot.ui.themeMode === 'light' ? '☀' : '☾') : snapshot.ui.themeMode === 'light' ? 'Claro' : 'Escuro'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function MobileHeader(): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();

  return (
    <View
      style={{
        borderBottomWidth: theme.border.hairline,
        borderBottomColor: theme.colors.borderSubtle,
        backgroundColor: theme.colors.canvas
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: theme.layout.headerHeight,
          paddingHorizontal: theme.space[3]
        }}
      >
        <Text
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: theme.typography.size.bodyLarge,
            fontWeight: theme.weights.semibold,
            color: theme.colors.textPrimary
          }}
        >
          @mail
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Buscar"
          onPress={() => actions.toggleCommandPalette(true)}
          style={{ padding: theme.space[2] }}
        >
          <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>⌕</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: theme.space[3], paddingBottom: theme.space[2], gap: theme.space[1] }}>
        <MobileContextPill
          label="Tudo"
          selected={snapshot.view.contextId === 'all'}
          onPress={() => actions.setContext('all')}
        />
        {snapshot.contexts.map((context) => (
          <MobileContextPill
            key={context.id}
            label={context.name}
            accent={theme.colors[contextAccent(context.kind)]}
            selected={snapshot.view.contextId === context.id}
            onPress={() => actions.setContext(context.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function MobileContextPill({
  label,
  accent,
  selected,
  onPress
}: {
  label: string;
  accent?: string;
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
        gap: 5,
        paddingHorizontal: theme.space[2] + 2,
        paddingVertical: 5,
        borderRadius: theme.radius.pill,
        borderWidth: theme.border.hairline,
        borderColor: selected ? theme.colors.borderStrong : theme.colors.borderSubtle,
        backgroundColor: selected ? theme.colors.surfaceSelected : 'transparent'
      }}
    >
      {accent !== undefined && (
        <View style={{ width: 5, height: 5, borderRadius: theme.radius.pill, backgroundColor: accent }} />
      )}
      <Text
        style={{
          fontFamily: theme.fonts.sans,
          fontSize: theme.typography.size.small,
          color: selected ? theme.colors.textPrimary : theme.colors.textSecondary
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function StatusBar(): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.canvas,
        borderTopWidth: theme.border.hairline,
        borderTopColor: theme.colors.borderSubtle
      }}
    >
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: theme.typography.size.micro,
          color: theme.colors.textTertiary
        }}
      >
        {snapshot.accounts.length} contas · {snapshot.contexts.length} contextos · J/K navegar · E arquivar · R responder
      </Text>
    </View>
  );
}
