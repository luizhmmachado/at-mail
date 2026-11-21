import { createElement, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactElement } from 'react';
import { Image, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  formatRelativeTime,
  groupChatMessageThreads,
  isChatMessage,
  isEmailMessage,
  threadParticipantsLabel,
  type Attachment,
  type ChatMessage,
  type ChatMessageThread,
  type MailMessage,
  type UnifiedThread
} from '@mail/core';
import { useTheme } from '../theme/MailThemeProvider';
import {
  useAppStore,
  useFeed,
  useMailActions,
  useMailSnapshot,
  useSelectedThreadMessages
} from '../store/MailStoreProvider';
import { currentPlatform } from '../platform';
import { typeStyle } from '../theme/typography';
import { Glyph, type GlyphName } from './LucideGlyph';
import { selectMessageAttachments, useImagePaste, type NewMessageAttachment } from './NewMessageComposer';
import { isTextFormatted, toggleTextFormat } from './text-format';
import { NativeEmailHtml } from './NativeEmailHtml';
import { emailContentSecurityPolicy, emailImagePreferenceKey, EMAIL_LINK_BRIDGE_SCRIPT, prepareEmailHtml, safeMessageLink } from './email-html-policy';

export interface ReaderPaneProps {
  thread: UnifiedThread | undefined;
  onBack?: () => void;
  onSend?: (thread: UnifiedThread, body: string, chatThreadName?: string, attachments?: NewMessageAttachment[], formatted?: boolean) => Promise<void>;
  onReactChat?: (message: ChatMessage, emoji: string) => Promise<void>;
}

/**
 * Coluna de leitura de 1016 px do frame `@mail · Desktop`.
 * Barra de ações de 72 px, título de 28/45 com 38 px de respiro depois da barra,
 * etiqueta de 26 px, mensagens anteriores em cartão de 74 px e a última mensagem
 * aberta, com o compositor de 132 px ao pé da coluna.
 */

