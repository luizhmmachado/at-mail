import { useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, useWindowDimensions, View, type ImageSourcePropType } from 'react-native';
import type { Account, AccountId, ChatMessage, ContextId, ThreadId, UnifiedThread } from '@mail/core';
import { MailThemeProvider, useTheme } from '../theme/MailThemeProvider';
import { useFeed, useMailActions, useMailSnapshot, useThreadSelectionHandler } from '../store/MailStoreProvider';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { CommandPalette } from './CommandPalette';
import { SettingsModal, WorkspaceRail } from './ContextSwitcher';
import { NewMessageComposer, type NewMessageAttachment, type NewMessageSubmission } from './NewMessageComposer';
import { Glyph, type GlyphName } from './LucideGlyph';
import { ReaderPane } from './ReaderPane';
import { UnifiedThreadList } from './UnifiedThreadList';
import { typeStyle } from '../theme/typography';

type MobilePane = 'list' | 'reader';

export interface AppShellProps {
  appIcon?: ImageSourcePropType;
  onSend?: (thread: UnifiedThread, body: string, chatThreadName?: string, attachments?: NewMessageAttachment[], formatted?: boolean) => Promise<void>;
  onReactChat?: (message: ChatMessage, emoji: string) => Promise<void>;
  onLoadChatImage?: (accountId: string, attachmentName: string) => Promise<string>;
  onReconnectAccount?: (account: Account) => Promise<void>;
  reconnectError?: string;
  onAddAccount?: () => void;
  onMoveAccounts?: (accountIds: AccountId[], contextId: ContextId) => Promise<void>;
  onRemoveAccount?: (accountId: AccountId) => Promise<void>;
  onSetAccountNotifications?: (accountId: AccountId, enabled: boolean) => Promise<void>;
  onSendNewMessage?: (message: NewMessageSubmission) => Promise<void>;
}

export function AppShell({ appIcon, onSend, onReactChat, onLoadChatImage, onReconnectAccount, reconnectError, onAddAccount, onMoveAccounts, onRemoveAccount, onSetAccountNotifications, onSendNewMessage }: AppShellProps = {}): ReactElement {
  const snapshot = useMailSnapshot();
  return (
    <MailThemeProvider mode={snapshot.ui.themeMode}>
      <ShellBody appIcon={appIcon} onSend={onSend} onReactChat={onReactChat} onLoadChatImage={onLoadChatImage} onReconnectAccount={onReconnectAccount} reconnectError={reconnectError} onAddAccount={onAddAccount} onMoveAccounts={onMoveAccounts} onRemoveAccount={onRemoveAccount} onSetAccountNotifications={onSetAccountNotifications} onSendNewMessage={onSendNewMessage} />
    </MailThemeProvider>
  );
}

