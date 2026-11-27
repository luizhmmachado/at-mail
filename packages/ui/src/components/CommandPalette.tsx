import type { ReactElement } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { formatThreadTime, threadParticipantsLabel, type ThreadId } from '@mail/core';
import { useTheme } from '../theme/MailThemeProvider';
import { useAppStore, useMailActions, useMailSnapshot } from '../store/MailStoreProvider';
import { typeStyle } from '../theme/typography';
import { Glyph } from './LucideGlyph';

/**
 * Busca global (⌘K / Ctrl+K).
 *
 * Reaproveita o token de scrim e a mesma escala tipográfica da caixa unificada:
 * o modal não introduz uma segunda linguagem visual.
 */
export function CommandPalette({ mobile = false, searching = false, error, onSelectThread }: { mobile?: boolean; searching?: boolean; error?: string; onSelectThread?: (threadId: ThreadId) => void }): ReactElement | null {
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
        style={{
          flex: 1,
          backgroundColor: theme.colors.scrim,
          alignItems: 'center',
          paddingTop: 96
        }}
      >
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            width: '100%',
            maxWidth: 560,
            marginHorizontal: theme.space[4],
            borderRadius: theme.radius.xxl,
            borderWidth: theme.border.hairline,
            borderColor: theme.colors.borderSubtle,
            backgroundColor: theme.colors.surface,
            overflow: 'hidden',
            shadowColor: theme.colors.shadow,
            shadowOpacity: 1,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 12 }
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
            <Glyph name="search" size={16} color={theme.colors.textSecondary} />
            <TextInput
              autoFocus
              accessibilityLabel="Busca global"
              value={snapshot.view.query}
              onChangeText={(value) => actions.setQuery(value)}
              placeholder="Buscar em todas as contas e contextos"
              placeholderTextColor={theme.colors.textSecondary}
              style={{
                ...typeStyle(theme, 'body'),
                flex: 1,
                paddingVertical: 0,
                color: theme.colors.textPrimary
              }}
            />
            {!mobile && <Text style={{ ...typeStyle(theme, 'shortcut'), color: theme.colors.textSecondary }}>Esc</Text>}
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 380 }}>
            {error !== undefined ? (
              <Text accessibilityRole="alert" style={{ ...typeStyle(theme, 'body'), padding: theme.space[4], color: theme.colors.danger }}>
                {error}
              </Text>
            ) : searching ? (
              <Text style={{ ...typeStyle(theme, 'body'), padding: theme.space[4], color: theme.colors.textSecondary }}>
                Buscando em todos os e-mails da conta…
              </Text>
            ) : results.length === 0 ? (
              <Text
                style={{
                  ...typeStyle(theme, 'body'),
                  padding: theme.space[4],
                  color: theme.colors.textSecondary
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
                    if (onSelectThread) onSelectThread(thread.id);
                    else actions.selectThread(thread.id);
                    actions.toggleCommandPalette(false);
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.space[2] + 2,
                    paddingHorizontal: theme.space[3],
                    height: 52,
                    backgroundColor: index === 0 ? theme.colors.surfaceSelected : 'transparent'
                  }}
                >
                  <Glyph
                    name={thread.channel === 'chat' ? 'chat' : 'mail'}
                    size={14}
                    color={theme.colors.textSecondary}
                  />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{ ...typeStyle(theme, 'rowSubject'), color: theme.colors.textPrimary }}
                    >
                      {thread.subject}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{ ...typeStyle(theme, 'rowMeta'), color: theme.colors.textSecondary }}
                    >
                      {threadParticipantsLabel(thread, 3)}
                    </Text>
                  </View>
                  <Text style={{ ...typeStyle(theme, 'rowMeta'), color: theme.colors.textSecondary }}>
                    {formatThreadTime(thread.lastActivityAt)}
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