export function ReaderPane({ thread, onBack, onSend, onReactChat }: ReaderPaneProps): ReactElement {
  const theme = useTheme();
  const store = useAppStore();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();
  const messages = useSelectedThreadMessages();
  const { feed } = useFeed();
  const readerScrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const replyScrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const replyInput = useRef<ComponentRef<typeof TextInput> | null>(null);
  const [selectedChatThread, setSelectedChatThread] = useState<{ conversationId: string; id: string }>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [formattedDrafts, setFormattedDrafts] = useState<Record<string, boolean>>({});
  const [attachmentsByDraft, setAttachmentsByDraft] = useState<Record<string, NewMessageAttachment[]>>({});
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [formattingOpen, setFormattingOpen] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const mobile = onBack !== undefined;
  const gutter = mobile ? theme.layout.mobilePaddingX : theme.layout.readerGutter;
  const chatThreads = useMemo(() => groupChatMessageThreads(messages), [messages]);
  const activeChatThread = selectedChatThread?.conversationId === thread?.id
    ? chatThreads.find((item) => item.id === selectedChatThread?.id)
    : undefined;
  const draftKey = JSON.stringify([thread?.id, activeChatThread?.id ?? 'main']);
  const draft = drafts[draftKey] ?? '';
  const attachments = attachmentsByDraft[draftKey] ?? [];
  useImagePaste(replyInput, attachments, thread !== undefined && !sending, (next) => setAttachmentsByDraft((current) => ({ ...current, [draftKey]: next })), setNotice);
  const setDraft = (value: string): void => {
    setDrafts((current) => ({ ...current, [draftKey]: value }));
  };
  const selectChatThread = (item: ChatMessageThread | undefined): void => {
    if (sending) return;
    setSelectedChatThread(item && thread ? { conversationId: thread.id, id: item.id } : undefined);
    setNotice(undefined);
  };

  const contextLabels = useMemo(
    () =>
      thread?.contextIds
        .map((contextId) => snapshot.contexts.find((context) => context.id === contextId))
        .filter((context): context is NonNullable<typeof context> => context !== undefined) ?? [],
    [snapshot.contexts, thread]
  );

  if (thread === undefined) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surface,
          gap: theme.space[2],
          padding: theme.space[6]
        }}
      >
        <Text style={{ ...typeStyle(theme, 'railBrand'), color: theme.colors.textPrimary }}>@</Text>
        <Text style={{ ...typeStyle(theme, 'readerName'), color: theme.colors.textPrimary }}>
          Nenhuma conversa aberta
        </Text>
        <Text
          style={{
            ...typeStyle(theme, 'body'),
            color: theme.colors.textSecondary,
            textAlign: 'center',
            maxWidth: 320
          }}
        >
          Use J e K para navegar entre as conversas. Enter abre a selecionada.
        </Text>
      </View>
    );
  }

  const isArchived = thread.emailFolder === 'archived';
  const position = feed.threads.findIndex((item) => item.id === thread.id);
  const accountEmails = Array.from(
    new Set(messages.map((message) => store.accountFor(message.accountId)?.email ?? ''))
  ).filter((email) => email.length > 0);
  const replyTarget = messages.length > 0 ? senderName(messages[messages.length - 1]!) : threadParticipantsLabel(thread, 1);
  const platform = currentPlatform();
  const canModifyEmail = thread.channel !== 'chat';
  const isChatThread = thread.channel === 'chat';
  const applyFormatting = (marker: string): void => {
    const result = toggleTextFormat(draft, selection, marker, !isChatThread && marker === '_' ? '*' : undefined);
    setDraft(result.text);
    setFormattedDrafts((current) => ({ ...current, [draftKey]: true }));
    setSelection(result.selection);
    replyInput.current?.focus();
  };
  const send = async (): Promise<void> => {
    if (!onSend || (draft.trim().length === 0 && attachments.length === 0) || sending) return;
    setSending(true);
    setNotice(undefined);
    try {
      await onSend(thread, draft.trim(), activeChatThread?.threadName, attachments, formattedDrafts[draftKey] === true);
      setDraft('');
      setFormattedDrafts((current) => ({ ...current, [draftKey]: false }));
      setAttachmentsByDraft((current) => ({ ...current, [draftKey]: [] }));
      actions.toggleCompose(false);
      setNotice('Mensagem enviada.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <View
        style={{
          height: theme.layout.headerHeight,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 22,
          paddingHorizontal: mobile ? theme.layout.mobilePaddingX : theme.space[8],
          borderBottomWidth: theme.border.hairline,
          borderBottomColor: theme.colors.borderSubtle,
          backgroundColor: theme.colors.surface
        }}
      >
        {onBack !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar para a lista"
            onPress={onBack}
            style={{ marginRight: theme.space[3], padding: theme.space[1] }}
          >
            <View style={{ transform: [{ rotate: '90deg' }] }}>
              <Glyph name="chevron-down" size={18} color={theme.colors.textSecondary} />
            </View>
          </Pressable>
        )}

        {canModifyEmail && (
          <>
            <IconButton
              name="archive"
              label={isArchived ? 'Arquivada' : 'Arquivar'}
              onPress={() => actions.archiveThread(thread.id)}
            />
            <IconButton name="trash" label="Excluir" onPress={() => actions.trashThread(thread.id)} />
            <View
              style={{
                width: theme.border.hairline,
                height: 18,
                backgroundColor: theme.colors.borderSubtle
              }}
            />
          </>
        )}

        <IconButton name="clock" label="Adiar e marcar como não lida" onPress={() => actions.markThreadRead(thread.id, false)} />

        <View style={{ flex: 1 }} />

        {position >= 0 && (
          <Text style={{ ...typeStyle(theme, 'readerMeta'), color: theme.colors.textSecondary }}>
            {position + 1} de {feed.threads.length}
          </Text>
        )}
        <IconButton name="chevron-up" label="Conversa anterior" onPress={() => actions.moveSelection(-1)} />
        <IconButton name="chevron-down" label="Próxima conversa" onPress={() => actions.moveSelection(1)} />
      </View>

      {isChatThread && (
        <View
          style={{
            paddingHorizontal: gutter,
            paddingTop: theme.layout.readerTitleGap,
            paddingBottom: theme.space[3]
          }}
        >
          <ConversationHeading
            thread={thread}
            contextLabels={contextLabels}
            messageCount={messages.length}
            mobile={mobile}
          />
        </View>
      )}

      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
      {(!mobile || activeChatThread === undefined) && <ScrollView
        style={{ flex: 1, minWidth: 0 }}
        ref={readerScrollRef}
        onContentSizeChange={() => {
          if (isChatThread) readerScrollRef.current?.scrollToEnd({ animated: false });
        }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: isChatThread ? 0 : theme.layout.readerTitleGap,
          paddingBottom: theme.space[8],
          ...(isChatThread ? { flexGrow: 1 } : {})
        }}
      >
        {!isChatThread && (
          <ConversationHeading
            thread={thread}
            contextLabels={contextLabels}
            messageCount={messages.length}
            mobile={mobile}
          />
        )}

        <View style={{ marginTop: isChatThread ? 0 : mobile ? theme.space[5] : theme.space[8], gap: theme.space[6] }}>
          {isChatThread ? (
            <ChatTimeline
              messages={chatThreads.flatMap((item) => item.root ? [item.root] : [])}
              onReactChat={onReactChat}
              renderThreadAction={(message) => {
                const item = chatThreads.find((group) => group.root?.id === message.id);
                return item?.threadName ? (
                  <ChatThreadButton item={item} disabled={sending} onPress={() => selectChatThread(item)} />
                ) : null;
              }}
            />
          ) : (
            messages.map((message, index) =>
              index === messages.length - 1 ? (
                <CurrentMessage key={message.id} message={message} />
              ) : (
                <EarlierMessage key={message.id} message={message} />
              )
            )
          )}
        </View>
        {isChatThread && chatThreads.filter((item) => item.root === undefined).map((item) => (
          <View key={item.id} style={{ marginTop: theme.space[3], padding: theme.space[3], borderWidth: theme.border.hairline, borderColor: theme.colors.borderSubtle, borderRadius: theme.radius.lg }}>
            <Text style={{ ...typeStyle(theme, 'readerMeta'), color: theme.colors.textSecondary }}>
              Mensagem original fora do histórico carregado
            </Text>
            <ChatThreadButton item={item} disabled={sending} onPress={() => selectChatThread(item)} />
          </View>
        ))}
      </ScrollView>}
      {isChatThread && activeChatThread !== undefined && (
        <View style={{ flex: mobile ? 1 : undefined, width: mobile ? undefined : '45%', minWidth: 0, borderLeftWidth: mobile ? 0 : theme.border.hairline, borderLeftColor: theme.colors.borderSubtle, backgroundColor: theme.colors.surfaceSunken }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: theme.space[3], gap: theme.space[2] }}>
            <Text style={{ ...typeStyle(theme, 'readerName'), flex: 1, color: theme.colors.textPrimary }}>Conversa na thread</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Fechar thread" disabled={sending} onPress={() => selectChatThread(undefined)} style={{ padding: theme.space[2] }}>
              <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.accent }}>Voltar ao chat</Text>
            </Pressable>
          </View>
          <ScrollView
            key={activeChatThread.id}
            ref={replyScrollRef}
            onContentSizeChange={() => replyScrollRef.current?.scrollToEnd({ animated: false })}
            contentContainerStyle={{ padding: theme.space[3] }}
          >
            {activeChatThread.root === undefined && (
              <Text style={{ ...typeStyle(theme, 'readerMeta'), color: theme.colors.textSecondary }}>Mensagem original fora do histórico carregado</Text>
            )}
            <ChatTimeline messages={[...(activeChatThread.root ? [activeChatThread.root] : []), ...activeChatThread.replies]} onReactChat={onReactChat} />
          </ScrollView>
        </View>
      )}
      </View>

      <View
        style={{
          paddingHorizontal: gutter,
          paddingBottom: theme.space[4],
          backgroundColor: theme.colors.surface
        }}
      >
        <View
          style={{
            minHeight: theme.layout.composerMinHeight,
            padding: 18,
            borderRadius: theme.radius.xxl,
            borderWidth: theme.border.hairline,
            borderColor: theme.colors.borderSubtle,
            backgroundColor: theme.colors.surface
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Glyph name="reply" size={16} color={theme.colors.textSecondary} />
            <Text style={{ ...typeStyle(theme, 'composeLabel'), color: theme.colors.textSecondary }}>
              {isChatThread ? activeChatThread ? 'Responder na thread' : 'Nova mensagem na conversa' : `Responder a ${replyTarget}`}
            </Text>
          </View>

          <TextInput
            ref={replyInput}
            accessibilityLabel={isChatThread ? activeChatThread ? 'Escrever resposta na thread' : 'Escrever mensagem' : 'Escrever resposta'}
            multiline
            autoFocus={snapshot.ui.composeOpen}
            value={draft}
            selection={selection}
            onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
            onChangeText={(value) => {
              setDraft(value);
              if (notice !== undefined) setNotice(undefined);
            }}
            placeholder={isChatThread && !activeChatThread ? 'Escreva uma mensagem…' : 'Escreva uma resposta…'}
            placeholderTextColor={theme.colors.textSecondary}
            style={{
              ...typeStyle(theme, 'composeBody'),
              minHeight: 44,
              marginTop: theme.space[2],
              paddingVertical: 0,
              color: theme.colors.textPrimary
            }}
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: theme.space[2] }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Anexar arquivos" disabled={sending} onPress={() => {
              void selectMessageAttachments(attachments).then((next) => setAttachmentsByDraft((current) => ({ ...current, [draftKey]: next }))).catch((error) => setNotice(error instanceof Error ? error.message : 'Não foi possível anexar o arquivo.'));
            }}><Glyph name="attach" size={17} color={theme.colors.textSecondary} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Formatar texto" accessibilityState={{ expanded: formattingOpen }} onPress={() => setFormattingOpen((open) => !open)} style={{ marginLeft: theme.space[3], padding: 4 }}>
              <Glyph name="format" size={17} color={theme.colors.textSecondary} />
            </Pressable>
            <View style={{ flex: 1 }} />
            {!mobile && <Text style={{ ...typeStyle(theme, 'composeHint'), color: theme.colors.textSecondary }}>
              {platform === 'macos' || platform === 'ios' ? '⌘' : 'Ctrl'} Enter para enviar
            </Text>}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isChatThread ? 'Enviar mensagem' : 'Enviar resposta'}
              accessibilityState={{ disabled: draft.trim().length === 0 && attachments.length === 0 }}
              onPress={() => void send()}
              style={{
                width: theme.layout.sendButtonWidth,
                height: theme.layout.sendButtonHeight,
                marginLeft: theme.space[3],
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                borderRadius: theme.radius.md,
                backgroundColor: draft.trim().length === 0 && attachments.length === 0 ? theme.colors.borderStrong : theme.colors.textPrimary,
                opacity: (draft.trim().length === 0 && attachments.length === 0) || sending ? 0.6 : 1
              }}
            >
              <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.surface }}>{sending ? 'Enviando…' : 'Enviar'}</Text>
              <Glyph name="arrow" size={14} color={theme.colors.surface} />
            </Pressable>
          </View>
          {formattingOpen && <View style={{ flexDirection: 'row', gap: theme.space[2], marginTop: theme.space[2] }}>
            {([
              ['bold', 'Negrito', isChatThread ? '*' : '**'],
              ['italic', 'Itálico', '_'],
              ['strikethrough', 'Tachado', isChatThread ? '~' : '~~']
            ] as const).map(([name, label, marker]) => {
              const active = isTextFormatted(draft, selection, marker, !isChatThread && marker === '_' ? '*' : undefined);
              return <Pressable key={name} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} {...(Platform.OS === 'web' ? { 'aria-pressed': active } : {})} disabled={sending} onPress={() => applyFormatting(marker)} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? theme.colors.accentMuted : 'transparent', borderRadius: theme.radius.sm }}><Glyph name={name} size={16} color={active ? theme.colors.accent : theme.colors.textPrimary} /></Pressable>;
            })}
          </View>}
          {attachments.map((attachment, index) => <Pressable key={`${attachment.fileName}-${index}`} accessibilityRole="button" accessibilityLabel={`Remover ${attachment.fileName}`} onPress={() => setAttachmentsByDraft((current) => ({ ...current, [draftKey]: attachments.filter((_, itemIndex) => itemIndex !== index) }))}><Text numberOfLines={1} style={{ ...typeStyle(theme, 'composeHint'), color: theme.colors.textSecondary }}>{attachment.fileName} · Remover</Text></Pressable>)}
        </View>

        <Text
          style={{
            ...typeStyle(theme, 'composeHint'),
            color: theme.colors.textSecondary,
            marginTop: 10
          }}
        >
          Respondendo de {accountEmails[0] ?? 'conta principal'}
        </Text>
        {notice !== undefined && (
          <Text
            style={{
              ...typeStyle(theme, 'composeHint'),
              color: theme.colors.textSecondary,
              marginTop: 4
            }}
          >
            {notice}
          </Text>
        )}
      </View>
    </View>
  );
}