function ShellBody({ appIcon, onSend, onReactChat, onLoadChatImage, onReconnectAccount, reconnectError, onAddAccount, onMoveAccounts, onRemoveAccount, onSetAccountNotifications, onSendNewMessage }: AppShellProps): ReactElement {
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

  const openNewMessage = (): void => setNewMessageOpen(true);
  const [newMessageOpen, setNewMessageOpen] = useState(false);

  if (isMobile) {
    const showReader = mobilePane === 'reader' && selectedThread !== undefined;
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
        <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
          {showReader ? (
              <ReaderPane thread={selectedThread} onBack={() => setMobilePane('list')} onSend={onSend} onReactChat={onReactChat} onLoadChatImage={onLoadChatImage} />
          ) : (
            <>
              <View style={{ flex: 1 }}>
                <UnifiedThreadList
                  feed={feed}
                  onSelectThread={handleSelect}
                  onCompose={openNewMessage}
                  onOpenSettings={() => setSettingsOpen(true)}
                  appIcon={appIcon}
                  fullScreen
                />
              </View>
              <MobileNav active={snapshot.view.channel} onCompose={openNewMessage} />
            </>
          )}
        </View>
        <SyncStatus mobile />
        <ReconnectAccount onReconnectAccount={onReconnectAccount} reconnectError={reconnectError} />
        <CommandPalette mobile />
        <SettingsModal
          visible={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onAddAccount={onAddAccount}
          onMoveAccounts={onMoveAccounts}
          onRemoveAccount={onRemoveAccount}
          onSetAccountNotifications={onSetAccountNotifications}
        />
        <NewMessageComposer
          visible={newMessageOpen}
          accounts={snapshot.accounts}
          onClose={() => setNewMessageOpen(false)}
          onAddAccount={onAddAccount}
          onSend={onSendNewMessage}
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
        <UnifiedThreadList feed={feed} onSelectThread={handleSelect} onCompose={openNewMessage} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <ReaderPane thread={selectedThread} onSend={onSend} onReactChat={onReactChat} onLoadChatImage={onLoadChatImage} />
      </View>

      <SyncStatus />
      <ReconnectAccount onReconnectAccount={onReconnectAccount} reconnectError={reconnectError} />
      <CommandPalette />
      <SettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onAddAccount={onAddAccount}
        onMoveAccounts={onMoveAccounts}
        onRemoveAccount={onRemoveAccount}
        onSetAccountNotifications={onSetAccountNotifications}
      />
      <NewMessageComposer
        visible={newMessageOpen}
        accounts={snapshot.accounts}
        onClose={() => setNewMessageOpen(false)}
        onAddAccount={onAddAccount}
        onSend={onSendNewMessage}
      />
    </View>
  );
}

/** Feedback persistente e discreto durante a primeira carga/sync incremental. */
function SyncStatus({ mobile = false }: { mobile?: boolean }): ReactElement | null {
  const theme = useTheme();
  const { sync, accounts } = useMailSnapshot();
  const error = accounts.find((account) => account.status !== 'reauth-required' && account.lastError)?.lastError
    ?? (sync.lastError === 'A autorização da conta Google expirou. Faça login novamente.' ? undefined : sync.lastError);
  if (sync.status !== 'syncing' && !error) return null;

  return (
    <View
      pointerEvents="none"
      role="status"
      accessibilityLiveRegion="polite"
      accessibilityLabel={error ? `Falha na sincronização: ${error}` : 'Atualizando mensagens'}
      style={{
        position: 'absolute',
        ...(mobile ? { bottom: theme.layout.mobileBottomNavHeight + theme.space[3] } : { top: theme.space[3] }),
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
      {!error && <ActivityIndicator size="small" color={theme.colors.accent} />}
      <Text numberOfLines={1} style={{ maxWidth: 280, ...typeStyle(theme, 'sectionMeta', 'medium'), color: theme.colors.textSecondary }}>
        {error ? `Falha na sincronização: ${error}` : 'Atualizando…'}
      </Text>
    </View>
  );
}

function ReconnectAccount({ onReconnectAccount, reconnectError }: Pick<AppShellProps, 'onReconnectAccount' | 'reconnectError'>): ReactElement {
  const theme = useTheme();
  const { accounts } = useMailSnapshot();
  const account = accounts.find((item) => item.status === 'reauth-required' && (item.provider === 'gmail' || item.provider === 'google-chat'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const reconnect = async (): Promise<void> => {
    if (!account || !onReconnectAccount || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onReconnectAccount(account);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível reconectar a conta.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal visible={account !== undefined && onReconnectAccount !== undefined} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: theme.space[4] }}>
        <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 420, backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.space[6], gap: theme.space[3] }}>
          <Text style={{ ...typeStyle(theme, 'readerName'), color: theme.colors.textPrimary }}>Reconecte sua conta Google</Text>
          <Text style={{ ...typeStyle(theme, 'body'), color: theme.colors.textSecondary }}>
            A sessão de {account?.email} expirou ou a senha pode ter sido alterada. Faça login novamente para continuar sincronizando.
          </Text>
          {(error || reconnectError) && <Text accessibilityRole="alert" style={{ ...typeStyle(theme, 'body'), color: theme.colors.danger }}>{error ?? reconnectError}</Text>}
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void reconnect()} style={{ backgroundColor: theme.colors.accent, borderRadius: theme.radius.lg, padding: theme.space[3], alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ ...typeStyle(theme, 'button'), color: '#ffffff' }}>{busy ? 'Aguardando login…' : 'Fazer login novamente com o Google'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
        onPress={() => actions.setChannel('email')}
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
