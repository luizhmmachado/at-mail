import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { Account, AccountId, ChannelKind } from '@mail/core';
import { useTheme } from '../theme/MailThemeProvider';
import { typeStyle } from '../theme/typography';
import { Glyph } from './LucideGlyph';

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENTS_BYTES = 3 * 1024 * 1024;

export interface NewMessageAttachment {
  fileName: string;
  mimeType: string;
  sizeInBytes: number;
  base64: string;
}

export async function selectMessageAttachments(attachments: NewMessageAttachment[]): Promise<NewMessageAttachment[]> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return attachments;
  if (attachments.length + result.assets.length > MAX_ATTACHMENTS) throw new Error(`Adicione no máximo ${MAX_ATTACHMENTS} arquivos por mensagem.`);
  const next = [...attachments];
  let totalBytes = attachments.reduce((total, attachment) => total + attachment.sizeInBytes, 0);
  for (const asset of result.assets) {
    const file = asset.base64 === undefined ? new File(asset.uri) : undefined;
    const sizeInBytes = asset.size ?? file?.size ?? Math.ceil((asset.base64?.length ?? 0) * 0.75);
    if (totalBytes + sizeInBytes > MAX_ATTACHMENTS_BYTES) throw new Error('O tamanho total dos anexos não pode ultrapassar 3 MB.');
    const encoded = asset.base64 ?? await file!.base64();
    const base64 = encoded.includes(',') ? encoded.slice(encoded.indexOf(',') + 1) : encoded;
    next.push({ fileName: asset.name, mimeType: asset.mimeType || file?.type || 'application/octet-stream', sizeInBytes, base64 });
    totalBytes += sizeInBytes;
  }
  return next;
}

export interface NewMessageSubmission {
  channel: ChannelKind;
  accountId: AccountId;
  recipients: string[];
  subject: string;
  body: string;
  attachments: NewMessageAttachment[];
}

export interface NewMessageComposerProps {
  visible: boolean;
  accounts: readonly Account[];
  onClose: () => void;
  onAddAccount?: () => void;
  onSend?: (message: NewMessageSubmission) => Promise<void>;
}

