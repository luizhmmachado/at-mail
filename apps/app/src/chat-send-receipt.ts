export interface ChatSendReceipt {
  messageName: string;
  spaceResourceName: string;
  receivedAt: number;
}

export function parseChatSendReceipt(value: unknown): ChatSendReceipt | undefined {
  const result = value as (Partial<ChatSendReceipt> & { sent?: unknown }) | null | undefined;
  if (
    result?.sent === true &&
    result.messageName === undefined &&
    result.spaceResourceName === undefined &&
    result.receivedAt === undefined
  ) {
    return undefined;
  }
  if (
    typeof result?.messageName !== 'string' ||
    !/^spaces\/[A-Za-z0-9._-]+\/messages\/[A-Za-z0-9._-]+$/.test(result.messageName) ||
    typeof result.spaceResourceName !== 'string' ||
    !/^spaces\/[A-Za-z0-9._-]+$/.test(result.spaceResourceName) ||
    typeof result.receivedAt !== 'number' ||
    !Number.isFinite(result.receivedAt)
  ) {
    throw new Error('O Google Chat não retornou os dados da mensagem enviada.');
  }
  return { messageName: result.messageName, spaceResourceName: result.spaceResourceName, receivedAt: result.receivedAt };
}