function IconButton({
  name,
  label,
  onPress
}: {
  name: GlyphName;
  label: string;
  onPress: () => void;
}): ReactElement {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      hitSlop={8}
      style={{
        width: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.sm,
        backgroundColor: hovered ? theme.colors.surfaceHover : 'transparent'
      }}
    >
      <Glyph name={name} size={18} color={theme.colors.textSecondary} />
    </Pressable>
  );
}

function ConversationHeading({
  thread,
  contextLabels,
  messageCount,
  mobile
}: {
  thread: UnifiedThread;
  contextLabels: readonly { id: string; name: string }[];
  messageCount: number;
  mobile: boolean;
}): ReactElement {
  const theme = useTheme();
  return (
    <>
      <Text
        style={{
          ...typeStyle(theme, mobile ? 'mobileTitle' : 'readerTitle'),
          color: theme.colors.textPrimary
        }}
      >
        {thread.subject}
      </Text>

      {thread.channel === 'chat' && (
        <Text style={{ ...typeStyle(theme, 'body'), color: theme.colors.textSecondary, marginTop: theme.space[2] }}>
          {threadParticipantsLabel(thread, 3)}
        </Text>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: theme.space[3] }}>
        <View
          style={{
            height: theme.layout.tagHeight,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 10,
            borderRadius: theme.radius.sm,
            borderWidth: theme.border.hairline,
            borderColor: theme.colors.borderSubtle,
            backgroundColor: theme.colors.surfaceSunken
          }}
        >
          <Glyph
            name={thread.channel === 'chat' ? 'chat' : 'mail'}
            size={14}
            color={theme.colors.textSecondary}
          />
          <Text style={{ ...typeStyle(theme, 'readerTag'), color: theme.colors.textSecondary }}>
            {thread.channel === 'chat' ? 'Chat' : 'E-mail'}
          </Text>
          {contextLabels.length > 0 && (
            <>
              <View style={{ width: theme.border.hairline, height: 12, backgroundColor: theme.colors.borderSubtle }} />
              {contextLabels.map((context) => (
                <Text
                  key={context.id}
                  style={{ ...typeStyle(theme, 'readerTag'), color: theme.colors.textSecondary }}
                >
                  {context.name}
                </Text>
              ))}
            </>
          )}
        </View>
        {thread.channel !== 'chat' && (
          <Text
            style={{
              ...typeStyle(theme, 'readerTag'),
              color: theme.colors.textSecondary,
              marginLeft: theme.space[4]
            }}
          >
            {messageCount} {messageCount === 1 ? 'mensagem' : 'mensagens'}
          </Text>
        )}
      </View>
    </>
  );
}