export function NewMessageComposer({ visible, accounts, onClose, onAddAccount, onSend }: NewMessageComposerProps): ReactElement {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [channel, setChannel] = useState<ChannelKind>('email');
  const [accountId, setAccountId] = useState<AccountId>();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [recipientsText, setRecipientsText] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<NewMessageAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const availableAccounts = accounts.filter((account) => account.channel === channel);
  const selectedAccount = availableAccounts.find((account) => account.id === accountId) ?? availableAccounts[0];
  const recipients = recipientsText.split(/[;,]/).map((recipient) => recipient.trim()).filter(Boolean);
  const recipientsValid = recipients.length > 0 && recipients.every((recipient) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(recipient));
  const hasContent = body.trim().length > 0 || attachments.length > 0;
  const canSend = selectedAccount !== undefined && recipientsValid && (channel === 'email' || recipients.length === 1) && hasContent && onSend !== undefined;

  async function pickAttachments(): Promise<void> {
    setError(undefined);
    try {
      setAttachments(await selectMessageAttachments(attachments));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível anexar o arquivo.');
    }
  }

  async function submit(): Promise<void> {
    if (!selectedAccount || !canSend || !onSend || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await onSend({ channel, accountId: selectedAccount.id, recipients, subject: subject.trim(), body: body.trim(), attachments });
      setRecipientsText('');
      setSubject('');
      setBody('');
      setAttachments([]);
      setAccountMenuOpen(false);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.32)' }}>
        <Pressable accessibilityLabel="Fechar nova mensagem" onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <View style={{ width: Math.min(width - 40, 560), maxHeight: '90%', overflow: 'hidden', borderRadius: theme.radius.xxl, backgroundColor: theme.colors.surface }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, borderBottomWidth: theme.border.hairline, borderBottomColor: theme.colors.borderSubtle }}>
            <Text style={{ ...typeStyle(theme, 'inboxTitle'), color: theme.colors.textPrimary }}>Nova mensagem</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Fechar nova mensagem" onPress={onClose}>
              <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.accent }}>Fechar</Text>
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <ChannelOption label="E-mail" icon="mail" selected={channel === 'email'} onPress={() => { setChannel('email'); setAccountMenuOpen(false); }} />
              <ChannelOption label="Chat" icon="chat" selected={channel === 'chat'} onPress={() => { setChannel('chat'); setAccountMenuOpen(false); }} />
            </View>

            <Text style={{ ...typeStyle(theme, 'sectionMeta', 'medium'), color: theme.colors.textSecondary, marginTop: 18 }}>DE</Text>
            {selectedAccount ? (
              <>
                <Pressable accessibilityRole="button" accessibilityLabel="Escolher conta de envio" onPress={() => setAccountMenuOpen((open) => !open)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, paddingHorizontal: 12, borderWidth: theme.border.hairline, borderColor: theme.colors.borderSubtle, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface }}>
                  <Text numberOfLines={1} style={{ ...typeStyle(theme, 'body'), flex: 1, color: theme.colors.textPrimary }}>{selectedAccount.email}</Text>
                  <Glyph name="chevron-down" size={16} color={theme.colors.textSecondary} />
                </Pressable>
                {accountMenuOpen && (
                  <View style={{ marginTop: 4, padding: 4, borderWidth: theme.border.hairline, borderColor: theme.colors.borderSubtle, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface }}>
                    {availableAccounts.map((account) => (
                      <Pressable key={account.id} accessibilityRole="button" accessibilityLabel={`Enviar de ${account.email}`} onPress={() => { setAccountId(account.id); setAccountMenuOpen(false); }} style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 10, borderRadius: theme.radius.sm, backgroundColor: account.id === selectedAccount.id ? theme.colors.accentMuted : 'transparent' }}>
                        <Text numberOfLines={1} style={{ ...typeStyle(theme, 'body'), color: account.id === selectedAccount.id ? theme.colors.accent : theme.colors.textPrimary }}>{account.email}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <View style={{ marginTop: 6, padding: 12, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
                <Text style={{ ...typeStyle(theme, 'body'), color: theme.colors.textSecondary, marginBottom: 8 }}>
                  Nenhuma conta de {channel === 'email' ? 'e-mail' : 'Chat'} conectada.
                </Text>
                <Pressable accessibilityRole="button" onPress={onAddAccount}>
                  <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.accent }}>Conectar conta Google</Text>
                </Pressable>
              </View>
            )}

            <Text style={{ ...typeStyle(theme, 'sectionMeta', 'medium'), color: theme.colors.textSecondary, marginTop: 18 }}>PARA</Text>
            <TextInput
              accessibilityLabel={channel === 'email' ? 'Destinatário do e-mail' : 'Destinatário do Chat'}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={recipientsText}
              onChangeText={setRecipientsText}
              placeholder={channel === 'email' ? 'nome@exemplo.com (separe vários por vírgula)' : 'pessoa@exemplo.com'}
              placeholderTextColor={theme.colors.textSecondary}
              style={{ ...typeStyle(theme, 'body'), minHeight: 44, marginTop: 6, paddingHorizontal: 12, borderWidth: theme.border.hairline, borderColor: theme.colors.borderSubtle, borderRadius: theme.radius.lg, color: theme.colors.textPrimary }}
            />

            {(
              <>
                <Text style={{ ...typeStyle(theme, 'sectionMeta', 'medium'), color: theme.colors.textSecondary, marginTop: 16 }}>ASSUNTO</Text>
                <TextInput
                  accessibilityLabel="Assunto do e-mail"
                  value={subject}
                  onChangeText={setSubject}
                  placeholder="Assunto"
                  placeholderTextColor={theme.colors.textSecondary}
                  style={{ ...typeStyle(theme, 'body'), minHeight: 44, marginTop: 6, paddingHorizontal: 12, borderWidth: theme.border.hairline, borderColor: theme.colors.borderSubtle, borderRadius: theme.radius.lg, color: theme.colors.textPrimary }}
                />
              </>
            )}

            <Text style={{ ...typeStyle(theme, 'sectionMeta', 'medium'), color: theme.colors.textSecondary, marginTop: 16 }}>MENSAGEM</Text>
            <TextInput
              accessibilityLabel="Corpo da mensagem"
              multiline
              value={body}
              onChangeText={setBody}
              placeholder="Escreva sua mensagem…"
              placeholderTextColor={theme.colors.textSecondary}
              textAlignVertical="top"
              style={{ ...typeStyle(theme, 'composeBody'), minHeight: 140, marginTop: 6, padding: 12, borderWidth: theme.border.hairline, borderColor: theme.colors.borderSubtle, borderRadius: theme.radius.lg, color: theme.colors.textPrimary }}
            />

            {channel === 'email' && (
              <View style={{ marginTop: 12 }}>
                <Pressable accessibilityRole="button" accessibilityLabel="Anexar arquivos" onPress={() => void pickAttachments()} style={{ minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Glyph name="attach" size={17} color={theme.colors.textSecondary} />
                  <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.textSecondary }}>Anexar arquivo(s) · até 3 MB</Text>
                </Pressable>
                {attachments.map((attachment, index) => (
                  <View key={`${attachment.fileName}-${index}`} style={{ minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: theme.border.hairline, borderTopColor: theme.colors.borderSubtle }}>
                    <Glyph name="file" size={15} color={theme.colors.textSecondary} />
                    <Text numberOfLines={1} style={{ ...typeStyle(theme, 'rowMeta'), flex: 1, color: theme.colors.textPrimary }}>{attachment.fileName}</Text>
                    <Text style={{ ...typeStyle(theme, 'rowMeta'), color: theme.colors.textSecondary }}>{formatSize(attachment.sizeInBytes)}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Remover ${attachment.fileName}`} onPress={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                      <Text style={{ ...typeStyle(theme, 'rowMeta'), color: theme.colors.accent }}>Remover</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {error !== undefined && <Text accessibilityRole="alert" style={{ ...typeStyle(theme, 'body'), color: theme.colors.danger, marginTop: 10 }}>{error}</Text>}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={channel === 'email' ? 'Enviar novo e-mail' : 'Enviar nova mensagem de Chat'}
              accessibilityState={{ disabled: !canSend || sending }}
              disabled={!canSend || sending}
              onPress={() => void submit()}
              style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18, borderRadius: theme.radius.lg, backgroundColor: canSend ? theme.colors.textPrimary : theme.colors.borderStrong }}
            >
              {sending && <ActivityIndicator size="small" color={theme.colors.surface} />}
              <Text style={{ ...typeStyle(theme, 'button'), color: theme.colors.surface }}>{sending ? 'Enviando…' : `Enviar ${channel === 'email' ? 'e-mail' : 'mensagem'}`}</Text>
              {!sending && <Glyph name="arrow" size={15} color={theme.colors.surface} />}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ChannelOption({ label, icon, selected, onPress }: { label: string; icon: 'mail' | 'chat'; selected: boolean; onPress: () => void }): ReactElement {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={{ flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: theme.radius.lg, backgroundColor: selected ? theme.colors.accentMuted : theme.colors.surfaceSunken }}>
      <Glyph name={icon} size={16} color={selected ? theme.colors.accent : theme.colors.textSecondary} />
      <Text style={{ ...typeStyle(theme, 'segment', selected ? 'medium' : 'regular'), color: selected ? theme.colors.accent : theme.colors.textSecondary }}>{label}</Text>
    </Pressable>
  );
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}