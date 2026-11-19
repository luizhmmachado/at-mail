# @mail

Launcher unificado de **e-mail + Google Chat** para quem vive em várias contas o dia inteiro.
Multi-conta, contextos (Trabalho / Estudos / Pessoal), caixa única e navegação por teclado —
em **Web, iOS, Android, Windows, macOS e Linux** com a mesma base de código.

- `packages/core` — domínio, store observável, feed unificado, busca, sync, política de notificação, tokens
- `packages/ui` — componentes React Native (rodam em App/Web/Desktop)
- `apps/app` — Expo (Web + iOS + Android)
- `apps/desktop` — Tauri v2 (mesmo bundle web, WebView do sistema, sem Chromium embutido)

---

## Atalhos (Desktop/Web)

| Tecla | Ação |
| --- | --- |
| `⌘/Ctrl + K` | busca global (assunto, pessoa, `from:`, `context:`, `in:`, `is:unread`, `has:attachment`) |
| `J` / `K` | próxima / conversa anterior |
| `E` | arquivar |
| `R` | responder |
| `C` | escrever |
| `S` | favoritar |
| `U` | alternar "só não lidas" |
| `⌥1…⌥4` | contexto: tudo / trabalho / estudos / pessoal |
| `⌘/Ctrl + 1`, `2` | canal: e-mail, chat |
| `Esc` | fechar busca / cancelar |

No mobile: lista → leitor com "voltar" no topo; contextos em pills horizontais; o mesmo feed.

## O que já está implementado

- [x] Monorepo TypeScript com `core` (puro) + `ui` (React Native) + Expo + Tauri
- [x] Store observável com `useSyncExternalStore`, seleção automática e memoização
- [x] Feed unificado: agrupa e-mail por thread do provedor e chat por espaço, ordena por atividade
- [x] Threads do Google Chat: respostas ficam agrupadas sob a mensagem original. Abra o contador de respostas para ler e responder na thread; feche-a para voltar a enviar mensagens no espaço. No celular, a thread ocupa o leitor. O contador considera o histórico carregado; se a mensagem original não estiver nele, o app informa isso sem tratar uma resposta como a raiz.
- [x] Contextos com contadores de não lidas, presets + custom, silenciamento por política
- [x] Canal `Tudo | E-mail | Chat`, busca com operadores e toggle de não lidas
- [x] App Shell responsivo: 3 colunas no desktop, lista/leitor no mobile
- [x] Atalhos J/K/E/R/C/S/U/⌘K com supressão quando o foco está em input
- [x] `SyncEngine` incremental com concorrência limitada e pausa em `reauth-required`
- [x] Contrato de `SecretStore` por plataforma (Keychain/Keystore/Stronghold/cookie HttpOnly)
- [x] Política única de notificação por contexto (mobile usa `expo-notifications`)
- [x] Tokens do Figma como fonte única, com script de sincronização auditável
- [x] Testes de mesa das regras de feed, store e atalhos (`npm test`)