function EarlierMessage({ message }: { message: MailMessage }): ReactElement {
  const theme = useTheme();
  const sender = message.participants[0];
  return (
    <View
      style={{
        paddingHorizontal: theme.space[5],
        paddingVertical: 13,
        borderRadius: theme.radius.lg,
        borderWidth: theme.border.hairline,
        borderColor: theme.colors.borderSubtle,
        backgroundColor: theme.colors.surfaceSunken,
        gap: 6
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        {message.channel === 'chat' && sender?.avatarUrl && (
          <Image
            accessibilityLabel={`Foto de ${senderName(message)}`}
            source={{ uri: sender.avatarUrl }}
            resizeMode="cover"
            style={{ width: 26, height: 26, borderRadius: theme.radius.pill }}
          />
        )}
        <Text style={{ ...typeStyle(theme, 'earlierName'), color: theme.colors.textPrimary }}>
          {senderName(message)}
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={{ ...typeStyle(theme, 'readerMeta'), color: theme.colors.textSecondary }}>
          {formatRelativeTime(message.receivedAt)}
        </Text>
      </View>
      <MessageBody message={message} role="earlierBody" color={theme.colors.textSecondary} />
    </View>
  );
}

function CurrentMessage({ message }: { message: MailMessage }): ReactElement {
  const theme = useTheme();
  const sender = message.participants[0];
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
        {message.channel === 'chat' && sender?.avatarUrl && (
          <Image
            accessibilityLabel={`Foto de ${senderName(message)}`}
            source={{ uri: sender.avatarUrl }}
            resizeMode="cover"
            style={{ width: 30, height: 30, borderRadius: theme.radius.pill }}
          />
        )}
        <Text style={{ ...typeStyle(theme, 'readerName'), color: theme.colors.textPrimary }}>
          {senderName(message)}
        </Text>
        {sender !== undefined && (
          <Text numberOfLines={1} style={{ ...typeStyle(theme, 'readerEmail'), flexShrink: 1, color: theme.colors.textSecondary }}>
            &lt;{sender.email}&gt;
          </Text>
        )}
        <View style={{ flex: 1 }} />
        <Text style={{ ...typeStyle(theme, 'readerMeta'), color: theme.colors.textSecondary }}>
          {formatRelativeTime(message.receivedAt)}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
        <Text style={{ ...typeStyle(theme, 'readerMeta'), color: theme.colors.textSecondary }}>
          {isEmailMessage(message) ? 'para mim' : message.spaceName ?? 'chat'}
        </Text>
        <Glyph name="chevron-down" size={12} color={theme.colors.textSecondary} />
      </View>

      <MessageBody message={message} role="readerBody" color={theme.colors.textPrimary} />

      {isEmailMessage(message) && message.attachments.length > 0 && (
        <View style={{ gap: theme.space[2], marginTop: theme.space[4] }}>
          {message.attachments.map((attachment) => (
            <AttachmentCard key={attachment.id} attachment={attachment} />
          ))}
        </View>
      )}
    </View>
  );
}

function ChatThreadButton({ item, disabled, onPress }: { item: ChatMessageThread; disabled: boolean; onPress: () => void }): ReactElement {
  const theme = useTheme();
  const count = item.replies.length;
  return (
    <Pressable accessibilityRole="button" disabled={disabled} accessibilityLabel={count > 0 ? `Abrir thread com ${count} ${count === 1 ? 'resposta' : 'respostas'}` : 'Responder na thread'} onPress={onPress} style={{ paddingVertical: theme.space[2] }}>
      <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.accent }}>
        {count > 0 ? `${count} ${count === 1 ? 'resposta' : 'respostas'}` : 'Responder na thread'}
      </Text>
    </Pressable>
  );
}

