# @mail

Launcher unificado de **e-mail + Google Chat** para quem vive em várias contas o dia inteiro.
Multi-conta, contextos (Trabalho / Estudos / Pessoal), caixa única e navegação por teclado —
em **Web, iOS, Android, Windows, macOS e Linux** com a mesma base de código.

- `packages/core` — domínio, store observável, feed unificado, busca, sync, política de notificação, tokens
- `packages/ui` — componentes React Native (rodam em App/Web/Desktop)
- `apps/app` — Expo (Web + iOS + Android)
- `apps/desktop` — Tauri v2 (mesmo bundle web, WebView do sistema, sem Chromium embutido)

Detalhes de decisão de stack: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

---

## Nota sobre o nome

O GitHub não aceita `@` em nome de repositório, portanto o remoto é **`at-mail`**, mas o
produto, o pacote raiz (`@mail/root`), o `productName` do desktop e o slug exibido são **`@mail`**.

- Repositório: <https://github.com/luizhmmachado/at-mail> (privado)

## Começando

```bash
git clone git@github.com:luizhmmachado/at-mail.git
cd at-mail
npm install
```

Rodar sem nenhuma credencial (modo demo, dados locais):

```bash
npm run web        # http://localhost:8081
npm run ios        # simulador iOS (precisa de Xcode)
npm run android    # emulador Android (precisa do Android SDK)
```

Conectar contas reais:

```bash
cp .env.example .env       # Client ID/Secret vão aqui (lidos pelo backend, não pelo app)
npm run web
```

O projeto Google Cloud já existe: **`at-mail-515112`**. O passo a passo completo — o que fazer
no navegador, no Cloud Shell e no seu terminal, com os links diretos — está em
[docs/GOOGLE-API-SETUP.md](./docs/GOOGLE-API-SETUP.md).

> **Importante:** o serviço de sincronização agora está em `services/sync`. Sem
> `EXPO_PUBLIC_SYNC_API_URL` o app roda em modo demo, com dados locais. Para ativá-lo, copie
> `services/sync/.env.example`, gere uma chave de 32 bytes e rode `npm run sync`.

Desktop:

```bash
npm run desktop            # tauri dev (Rust + WebView do SO)
```

## Design aplicado (Figma)

O layout vem do arquivo `qqjxZUMeAj95mXV7wYtTEw`, frames **`@mail · Desktop` (2:2, 1440×900)**
e **`@mail · Mobile` (2:6, 390×844)**, não de valores aproximados:

- rail de 64 px com tiles de contexto 48×58 e indicadores de 8 px;
- caixa unificada de 360 px: título 20/24, busca 34 px, segmentado 32 px, linha de 72 px com
  indicador de 6 px, assunto 12/15 e divisor recuado 24 px;
- leitura com barra de ações de 72 px, gutter de 80 px (856 px de conteúdo), título 28/45,
  etiqueta de 26 px, cartão de mensagem anterior de 74 px e compositor de 132 px;
- mobile com linha de 84 px, segmentado de 36 px e navegação inferior de 84 px;
- **Inter** 400/500/600 embarcada; letter-spacing de -1% convertido em px.

| Desktop | Mobile (lista) | Mobile (leitura) |
| --- | --- | --- |
| ![Desktop](./docs/screenshots/desktop.png) | ![Lista](./docs/screenshots/mobile-list.png) | ![Leitura](./docs/screenshots/mobile-reader.png) |

Os valores e a tabela de papéis tipográficos estão em
[docs/DESIGN-TOKENS.md](./docs/DESIGN-TOKENS.md). Para reler o Figma:

```bash
npm run tokens:sync -- --force   # exige FIGMA_ACCESS_TOKEN no .env
```

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
- [x] Contextos com contadores de não lidas, presets + custom, silenciamento por política
- [x] Canal `Tudo | E-mail | Chat`, busca com operadores e toggle de não lidas
- [x] App Shell responsivo: 3 colunas no desktop, lista/leitor no mobile
- [x] Atalhos J/K/E/R/C/S/U/⌘K com supressão quando o foco está em input
- [x] `SyncEngine` incremental com concorrência limitada e pausa em `reauth-required`
- [x] Contrato de `SecretStore` por plataforma (Keychain/Keystore/Stronghold/cookie HttpOnly)
- [x] Política única de notificação por contexto (mobile usa `expo-notifications`)
- [x] Tokens do Figma como fonte única, com script de sincronização auditável
- [x] Testes de mesa das regras de feed, store e atalhos (`npm test`)

## O que é placeholder de propósito

| Item | Estado | Por quê |
| --- | --- | --- |
| Valores de cor/espaço | `provisional` | extração do Figma depende do seu token + node-id do frame |
| `apps/app/src/store.ts` (modo demo) | dados de `createSeedData` | permite avaliar a UI sem backend |
| `adapters/sync-client.ts` | contrato HTTP pronto, sem servidor | backend de sync é um serviço à parte (ver docs) |
| Envio de resposta | botão desabilitado sem conteúdo; sem `send` implementado | falta escopo `gmail.send` e assinatura MIME |
| Swipe no mobile | não implementado | fase de polimento com `react-native-gesture-handler` |
| Ícones nativos do Tauri | ausentes | rodar `npm --workspace apps/desktop run icon -- ./icon.png` |

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run web` / `ios` / `android` | Expo por plataforma |
| `npm run desktop` | Tauri dev |
| `npm run tokens:sync` | Figma → `figma.tokens.json` |
| `npm test` | testes do `core` (node:test via tsx) |
| `npm run typecheck` | `tsc -b` no monorepo |
| `npm run sync` | servidor local OAuth/vault/Gmail/Chat em `:8790` |

## Segurança

- Refresh tokens **nunca** no cliente web (cookie `HttpOnly` + backend).
- Mobile/desktop: Keychain/Keystore/Stronghold; a store carrega apenas `secretRef`.
- CSP do desktop restrita a `self` + APIs do Google.
- Escopos mínimos e consentimento incremental na primeira resposta.

## Documentação

- [Arquitetura e stack](./docs/ARCHITECTURE.md)
- [Modelagem de dados](./docs/DATA-MODEL.md)
- [Design tokens / Figma](./docs/DESIGN-TOKENS.md)
- [Configuração Google Cloud](./docs/GOOGLE-API-SETUP.md)
