# @mail — Modelagem de dados

Todo o modelo vive em `packages/core/src/domain/models.ts`. As entidades são **imutáveis por
convenção**: toda alteração passa por `store.actions`, que cria novos objetos (o React detecta
mudança por identidade de referência).

## Tipos primitivos

IDs são branded types (`AccountId`, `ContextId`, `ThreadId`, `MessageId`, `SpaceId`,
`SecretRef`) — o TypeScript impede trocar um `AccountId` por um `MessageId`. Em runtime são
strings; não há custo.

## `Account`

Uma credencial conectada = uma conta. A mesma pessoa pode ter 4 registros (Gmail trabalho,
Chat trabalho, Gmail estudos, iCloud pessoal).

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | `AccountId` | estável, gerado no onboarding (`acc-<provider>-<uuid>`) |
| `provider` | `'gmail' \| 'google-chat' \| 'microsoft-graph' \| 'imap' \| 'icloud'` | define o adapter |
| `channel` | `'email' \| 'chat'` | permite a mesma conta lógica ter dois canais |
| `transport` | `'oauth2-google' \| 'oauth2-microsoft' \| 'imap-smtp'` | como autenticar |
| `contextId` | `ContextId` | **um** contexto por conta (Trabalho/Estudos/Pessoal/custom) |
| `status` | `connected \| syncing \| reauth-required \| error \| paused` | `reauth-required` pausa o sync |
| `syncCursor` | `string?` | opaco: `historyId`, `deltaLink`, `UIDVALIDITY:UID` |
| `secretRef` | `SecretRef` | **referência** ao segredo; nunca o segredo |

Invariantes:

1. `email` é única por `(provider, channel)` — impede duplicar a mesma caixa.
2. Remover a conta remove `messages` daquele `accountId` (cascata em memória).
3. Mover a conta de contexto move também as mensagens já sincronizadas (o contexto é
   propriedade funcional, não do provedor).

## `ContextWorkspace`

| Campo | Tipo | Nota |
| --- | --- | --- |
| `id` | `ContextId` | presets usam `work`, `studies`, `personal` |
| `kind` | `'work' \| 'studies' \| 'personal' \| 'custom'` | resolve a cor de destaque no tema |
| `name` | `string` | renomeável pelo usuário |
| `order` | `number` | ordem no alternador |
| `notificationPolicy` | `'all' \| 'mentions' \| 'none'` | ver `decideNotification` |
| `muted` | `boolean` | silencia tudo, inclusive menções |

Presets criados por `createPresetContexts()`. Contextos são **aditivos**: criar "Consultoria"
não afeta os três presets.

## `EmailMessage` / `ChatMessage` / `MailMessage`

`MailMessage` é a união discriminada por `channel`, o que dá `switch` exaustivo no
TypeScript (sem `as`).

Campos comuns (`BaseMessage`): `id`, `accountId`, `contextId`, `channel`, `participants[]`,
`snippet`, `bodyText`, `bodyHtml?`, `receivedAt`, `isRead`, `isStarred`, `isMentioned`,
`labels[]`.

Específicos de e-mail:

| Campo | Uso |
| --- | --- |
| `subject` | assunto (string vazia vira `(sem assunto)` no adapter) |
| `providerThreadId` | `threadId` do Gmail / raiz de `References` no IMAP |
| `rfcMessageId`, `inReplyTo`, `references[]` | threading RFC 5322 correto |
| `folder` | `inbox \| sent \| draft \| archived \| trash \| spam` |
| `attachments[]` | metadados; binário nunca entra na store |

Específicos de chat:

| Campo | Uso |
| --- | --- |
| `spaceId`, `spaceName` | agrupamento da conversa |
| `senderName` | autor da mensagem (chat tem N autores, e-mail tem thread) |
| `isDirectMessage` | DM vs. espaço |
| `threadName?` | thread dentro do espaço |

## `UnifiedThread` (derivado, nunca persistido)

Agregação produzida por `buildUnifiedThreads()`:

| Campo | Regra |
| --- | --- |
| `id` | `email:<accountId>:<providerThreadId>` ou `chat:<accountId>:<spaceId>` |
| `channel` | `'email' \| 'chat' \| 'mixed'` (mixed quando o grupo tem os dois — futuro) |
| `messageIds[]` | ordem de chegada |
| `lastActivityAt` | máximo `receivedAt` → define ordenação |
| `unreadCount` | contagem de mensagens não lidas |
| `flags` | `isStarred`, `hasAttachments`, `isMentioned`, `hasUnread` (OR entre mensagens) |
| `emailFolder?` | pasta da mensagem mais recente |

**Por que derivar em vez de persistir:** persistir thread exige reconciliar três fontes
(sync, ação local, ação do servidor) e é a origem clássica de "thread duplicada". Derivando,
qualquer inconsistência desaparece no próximo cálculo. Custo: O(n) por mudança de mensagens,
com n ≈ milhares de mensagens em memória — irrelevante em relação a um frame de 16 ms.

## Visões e filtros

```ts
type ContextFilter = ContextId | 'all';
type ChannelFilter = 'all' | 'email' | 'chat';
```

`selectFeed(messages, query)` aplica, nesta ordem:

1. **Contexto** — `thread.contextIds.includes(contextId)`.
2. **Canal** — `thread.channel === channel` (ou `mixed`).
3. **Não lidas** — `unreadCount > 0` quando o toggle está ativo.
4. **Busca** — todos os termos precisam casar (AND), com operadores:
   `from:`/`de:`, `context:`/`contexto:`, `in:`/`canal:`, `is:unread`, `is:starred`,
   `has:attachment`, `folder:`.
5. **Visibilidade de pasta** — `archived` fica fora por padrão (E arquiva), `sent` também.

Resultado: `threads` ordenadas por `lastActivityAt` desc + agregados
(`totalUnread`, `unreadByChannel`, `threadCountByContext`).

## Notificações

`decideNotification(context, message, activeContext)` é a única fonte de decisão:

| Situação | Resultado |
| --- | --- |
| `context.muted` | não notifica |
| `policy = 'none'` | não notifica (só badge) |
| `policy = 'mentions'` e sem menção | não notifica |
| contexto já em foco | não notifica (o usuário está olhando) |
| caso contrário | notifica |

A mesma função roda no mobile (push local) e no desktop (tray/toast), garantindo que
"silenciar Trabalho" signifique a mesma coisa nas três plataformas.

## Estado de UI

```
view: { contextId, channel, query, unreadOnly, selectedThreadId, selectionPinned }
sync: { status, inFlightAccounts[], lastSyncedAt, lastError }
ui:   { themeMode, commandPaletteOpen, composeOpen, sidebarCollapsed }
```

`selectionPinned = false` significa seleção automática (primeira thread da lista); qualquer
mudança de filtro limpa a seleção e o próximo render fixa a primeira thread visível. Isso
evita o bug de "abri uma conversa, troquei de contexto e continuo vendo a conversa antiga".

## Persistência (fase 2)

Esquema alvo, um banco por dispositivo:

```sql
CREATE TABLE accounts (id TEXT PRIMARY KEY, provider TEXT NOT NULL, channel TEXT NOT NULL,
  context_id TEXT NOT NULL, cursor TEXT, status TEXT NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE contexts (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
  sort_order INTEGER NOT NULL, notification_policy TEXT NOT NULL, muted INTEGER NOT NULL);

CREATE TABLE messages (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, context_id TEXT NOT NULL,
  channel TEXT NOT NULL, received_at INTEGER NOT NULL, is_read INTEGER NOT NULL,
  thread_key TEXT NOT NULL, payload TEXT NOT NULL);

CREATE INDEX idx_messages_feed ON messages (context_id, channel, received_at DESC);
CREATE INDEX idx_messages_thread ON messages (thread_key, received_at ASC);
```

`thread_key` é exatamente o `id` derivado — o índice permite montar a lista sem varrer tudo.
Sem `JOIN` obrigatório: a lista lê `messages` e agrupa em memória, igual ao `core` atual.