function ChatTimeline({ messages, onReactChat, renderThreadAction }: { messages: readonly MailMessage[]; onReactChat?: ReaderPaneProps['onReactChat']; renderThreadAction?: (message: ChatMessage) => ReactElement | null }): ReactElement {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[1] }}>
      {messages.map((message, index) => {
        if (!isChatMessage(message)) return null;
        const previous = messages[index - 1];
        const previousChat = previous !== undefined && isChatMessage(previous) ? previous : undefined;
        const startsNewDay = previous === undefined || !sameLocalDay(previous.receivedAt, message.receivedAt);
        const startsNewGroup =
          previousChat === undefined ||
          startsNewDay ||
          senderName(previousChat) !== senderName(message) ||
          message.receivedAt - previousChat.receivedAt >= 5 * 60_000;
        const name = senderName(message);
        const avatarUrl = message.participants[0]?.avatarUrl;

        return (
          <View key={message.id}>
            {startsNewDay && <ChatDateSeparator timestamp={message.receivedAt} isFirst={index === 0} />}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                gap: theme.space[3],
                marginTop: startsNewGroup ? theme.space[2] : theme.space[1]
              }}
            >
              <View
                style={{
                  width: 30,
                  height: startsNewGroup ? 30 : 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: theme.radius.pill,
                  backgroundColor: startsNewGroup ? theme.colors.accentMuted : 'transparent'
                }}
              >
                {startsNewGroup && avatarUrl ? (
                  <Image
                    accessibilityLabel={`Foto de ${name}`}
                    source={{ uri: avatarUrl }}
                    resizeMode="cover"
                    style={{ width: 30, height: 30, borderRadius: theme.radius.pill }}
                  />
                ) : startsNewGroup ? (
                  <Text style={{ ...typeStyle(theme, 'rowName'), color: theme.colors.accent }}>
                    {senderInitials(name)}
                  </Text>
                ) : null}
              </View>

              <View style={{ flexShrink: 1, maxWidth: '90%' }}>
                {startsNewGroup && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'baseline',
                      gap: theme.space[2],
                      marginBottom: theme.space[1]
                    }}
                  >
                    <Text numberOfLines={1} style={{ ...typeStyle(theme, 'rowName'), color: theme.colors.textPrimary }}>
                      {name}
                    </Text>
                    <Text style={{ ...typeStyle(theme, 'readerMeta'), color: theme.colors.textSecondary }}>
                      {formatChatTime(message.receivedAt)}
                    </Text>
                  </View>
                )}
                <View
                  style={{
                    paddingHorizontal: theme.space[3],
                    paddingVertical: theme.space[2],
                    borderRadius: theme.radius.lg,
                    borderWidth: theme.border.hairline,
                    borderColor: theme.colors.borderSubtle,
                    backgroundColor: theme.colors.surfaceSunken
                  }}
                >
                  <MessageBody
                    message={message}
                    role="readerBody"
                    color={theme.colors.textPrimary}
                    flush
                  />
                  {message.attachments?.map((attachment) => (
                    <Pressable key={attachment.id} accessibilityRole="link" accessibilityLabel={`Abrir anexo ${attachment.fileName}`} disabled={!attachment.downloadUrl} onPress={() => attachment.downloadUrl && void openMessageLink(attachment.downloadUrl).catch((error) => console.error('Não foi possível abrir o anexo.', error))} style={{ marginTop: theme.space[2], gap: theme.space[1] }}>
                      {attachment.mimeType.startsWith('image/') && attachment.thumbnailUrl && <Image source={{ uri: attachment.thumbnailUrl }} resizeMode="contain" style={{ width: 200, maxWidth: '100%', height: 150 }} />}
                      <Text selectable style={{ ...typeStyle(theme, 'rowMeta'), color: theme.colors.accent }}>{attachment.fileName}</Text>
                    </Pressable>
                  ))}
                  {!message.id.includes(':optimistic:') && <ChatReactionControls message={message} onReactChat={onReactChat} />}
                </View>
                {renderThreadAction?.(message)}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ChatReactionControls({ message, onReactChat }: { message: ChatMessage; onReactChat?: ReaderPaneProps['onReactChat'] }): ReactElement | null {
  const theme = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sendingEmoji, setSendingEmoji] = useState<string>();
  const [error, setError] = useState<string>();
  if (onReactChat === undefined) return null;
  const reactMessage: NonNullable<ReaderPaneProps['onReactChat']> = onReactChat;

  async function addReaction(emoji: string): Promise<void> {
    if (sendingEmoji !== undefined) return;
    setSendingEmoji(emoji);
    setError(undefined);
    try {
      await reactMessage(message, emoji);
      setPickerOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível reagir à mensagem.');
    } finally {
      setSendingEmoji(undefined);
    }
  }

  return (
    <View style={{ marginTop: theme.space[2] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space[1] }}>
        {message.reactions?.map((reaction) => (
          <Pressable
            key={reaction.emoji}
            accessibilityRole="button"
            accessibilityLabel={`Reagir com ${reaction.emoji}, ${reaction.count} reações`}
            accessibilityState={{ selected: reaction.own === true }}
            disabled={sendingEmoji !== undefined}
            onPress={() => void addReaction(reaction.emoji)}
            style={{ minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, borderRadius: theme.radius.pill, backgroundColor: reaction.own ? theme.colors.accentMuted : theme.colors.surface, borderWidth: theme.border.hairline, borderColor: reaction.own ? theme.colors.accent : theme.colors.borderSubtle }}
          >
            <Text>{reaction.emoji}</Text>
            <Text style={{ ...typeStyle(theme, 'rowMeta'), color: theme.colors.textSecondary }}>{reaction.count}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Adicionar reação"
          accessibilityState={{ expanded: pickerOpen }}
          onPress={() => setPickerOpen((open) => !open)}
          style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.pill, borderWidth: theme.border.hairline, borderColor: theme.colors.borderSubtle }}
        >
          <Glyph name="plus" size={14} color={theme.colors.textSecondary} />
        </Pressable>
        {pickerOpen && ['👍', '❤️', '😂', '🎉', '🙏'].map((emoji) => (
          <Pressable
            key={emoji}
            accessibilityRole="button"
            accessibilityLabel={`Reagir com ${emoji}`}
            disabled={sendingEmoji !== undefined}
            onPress={() => void addReaction(emoji)}
            style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface }}
          >
            <Text>{emoji}</Text>
          </Pressable>
        ))}
      </View>
      {error !== undefined && <Text accessibilityRole="alert" style={{ ...typeStyle(theme, 'composeHint'), color: theme.colors.danger, marginTop: 4 }}>{error}</Text>}
    </View>
  );
}

