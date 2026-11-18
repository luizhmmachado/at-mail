import { useMemo, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  contextAccent,
  formatRelativeTime,
  formatShortcut,
  isChatMessage,
  isEmailMessage,
  type MailMessage,
  type UnifiedThread
} from '@mail/core';
import { useTheme } from '../theme/MailThemeProvider';
import { useAppStore, useMailActions, useMailSnapshot, useSelectedThreadMessages } from '../store/MailStoreProvider';
import { currentPlatform } from '../platform';

export interface ReaderPaneProps {
  thread: UnifiedThread | undefined;
  onBack?: () => void;
}

export function ReaderPane({ thread, onBack }: ReaderPaneProps): ReactElement {
  const theme = useTheme();
  const store = useAppStore();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();
  const messages = useSelectedThreadMessages();
  const [draft, setDraft] = useState('');
  const platform = currentPlatform();

  const contextLabels = useMemo(
    () =>
      thread?.contextIds
        .map((contextId) => snapshot.contexts.find((context) => context.id === contextId))
        .filter((context): context is NonNullable<typeof context> => context !== undefined) ?? [],
    [snapshot.contexts, thread]
  );

  const accountLabels = useMemo(
    () =>
      Array.from(new Set(messages.map((message) => store.accountFor(message.accountId)?.email ?? ''))).filter(
        (email) => email.length > 0
      ),
    [messages, store]
  );

  if (thread === undefined) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surfaceSunken,
          gap: theme.space[2],
          padding: theme.space[6]
        }}
      >
        <Text
          style={{
            fontFamily: theme.fonts.sans,
            fontSize: theme.typography.size.title,
            fontWeight: theme.weights.medium,
            color: theme.colors.textSecondary
          }}
        >
          Nenhuma conversa aberta
        </Text>
        <Text
          style={{
            fontFamily: theme.fonts.sans,
            fontSize: theme.typography.size.small,
            color: theme.colors.textTertiary,
            textAlign: 'center'
          }}
        >
          Use J e K para navegar. Enter abre a conversa selecionada.
        </Text>
      </View>
    );
  }

  const isArchived = thread.emailFolder === 'archived';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.canvas }}>
      <View
        style={{
          paddingHorizontal: theme.space[4],
          paddingVertical: theme.space[3],
          gap: theme.space[2],
          borderBottomWidth: theme.border.hairline,
          borderBottomColor: theme.colors.borderSubtle,
          backgroundColor: theme.colors.canvas
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          {onBack !== undefined && (
            <Pressable accessibilityRole="button" accessibilityLabel="Voltar para a lista" onPress={onBack}>
              <Text style={{ fontSize: 15, color: theme.colors.textSecondary }}>‹</Text>
            </Pressable>
          )}

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[1],
              paddingHorizontal: theme.space[2],
              paddingVertical: 3,
              borderRadius: theme.radius.sm,
              backgroundColor: theme.colors.surfaceSunken,
              borderWidth: theme.border.hairline,
              borderColor: theme.colors.borderSubtle
            }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: theme.typography.size.micro,
                color: thread.channel === 'chat' ? theme.colors.channelChat : theme.colors.channelEmail
              }}
            >
              {thread.channel === 'chat' ? 'google chat' : 'e-mail'}
            </Text>
          </View>

          {contextLabels.map((context) => (
            <View key={context.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.colors[contextAccent(context.kind)]
                }}
              />
              <Text
                style={{
                  fontFamily: theme.fonts.sans,
                  fontSize: theme.typography.size.micro,
                  color: theme.colors.textTertiary
                }}
              >
                {context.name}
              </Text>
            </View>
          ))}

          <View style={{ flex: 1 }} />

          <ReaderAction
            label="Responder"
            hint={formatShortcut('reply', platform)}
            onPress={() => actions.toggleCompose(true)}
          />
          {!isArchived && (
            <ReaderAction
              label="Arquivar"
              hint={formatShortcut('archive', platform)}
              onPress={() => actions.archiveThread(thread.id)}
            />
          )}
        </View>

        <Text
          style={{
            fontFamily: theme.fonts.sans,
            fontSize: theme.typography.size.title,
            lineHeight: theme.typography.line.title,
            fontWeight: theme.weights.semibold,
            letterSpacing: theme.typography.tracking.tight,
            color: theme.colors.textPrimary
          }}
        >
          {thread.subject}
        </Text>

        <Text
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: theme.typography.size.micro,
            color: theme.colors.textTertiary
          }}
        >
          {accountLabels.join(' · ')} · {messages.length} mensagens
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4] }}>
        {messages.map((message) => (
          <MessageBlock key={message.id} message={message} />
        ))}
      </ScrollView>

      <View
        style={{
          borderTopWidth: theme.border.hairline,
          borderTopColor: theme.colors.borderSubtle,
          padding: theme.space[3],
          gap: theme.space[2],
          backgroundColor: theme.colors.surface
        }}
      >
        <TextInput
          accessibilityLabel="Escrever resposta"
          multiline
          value={draft}
          onChangeText={setDraft}
          placeholder="Responder…"
          placeholderTextColor={theme.colors.textTertiary}
          style={{
            minHeight: 48,
            maxHeight: 160,
            paddingHorizontal: theme.space[2] + 2,
            paddingVertical: theme.space[2],
            borderRadius: theme.radius.md,
            borderWidth: theme.border.hairline,
            borderColor: theme.colors.borderSubtle,
            backgroundColor: theme.colors.surfaceSunken,
            fontFamily: theme.fonts.sans,
            fontSize: theme.typography.size.body,
            color: theme.colors.textPrimary
          }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: theme.typography.size.micro,
              color: theme.colors.textTertiary
            }}
          >
            {accountLabels[0] ?? 'conta principal'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enviar resposta"
            disabled={draft.trim().length === 0}
            style={{
              paddingHorizontal: theme.space[3],
              paddingVertical: theme.space[1] + 2,
              borderRadius: theme.radius.md,
              backgroundColor: draft.trim().length === 0 ? theme.colors.surfaceSelected : theme.colors.accent
            }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.sans,
                fontSize: theme.typography.size.small,
                fontWeight: theme.weights.medium,
                color: draft.trim().length === 0 ? theme.colors.textTertiary : theme.colors.accentText
              }}
            >
              Enviar
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function MessageBlock({ message }: { message: MailMessage }): ReactElement {
  const theme = useTheme();
  const sender = message.participants[0];
  const initials = (sender?.name ?? '?')
    .split(' ')
    .map((part) => part[0])
    .filter((part) => part !== undefined)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <View style={{ flexDirection: 'row', gap: theme.space[2] + 2 }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.surfaceSelected,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Text
          style={{
            fontFamily: theme.fonts.sans,
            fontSize: theme.typography.size.micro,
            fontWeight: theme.weights.medium,
            color: theme.colors.textSecondary
          }}
        >
          {initials}
        </Text>
      </View>

      <View style={{ flex: 1, gap: theme.space[1] }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
          <Text
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: theme.typography.size.small,
              fontWeight: theme.weights.medium,
              color: message.isRead ? theme.colors.textSecondary : theme.colors.textPrimary
            }}
          >
            {sender?.name ?? (isChatMessage(message) ? message.senderName : '')}
          </Text>
          <Text
            style={{
              flex: 1,
              fontFamily: theme.fonts.mono,
              fontSize: theme.typography.size.micro,
              color: theme.colors.textTertiary
            }}
            numberOfLines={1}
          >
            {sender?.email ?? ''}
          </Text>
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: theme.typography.size.micro,
              color: theme.colors.textTertiary
            }}
          >
            {formatRelativeTime(message.receivedAt)}
          </Text>
        </View>

        <View
          style={
            isEmailMessage(message)
              ? { gap: theme.space[2] }
              : {
                  padding: theme.space[2] + 2,
                  borderRadius: theme.radius.lg,
                  backgroundColor: message.isMentioned ? theme.colors.accentMuted : theme.colors.surfaceSunken
                }
          }
        >
          <Text
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: theme.typography.size.body,
              lineHeight: theme.typography.line.bodyLarge,
              color: theme.colors.textPrimary
            }}
          >
            {message.bodyText}
          </Text>

          {isEmailMessage(message) && message.attachments.length > 0 && (
            <View style={{ flexDirection: 'row', gap: theme.space[1], flexWrap: 'wrap' }}>
              {message.attachments.map((attachment) => (
                <View
                  key={attachment.id}
                  style={{
                    paddingHorizontal: theme.space[2],
                    paddingVertical: 2,
                    borderRadius: theme.radius.sm,
                    borderWidth: theme.border.hairline,
                    borderColor: theme.colors.borderSubtle
                  }}
                >
                  <Text
                    style={{
                      fontFamily: theme.fonts.mono,
                      fontSize: theme.typography.size.micro,
                      color: theme.colors.textSecondary
                    }}
                  >
                    {attachment.fileName}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function ReaderAction({ label, hint, onPress }: { label: string; hint: string; onPress: () => void }): ReactElement {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} (${hint})`}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: theme.space[2],
        paddingVertical: theme.space[1],
        borderRadius: theme.radius.sm,
        backgroundColor: hovered ? theme.colors.surfaceHover : 'transparent'
      }}
    >
      <Text
        style={{
          fontFamily: theme.fonts.sans,
          fontSize: theme.typography.size.small,
          color: theme.colors.textSecondary
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: theme.typography.size.micro,
          color: theme.colors.textTertiary
        }}
      >
        {hint}
      </Text>
    </Pressable>
  );
}
