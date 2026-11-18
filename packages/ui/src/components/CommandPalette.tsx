import type { ReactElement } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { formatRelativeTime, threadParticipantsLabel } from '@mail/core';
import { useTheme } from '../theme/MailThemeProvider';
import { useAppStore, useMailActions, useMailSnapshot } from '../store/MailStoreProvider';

export function CommandPalette(): ReactElement | null {
  const theme = useTheme();
  const store = useAppStore();
  const snapshot = useMailSnapshot();
  const actions = useMailActions();

  if (!snapshot.ui.commandPaletteOpen) return null;

  const results = store.getFeed().threads.slice(0, 8);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => actions.toggleCommandPalette(false)}>
      <Pressable
        accessibilityLabel="Fechar busca"
        onPress={() => actions.toggleCommandPalette(false)}
        style={{ flex: 1, backgroundColor: 'rgba(10,10,12,0.32)', alignItems: 'center', paddingTop: 96 }}
      >
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            width: '100%',
            maxWidth: 560,
            marginHorizontal: theme.space[4],
            borderRadius: theme.radius.xl,
            borderWidth: theme.border.hairline,
            borderColor: theme.colors.borderStrong,
            backgroundColor: theme.colors.surface,
            overflow: 'hidden'
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[2],
              paddingHorizontal: theme.space[3],
              height: 46,
              borderBottomWidth: theme.border.hairline,
              borderBottomColor: theme.colors.borderSubtle
            }}
          >
            <Text style={{ color: theme.colors.textTertiary }}>⌕</Text>
            <TextInput
              autoFocus
              accessibilityLabel="Busca global"
              value={snapshot.view.query}
              onChangeText={(value) => actions.setQuery(value)}
              placeholder="Buscar em todas as contas e contextos"
              placeholderTextColor={theme.colors.textTertiary}
              style={{
                flex: 1,
                fontFamily: theme.fonts.sans,
                fontSize: theme.typography.size.bodyLarge,
                color: theme.colors.textPrimary
              }}
            />
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: theme.typography.size.micro,
                color: theme.colors.textTertiary
              }}
            >
              Esc
            </Text>
          </View>

          <ScrollView style={{ maxHeight: 380 }}>
            {results.length === 0 ? (
              <Text
                style={{
                  padding: theme.space[4],
                  fontFamily: theme.fonts.sans,
                  fontSize: theme.typography.size.small,
                  color: theme.colors.textTertiary
                }}
              >
                Nenhum resultado. Filtros aceitos: from:, context:, in:, is:unread, has:attachment.
              </Text>
            ) : (
              results.map((thread, index) => (
                <Pressable
                  key={thread.id}
                  accessibilityRole="button"
                  onPress={() => {
                    actions.selectThread(thread.id);
                    actions.toggleCommandPalette(false);
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.space[2],
                    paddingHorizontal: theme.space[3],
                    paddingVertical: theme.space[2],
                    backgroundColor: index === 0 ? theme.colors.surfaceSelected : 'transparent'
                  }}
                >
                  <Text
                    style={{
                      fontFamily: theme.fonts.mono,
                      fontSize: theme.typography.size.micro,
                      color: thread.channel === 'chat' ? theme.colors.channelChat : theme.colors.channelEmail
                    }}
                  >
                    {thread.channel === 'chat' ? '#' : '✉'}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontFamily: theme.fonts.sans,
                        fontSize: theme.typography.size.small,
                        color: theme.colors.textPrimary
                      }}
                    >
                      {thread.subject}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontFamily: theme.fonts.sans,
                        fontSize: theme.typography.size.micro,
                        color: theme.colors.textTertiary
                      }}
                    >
                      {threadParticipantsLabel(thread, 3)}
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontFamily: theme.fonts.mono,
                      fontSize: theme.typography.size.micro,
                      color: theme.colors.textTertiary
                    }}
                  >
                    {formatRelativeTime(thread.lastActivityAt)}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