function ChatDateSeparator({ timestamp, isFirst }: { timestamp: number; isFirst: boolean }): ReactElement {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        marginTop: isFirst ? 0 : theme.space[5],
        marginBottom: theme.space[2]
      }}
    >
      <View style={{ flex: 1, height: theme.border.hairline, backgroundColor: theme.colors.divider }} />
      <Text style={{ ...typeStyle(theme, 'readerMeta'), color: theme.colors.textSecondary }}>
        {formatChatDay(timestamp)}
      </Text>
      <View style={{ flex: 1, height: theme.border.hairline, backgroundColor: theme.colors.divider }} />
    </View>
  );
}

const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<]+)/gi;

async function openMessageLink(value: string): Promise<void> {
  const url = safeMessageLink(value);
  if (!url) return;
  if (Platform.OS === 'web' && '__TAURI_INTERNALS__' in globalThis) {
    const opener = await import('@tauri-apps/plugin-opener');
    await opener.openUrl(url);
  } else if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    await Linking.openURL(url);
  }
}

function MessageBody({
  message,
  role,
  color,
  flush = false
}: {
  message: MailMessage;
  role: 'earlierBody' | 'readerBody';
  color: string;
  flush?: boolean;
}): ReactElement {
  const theme = useTheme();
  const [imagePreferences, setImagePreferences] = useState<Record<string, boolean>>({});
  const [nativePreference, setNativePreference] = useState<{ sender: string; blocked: boolean }>();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const sender = message.participants[0]?.email.trim().toLowerCase() ?? '';
  const preferenceKey = `atmail.images.blocked:${sender}`;
  const nativePreferenceKey = emailImagePreferenceKey(sender);
  const hasEmailHtml = message.channel === 'email' && Boolean(message.bodyHtml);
  const preparedHtml = useMemo(() => message.channel === 'email' && message.bodyHtml ? prepareEmailHtml(message.bodyHtml, Platform.OS === 'web') : undefined, [message.channel, message.bodyHtml]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !hasEmailHtml) return;
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframeRef.current?.contentWindow || event.data?.type !== 'atmail:email-link' || typeof event.data?.url !== 'string') return;
      void openMessageLink(event.data.url).catch((error) => console.error('Não foi possível abrir o link.', error));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [hasEmailHtml]);
  useEffect(() => {
    if (Platform.OS === 'web' || !hasEmailHtml) return;
    let active = true;
    if (!sender) {
      setNativePreference({ sender, blocked: false });
      return;
    }
    void SecureStore.getItemAsync(nativePreferenceKey).then((value) => {
      if (active) setNativePreference({ sender, blocked: value === 'true' });
    }).catch(() => {
      if (active) setNativePreference({ sender, blocked: false });
    });
    return () => { active = false; };
  }, [sender, nativePreferenceKey, hasEmailHtml]);
  let blockedByDefault = false;
  try {
    blockedByDefault = Platform.OS === 'web' && sender.length > 0 && globalThis.localStorage?.getItem(preferenceKey) === 'true';
  } catch {}
  const nativePreferenceReady = Platform.OS === 'web' || nativePreference?.sender === sender;
  const imagesAllowed = Platform.OS === 'web' ? imagePreferences[sender] ?? !blockedByDefault : nativePreferenceReady && !nativePreference?.blocked;
  if (message.channel === 'email' && preparedHtml !== undefined) {
    const html = emailDocument(preparedHtml, theme.mode, theme.colors.surface, theme.colors.textPrimary, imagesAllowed, Platform.OS === 'web');
    const content = Platform.OS === 'web' ? createElement('iframe', {
      ref: iframeRef,
      title: `Corpo do e-mail: ${message.subject}`,
      sandbox: 'allow-scripts',
      referrerPolicy: 'no-referrer',
      srcDoc: html,
      style: {
        display: 'block',
        width: '100%',
        height: role === 'readerBody' ? 560 : 260,
        border: 0,
        backgroundColor: theme.colors.surface
      }
    }) : nativePreferenceReady ? <NativeEmailHtml html={html} height={role === 'readerBody' ? 560 : 260} backgroundColor={theme.colors.surface} /> : null;
    return (
      <View style={{ width: '100%', marginTop: role === 'readerBody' ? theme.space[2] + 2 : 0 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={imagesAllowed ? 'Não carregar imagens deste remetente' : 'Carregar imagens deste remetente'}
          disabled={!nativePreferenceReady}
          onPress={() => {
            if (Platform.OS === 'web') {
              setImagePreferences((current) => ({ ...current, [sender]: !imagesAllowed }));
              try {
                if (sender.length > 0) globalThis.localStorage?.setItem(preferenceKey, String(imagesAllowed));
              } catch {}
            } else {
              setNativePreference({ sender, blocked: imagesAllowed });
              if (sender) void SecureStore.setItemAsync(nativePreferenceKey, String(imagesAllowed)).catch(() => {});
            }
          }}
          style={{
            alignSelf: 'flex-start',
            marginBottom: theme.space[2],
            paddingHorizontal: theme.space[3],
            paddingVertical: 6,
            borderRadius: theme.radius.pill,
            borderWidth: theme.border.hairline,
            borderColor: theme.colors.borderSubtle,
            backgroundColor: theme.colors.surface
          }}
        >
          <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.textSecondary }}>{imagesAllowed ? 'Não carregar imagens deste remetente' : 'Carregar imagens deste remetente'}</Text>
        </Pressable>
        {content}
      </View>
    );
  }
  const parts = message.bodyText.split(URL_PATTERN);
  return (
    <Text
      selectable
      style={{
        ...typeStyle(theme, role),
        color,
        ...(flush ? { lineHeight: 20 } : {}),
        ...(!flush && role === 'readerBody' ? { marginTop: theme.space[2] + 2 } : {})
      }}
    >
      {parts.map((part, index) => {
        const isUrl = /^(?:https?:\/\/|www\.)/i.test(part);
        if (!isUrl) return part;
        const cleanUrl = part.replace(/[),.;!?]+$/, '');
        return (
          <Text
            key={`${cleanUrl}-${index}`}
            accessibilityRole="link"
            accessibilityLabel={`Abrir ${cleanUrl}`}
            onPress={() => void openMessageLink(cleanUrl).catch((error) => console.error('Não foi possível abrir o link.', error))}
            style={{ color: theme.colors.accent, textDecorationLine: 'underline' }}
          >
            {part}
          </Text>
        );
      })}
    </Text>
  );
}

