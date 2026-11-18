import { useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from 'react-native';
import type { AccountId, ContextId, ThreadId, UnifiedThread } from '@mail/core';
import { MailThemeProvider, useTheme } from '../theme/MailThemeProvider';
import { useFeed, useMailActions, useMailSnapshot, useThreadSelectionHandler } from '../store/MailStoreProvider';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { CommandPalette } from './CommandPalette';
import { SettingsModal, WorkspaceRail } from './ContextSwitcher';
import { Glyph, type GlyphName } from './Glyph';
import { ReaderPane } from './ReaderPane';
import { UnifiedThreadList } from './UnifiedThreadList';
import { typeStyle } from '../theme/typography';

type MobilePane = 'list' | 'reader';

export interface AppShellProps {
  onSend?: (thread: UnifiedThread, body: string) => Promise<void>;
  onAddAccount?: () => void;
  onMoveAccounts?: (accountIds: AccountId[], contextId: ContextId) => Promise<void>;
}

export function AppShell({ onSend, onAddAccount, onMoveAccounts }: AppShellProps = {}): ReactElement {
  const snapshot = useMailSnapshot();
  return (
    <MailThemeProvider mode={snapshot.ui.themeMode}>
      <ShellBody onSend={onSend} onAddAccount={onAddAccount} onMoveAccounts={onMoveAccounts} />
    </MailThemeProvider>
  );
}

function ShellBody({ onSend, onAddAccount, onMoveAccounts }: AppShellProps): ReactElement {
  const theme = useTheme();
  const snapshot = useMailSnapshot();
  const { feed } = useFeed();
  const actions = useMailActions();
  const onSelectThread = useThreadSelectionHandler();
  const { width } = useWindowDimensions();
  const [mobilePane, setMobilePane] = useState<MobilePane>('list');
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const openComposer = (): void => {
    const threadId = snapshot.view.selectedThreadId ?? feed.threads[0]?.id;
    if (threadId !== undefined && snapshot.view.selectedThreadId === undefined) onSelectThread(threadId);
    actions.toggleCompose(true);
  };

  if (isMobile) {
    const showReader = mobilePane === 'reader' && selectedThread !== undefined;
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
        <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
          {showReader ? (
              <ReaderPane thread={selectedThread} onBack={() => setMobilePane('list')} onSend={onSend} />
          ) : (
            <>
              <View style={{ flex: 1 }}>
                <UnifiedThreadList
                  feed={feed}
                  onSelectThread={handleSelect}
                  onCompose={openComposer}
                  onOpenSettings={() => setSettingsOpen(true)}
                  fullScreen
                />
              </View>
              <MobileNav active={snapshot.view.channel} onCompose={openComposer} />
            </>
          )}
        </View>
        <SyncStatus />
        <CommandPalette />
        <SettingsModal
          visible={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onAddAccount={onAddAccount}
          onMoveAccounts={onMoveAccounts}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.colors.canvas }}>
      <WorkspaceRail onAddAccount={onAddAccount} onOpenSettings={() => setSettingsOpen(true)} />

      <View
        style={{
          width: theme.layout.listWidth,
          borderRightWidth: theme.border.hairline,
          borderRightColor: theme.colors.borderSubtle,
          backgroundColor: theme.colors.surface
        }}
      >
        <UnifiedThreadList feed={feed} onSelectThread={handleSelect} onCompose={openComposer} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <ReaderPane thread={selectedThread} onSend={onSend} />
      </View>

      <SyncStatus />
      <CommandPalette />
      <SettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onAddAccount={onAddAccount}
        onMoveAccounts={onMoveAccounts}
      />
    </View>
  );
}

/** Feedback persistente e discreto durante a primeira carga/sync incremental. */
function SyncStatus(): ReactElement | null {
  const theme = useTheme();
  const { sync } = useMailSnapshot();
  if (sync.status !== 'syncing') return null;

  return (
    <View
      accessibilityRole="status"
      accessibilityLabel="Atualizando mensagens"
      style={{
        position: 'absolute',
        top: theme.space[3],
        right: theme.space[4],
        zIndex: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        paddingHorizontal: theme.space[3],
        height: 30,
        borderWidth: theme.border.hairline,
        borderColor: theme.colors.borderSubtle,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.colors.surface
      }}
    >
      <ActivityIndicator size="small" color={theme.colors.accent} />
      <Text style={{ ...typeStyle(theme, 'sectionMeta', 'medium'), color: theme.colors.textSecondary }}>
        Atualizando…
      </Text>
    </View>
  );
}

/** Navegação inferior de 84 px do frame mobile. */
function MobileNav({ active, onCompose }: { active: 'all' | 'email' | 'chat'; onCompose: () => void }): ReactElement {
  const theme = useTheme();
  const actions = useMailActions();

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
        onPress={onCompose}
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
