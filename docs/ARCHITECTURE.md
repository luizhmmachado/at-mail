# @mail — Arquitetura

## Decisão de stack

**Um monorepo TypeScript com uma única camada de UI (React Native) e três alvos:
Web, Mobile (iOS/Android) e Desktop (Tauri).**

| Opção | Reuso de UI | Reuso de regra de negócio | Fidelidade ao Figma | RAM no desktop | Push mobile | Veredito |
| --- | --- | --- | --- | --- | --- | --- |
| React Native + RN-Web + Tauri | total | total | alta (flexbox igual ao Figma) | baixa (WebView do SO ≈ 80–140 MB) | nativo (Expo Notifications) | **escolhida** |
| React + RN + Electron | total | total | alta | alta (Chromium embutido ≈ 250–400 MB) | via app nativo | descartada |
| Flutter | total | alta (Dart isolado) | alta | média (engine próprio ≈ 150–200 MB) | nativo | descartada |
| KMP + Compose Multiplatform | media (Web = Wasm, imaturo) | alta | alta | baixa | nativo | descartada |
| Duas bases (Web React + Mobile nativo) | nenhum | nenhum | risco de divergência | baixa | nativo | descartada |

Por que a escolhida vence:

1. **Um componente, três plataformas.** `packages/ui` é escrita em primitivas do React Native
   (`View`, `Text`, `Pressable`, `SectionList`). O RN-Web traduz para DOM; o Expo empacota
   para iOS/Android; o Tauri carrega o mesmo bundle web numa WebView do sistema.
2. **Regra de negócio pura em `packages/core`**, sem React, sem I/O de plataforma. Pode ser
   testada com `node --test` e reaproveitada por qualquer alvo (inclusive um futuro CLI).
3. **Desktop leve.** Tauri usa WebView2/WKWebView/WebKitGTK, sem Chromium embutido — o
   requisito de "baixo consumo de RAM" é o principal motivo de não usarmos Electron.
4. **Fidelidade ao Figma.** O Figma é flexbox; React Native é flexbox. Layout de 3 colunas
   com larguras fixas (`sidebarWidth`, `listWidth`) e `flex: 1` no leitor é transposto
   literalmente, sem camada de "tradução" de CSS.
5. **Gestos e atalhos** ficam no mesmo código: `Platform.OS` decide `J/K/E/R` (desktop/web) e
   swipe (mobile), com a mesma store.

### Trade-off assumido

No mobile o layout usa a mesma árvore de componentes com breakpoint (`mobileBreakpoint: 860`),
em vez de telas nativas separadas. Ganhamos consistência e velocidade de entrega; perdemos
gestos nativos "de fábrica" (ex.: swipe-to-archive com físico de mola), que são implementados
com `react-native-gesture-handler` na fase de polimento.

## Camadas

```
apps/app        Expo (Web / iOS / Android)        apps/desktop  Tauri v2 (Windows/macOS/Linux)
        \                                        /
         \______ packages/ui (React Native) ____/
                          |
                  packages/core (TypeScript puro)
                          |
   domain · state · sync · auth · notifications · theme
```

Regra de dependência: `apps → ui → core`. Nunca o contrário. `core` não importa React nem
`react-native`; `ui` não importa `expo-*` nem Tauri.

## Estrutura de pastas

```
at-mail/
├── apps/
│   ├── app/                      # Expo — Web, iOS, Android
│   │   ├── App.tsx               # monta MailStoreProvider + AppShell
│   │   ├── index.js              # registerRootComponent
│   │   ├── app.json              # metadados iOS/Android/Web
│   │   ├── metro.config.js       # resolução de workspace
│   │   └── src/
│   │       ├── config.ts         # SYNC_API_URL, escopos OAuth
│   │       ├── store.ts          # instância única da store + SyncEngine
│   │       ├── notifications.ts  # push local com política por contexto
│   │       └── adapters/sync-client.ts
│   └── desktop/
│       └── src-tauri/            # janela nativa + CSP + bundle
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── domain/           # Account, ContextWorkspace, UnifiedThread...
│   │       ├── state/            # store observável + feed unificado + busca
│   │       ├── sync/             # contrato de adapter + orquestrador
│   │       ├── auth/             # contrato de SecretStore (Keychain/Keystore)
│   │       ├── notifications/    # política por contexto
│   │       ├── theme/            # tokens do Figma (fonte única de verdade)
│   │       └── data/             # seed determinístico para demo/dev
│   └── ui/
│       └── src/
│           ├── components/       # AppShell, ContextSwitcher, lista, leitor...
│           ├── hooks/            # atalhos de teclado
│           ├── store/            # bindings React (useSyncExternalStore)
│           └── theme/            # provider de tema
├── docs/
└── scripts/figma-sync-tokens.mjs
```