function emailDocument(bodyHtml: string, mode: 'light' | 'dark', surface: string, text: string, imagesAllowed = false, linkBridge = false): string {
  const themedBodyHtml = mode === 'dark' ? adaptEmailColors(bodyHtml, surface, text) : bodyHtml;
  const darkCanvas = mode === 'dark'
    ? `background-color:${surface}!important`
    : `background-color:${surface}`;
  const headContent = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="${mode}"><meta http-equiv="Content-Security-Policy" content="${emailContentSecurityPolicy(imagesAllowed, linkBridge)}"><style>:root{color-scheme:${mode}}html,body{margin:0;max-width:100%;min-height:100%;${darkCanvas};color:${text}}body{overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>${linkBridge ? `<script>${EMAIL_LINK_BRIDGE_SCRIPT}</script>` : ''}`;
  const headOpen = /<head\b[^>]*>/i;
  const headClose = /<\/head\s*>/i;
  if (headOpen.test(themedBodyHtml)) return themedBodyHtml.replace(headOpen, (head) => `${head}${headContent}`);
  if (headClose.test(themedBodyHtml)) return themedBodyHtml.replace(headClose, (head) => `${headContent}${head}`);
  const htmlOpen = /<html\b[^>]*>/i;
  if (htmlOpen.test(themedBodyHtml)) return themedBodyHtml.replace(htmlOpen, (html) => `${html}<head>${headContent}</head>`);
  return `<!doctype html><html><head>${headContent}</head><body>${themedBodyHtml}</body></html>`;
}

function adaptEmailColors(bodyHtml: string, surface: string, text: string): string {
  const mapColor = (property: string, value: string): string | undefined => {
    const color = parseEmailColor(value);
    if (color === undefined || Math.max(...color) - Math.min(...color) > 30) return undefined;
    const brightness = (color[0] + color[1] + color[2]) / 3;
    if ((property === 'background' || property === 'background-color') && brightness >= 190) return surface;
    if (property === 'color' && brightness <= 140) return text;
    return undefined;
  };
  const css = /(?<![-\w])(background(?:-color)?|color)\s*:\s*(#[\da-f]{3,8}\b|rgba?\([^)]*\)|[a-z]+)(\s*!important)?/gi;
  const attributes = /\b(bgcolor|color)\s*=\s*(["']?)(#[\da-f]{3,8}\b|rgba?\([^)]*\)|[a-z]+)\2/gi;

  return bodyHtml
    .replace(css, (declaration, property: string, value: string, important: string | undefined) => {
      const replacement = mapColor(property.toLowerCase(), value);
      return replacement === undefined ? declaration : `${property}:${replacement}${important ?? ''}`;
    })
    .replace(attributes, (attribute, name: string, quote: string, value: string) => {
      const property = name.toLowerCase() === 'bgcolor' ? 'background-color' : 'color';
      const replacement = mapColor(property, value);
      return replacement === undefined ? attribute : `${name}=${quote}${replacement}${quote}`;
    });
}

const EMAIL_NEUTRAL_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  gainsboro: [220, 220, 220],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  silver: [192, 192, 192],
  white: [255, 255, 255],
  whitesmoke: [245, 245, 245]
};

function parseEmailColor(value: string): [number, number, number] | undefined {
  const normalized = value.trim().toLowerCase();
  const named = EMAIL_NEUTRAL_COLORS[normalized];
  if (named !== undefined) return named;

  const hex = normalized.match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];
  if (hex !== undefined) {
    if (hex.length === 4 && Number.parseInt(hex[3] ?? 'f', 16) < 8) return undefined;
    if (hex.length === 8 && Number.parseInt(hex.slice(6), 16) < 128) return undefined;
    if (hex.length <= 4) {
      return [
        Number.parseInt((hex[0] ?? '0').repeat(2), 16),
        Number.parseInt((hex[1] ?? '0').repeat(2), 16),
        Number.parseInt((hex[2] ?? '0').repeat(2), 16)
      ];
    }
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16)
    ];
  }

  const rgb = normalized.match(/^rgba?\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)(?:\s*,\s*([\d.]+%?))?\s*\)$/);
  if (rgb === null) return undefined;
  if (rgb[4] !== undefined && (rgb[4].endsWith('%') ? Number.parseFloat(rgb[4]) < 50 : Number.parseFloat(rgb[4]) < 0.5)) {
    return undefined;
  }
  const channelValue = (channel: string): number => {
    const amount = Number.parseFloat(channel);
    return Math.max(0, Math.min(255, Math.round(channel.endsWith('%') ? amount * 2.55 : amount)));
  };
  return [channelValue(rgb[1] ?? '0'), channelValue(rgb[2] ?? '0'), channelValue(rgb[3] ?? '0')];
}

function AttachmentCard({ attachment }: { attachment: Attachment }): ReactElement {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel={`Anexo ${attachment.fileName}`}
      style={{
        width: 292,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingHorizontal: 14,
        height: 52,
        borderRadius: theme.radius.lg,
        borderWidth: theme.border.hairline,
        borderColor: theme.colors.borderSubtle,
        backgroundColor: theme.colors.surfaceSunken
      }}
    >
      <Glyph name="file" size={21} color={theme.colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ ...typeStyle(theme, 'composeLabel'), color: theme.colors.textPrimary }}>
          {attachment.fileName}
        </Text>
        <Text style={{ ...typeStyle(theme, 'composeHint'), color: theme.colors.textSecondary }}>
          {extensionLabel(attachment)} · {formatBytes(attachment.sizeInBytes)}
        </Text>
      </View>
    </View>
  );
}

function senderName(message: MailMessage): string {
  const name = message.participants[0]?.name;
  if (name !== undefined && name.length > 0) return name;
  return isChatMessage(message) ? message.senderName : 'Alguém';
}

function sameLocalDay(firstTimestamp: number, secondTimestamp: number): boolean {
  const first = new Date(firstTimestamp);
  const second = new Date(secondTimestamp);
  return first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate();
}

function formatChatDay(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  if (sameLocalDay(timestamp, today.getTime())) return 'Hoje';

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameLocalDay(timestamp, yesterday.getTime())) return 'Ontem';

  const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
  if (date.getFullYear() !== today.getFullYear()) options.year = 'numeric';
  const label = date.toLocaleDateString('pt-BR', options);
  return `${label.charAt(0).toLocaleUpperCase('pt-BR')}${label.slice(1)}`;
}

function formatChatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function senderInitials(name: string): string {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('');
  return initials.toLocaleUpperCase('pt-BR') || '?';
}

function extensionLabel(attachment: Attachment): string {
  const extension = attachment.fileName.split('.').pop();
  return (extension ?? attachment.mimeType.split('/').pop() ?? 'arquivo').toUpperCase();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
