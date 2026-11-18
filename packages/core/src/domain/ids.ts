export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type AccountId = Brand<string, 'AccountId'>;
export type ContextId = Brand<string, 'ContextId'>;
export type ThreadId = Brand<string, 'ThreadId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type SpaceId = Brand<string, 'SpaceId'>;

/** Referência opaca a um segredo (Keychain/Keystore/cofre Web). Nunca o token em si. */
export type SecretRef = Brand<string, 'SecretRef'>;

export const brand = {
  account: (value: string) => value as AccountId,
  context: (value: string) => value as ContextId,
  thread: (value: string) => value as ThreadId,
  message: (value: string) => value as MessageId,
  space: (value: string) => value as SpaceId,
  secret: (value: string) => value as SecretRef
} as const;