## Modelo de estado

Uma store única, **observável e agnóstica de framework**
(`useSyncExternalStore` faz o binding), com estado normalizado:

- `messages` — lista achatada de `MailMessage` (e-mail + chat), ordenada por `receivedAt`.
- `accounts` / `contexts` — configuração.
- `view` — filtros ativos (`contextId`, `channel`, `query`, `unreadOnly`, seleção).
- `derivado` — `UnifiedThread` **nunca é persistido**: é calculado por
  `buildUnifiedThreads` a cada mudança e memoizado por identidade de referência.
  Isso elimina a classe de bug mais comum nesses apps: thread "fantasma" depois de arquivar.

Detalhes de filtro e busca em [DATA-MODEL.md](./DATA-MODEL.md).

## Sincronização

```
SyncEngine ──► MailboxAdapter.fetchSince(account, cursor) ──► SyncPage
                   │                                          ├── messages[]
                   │                                          ├── nextCursor
                   │                                          ├── removedIds[]
                   │                                          └── requiresReauth
                   └── HTTP (backend)  ou  Google API direta (desktop/mobile)
```

- **Incremental por cursor**: `historyId` (Gmail), `deltaLink` (Graph), `UIDVALIDITY+UID`
  (IMAP). Sem varredura completa, sem paginação infinita na UI.
- **Paralelismo limitado** (`concurrency: 3`) para respeitar quota e não travar a UI.
- **Erro de autenticação pausa a conta** (`reauth-required`) em vez de tentar de novo a cada
  abertura — evita bloqueio por excesso de chamadas.
- **Um único `syncAll()` em voo**: chamadas concorrentes compartilham a mesma promise.

## Segurança de credenciais

| Plataforma | Armazenamento | Observação |
| --- | --- | --- |
| Web | cookie `HttpOnly; Secure; SameSite=Lax` emitido pelo backend | o browser nunca lê o refresh token |
| iOS/Android | `expo-secure-store` (Keychain / Android Keystore) | `accessibility: WHEN_UNLOCKED_THIS_DEVICE_ONLY` |
| Desktop | cofre criptografado (Tauri Stronghold) ou Keyring do SO | Argon2 + segredo derivado do usuário |

`Account.secretRef` guarda **apenas uma referência** (`account:<id>:oauth`). Nenhum token entra
em `localStorage`, `AsyncStorage` ou no snapshot da store — nem em log.

## Performance

- Lista virtualizada (`SectionList`), altura de linha vinda do token (`rowHeight` = 68).
- Tema resolvido por objeto memoizado; nenhum cálculo de cor em render.
- Seleção automática de thread só recalcula quando o feed muda (cache por referência).
- `SyncEngine` roda após o primeiro paint (`useEffect`), não bloqueia a abertura da janela.
- CSP restritiva no Tauri limita `connect-src` às APIs do Google — defesa em profundidade
  contra exfiltração de token por dependência comprometida.

## Próximos passos técnicos (fora do escopo desta base)

1. Banco local (SQLite via `expo-sqlite` / Tauri SQL) com fila de mutações offline.
2. Push real do Gmail (`users.watch` + Pub/Sub) e do Chat (`spaces.messages.subscribe`).
3. Assinatura/threading MIME (Reply-To, References) para resposta em thread.
4. Busca full-text local (FTS5) para o `Cmd/Ctrl + K` responder offline.
