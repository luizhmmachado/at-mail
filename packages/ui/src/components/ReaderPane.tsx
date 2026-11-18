import { createElement, useMemo, useState, type ReactElement } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  formatRelativeTime,
  isChatMessage,
  isEmailMessage,
  threadParticipantsLabel,
  type Attachment,
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

export interface ReaderPaneProps {
  thread: UnifiedThread | undefined;
  onBack?: () => void;
  onSend?: (thread: UnifiedThread, body: string) => Promise<void>;
}

/**
 * Coluna de leitura de 1016 px do frame `@mail · Desktop`.
 *
 * Barra de ações de 72 px, título de 28/45 com 38 px de respiro depois da barra,
 * etiqueta de 26 px, mensagens anteriores em cartão de 74 px e a última mensagem
 * aberta, com o compositor de 132 px ao pé da coluna.
 */
export function ReaderPane({ thread, onBack, onSend }: ReaderPaneProps): ReactElement {
  const theme = useTheme();
  const store = useAppStore();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();
  const messages = useSelectedThreadMessages();
  const { feed } = useFeed();
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const mobile = onBack !== undefined;
  const gutter = mobile ? theme.layout.mobilePaddingX : theme.layout.readerGutter;

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
  const send = async (): Promise<void> => {
    if (!onSend || draft.trim().length === 0 || sending) return;
    setSending(true);
    setNotice(undefined);
    try {
      await onSend(thread, draft.trim());
      setDraft('');
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

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: theme.layout.readerTitleGap, paddingBottom: theme.space[8] }}>
        <Text
          style={{
            ...typeStyle(theme, mobile ? 'mobileTitle' : 'readerTitle'),
            color: theme.colors.textPrimary
          }}
        >
          {thread.subject}
        </Text>

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
          <Text
            style={{
              ...typeStyle(theme, 'readerTag'),
              color: theme.colors.textSecondary,
              marginLeft: theme.space[4]
            }}
          >
            {messages.length} {messages.length === 1 ? 'mensagem' : 'mensagens'}
          </Text>
        </View>

        <View style={{ marginTop: mobile ? theme.space[5] : theme.space[8], gap: theme.space[6] }}>
          {messages.map((message, index) =>
            index === messages.length - 1 ? (
              <CurrentMessage key={message.id} message={message} />
            ) : (
              <EarlierMessage key={message.id} message={message} />
            )
          )}
        </View>
      </ScrollView>

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
              Responder a {replyTarget}
            </Text>
          </View>

          <TextInput
            accessibilityLabel="Escrever resposta"
            multiline
            autoFocus={snapshot.ui.composeOpen}
            value={draft}
            onChangeText={(value) => {
              setDraft(value);
              if (notice !== undefined) setNotice(undefined);
            }}
            placeholder="Escreva uma resposta…"
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
            <Glyph name="attach" size={17} color={theme.colors.textSecondary} />
            <Text
              style={{
                ...typeStyle(theme, 'composeBody'),
                color: theme.colors.textSecondary,
                marginLeft: theme.space[3]
              }}
            >
              A
            </Text>
            <View style={{ flex: 1 }} />
            <Text style={{ ...typeStyle(theme, 'composeHint'), color: theme.colors.textSecondary }}>
              {platform === 'macos' || platform === 'ios' ? '⌘' : 'Ctrl'} Enter para enviar
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar resposta"
              accessibilityState={{ disabled: draft.trim().length === 0 }}
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
                backgroundColor: draft.trim().length === 0 ? theme.colors.borderStrong : theme.colors.textPrimary,
                opacity: draft.trim().length === 0 || sending ? 0.6 : 1
              }}
            >
              <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.surface }}>{sending ? 'Enviando…' : 'Enviar'}</Text>
              <Glyph name="arrow" size={14} color={theme.colors.surface} />
            </Pressable>
          </View>
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

function EarlierMessage({ message }: { message: MailMessage }): ReactElement {
  const theme = useTheme();
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
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
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

const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<]+)/gi;

function MessageBody({
  message,
  role,
  color
}: {
  message: MailMessage;
  role: 'earlierBody' | 'readerBody';
  color: string;
}): ReactElement {
  const theme = useTheme();
  if (Platform.OS === 'web' && message.channel === 'email' && message.bodyHtml) {
    return createElement('iframe', {
      title: `Corpo do e-mail: ${message.subject}`,
      sandbox: '',
      referrerPolicy: 'no-referrer',
      srcDoc: emailDocument(message.bodyHtml, theme.mode, theme.colors.surface, theme.colors.textPrimary),
      style: {
        display: 'block',
        width: '100%',
        height: role === 'readerBody' ? 560 : 260,
        marginTop: role === 'readerBody' ? theme.space[2] + 2 : 0,
        border: 0,
        backgroundColor: theme.colors.surface
      }
    });
  }
  const parts = message.bodyText.split(URL_PATTERN);
  return (
    <Text style={{ ...typeStyle(theme, role), color, ...(role === 'readerBody' ? { marginTop: theme.space[2] + 2 } : {}) }}>
      {parts.map((part, index) => {
        const isUrl = /^(?:https?:\/\/|www\.)/i.test(part);
        if (!isUrl) return part;
        const cleanUrl = part.replace(/[),.;!?]+$/, '');
        return (
          <Text
            key={`${cleanUrl}-${index}`}
            accessibilityRole="link"
            accessibilityLabel={`Abrir ${cleanUrl}`}
            onPress={() => void Linking.openURL(cleanUrl.startsWith('www.') ? `https://${cleanUrl}` : cleanUrl)}
            style={{ color: theme.colors.accent, textDecorationLine: 'underline' }}
          >
            {part}
          </Text>
        );
      })}
    </Text>
  );
}

function emailDocument(bodyHtml: string, mode: 'light' | 'dark', surface: string, text: string): string {
  const darkCanvas = mode === 'dark'
    ? `background-color:${surface}!important`
    : `background-color:${surface}`;
  const darkWrappers = mode === 'dark'
    ? `body>table,body>center,body>div,body>center>table{background-color:${surface}!important}`
    : '';
  const headContent = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="${mode}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:; base-uri 'none'; form-action 'none'"><style>:root{color-scheme:${mode}}html,body{margin:0;max-width:100%;min-height:100%;${darkCanvas};color:${text}}${darkWrappers}body{overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>`;
  const headOpen = /<head\b[^>]*>/i;
  const headClose = /<\/head\s*>/i;
  if (headClose.test(bodyHtml)) return bodyHtml.replace(headClose, (head) => `${headContent}${head}`);
  if (headOpen.test(bodyHtml)) return bodyHtml.replace(headOpen, (head) => `${head}${headContent}`);
  const htmlOpen = /<html\b[^>]*>/i;
  if (htmlOpen.test(bodyHtml)) return bodyHtml.replace(htmlOpen, (html) => `${html}<head>${headContent}</head>`);
  return `<!doctype html><html><head>${headContent}</head><body>${bodyHtml}</body></html>`;
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

function extensionLabel(attachment: Attachment): string {
  const extension = attachment.fileName.split('.').pop();
  return (extension ?? attachment.mimeType.split('/').pop() ?? 'arquivo').toUpperCase();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
