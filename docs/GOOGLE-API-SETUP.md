# @mail — Configuração do Google Cloud (Gmail API + Chat API + OAuth 2.0)

Objetivo: conectar contas reais (e-mail e Google Chat) ao @mail nas três plataformas.
Tempo estimado: 20–30 min na primeira vez.

> **Pré-requisito importante:** a **Google Chat API** só funciona para contas **Google
> Workspace** (domínio corporativo/educacional). Contas `@gmail.com` conseguem usar apenas
> Gmail (o canal Chat aparece como indisponível no onboarding). Se o público for consumidor
> final com Gmail pessoal, o chat precisa de outro provedor — o modelo de dados já suporta.

---

## 1. Criar o projeto

1. Abra <https://console.cloud.google.com/projectcreate>.
2. Nome: `at-mail` · ID sugerido: `at-mail-prod` · Organização: a da sua conta.
3. Anote o **Project ID**. Todos os comandos `gcloud` abaixo assumem:

   ```bash
   gcloud config set project at-mail-prod
   ```

## 2. Ativar as APIs

```bash
gcloud services enable \
  gmail.googleapis.com \
  chat.googleapis.com \
  people.googleapis.com \
  oauth2.googleapis.com \
  pubsub.googleapis.com
```

| API | Para quê |
| --- | --- |
| `gmail.googleapis.com` | listar threads, ler, arquivar, marcar como lido |
| `chat.googleapis.com` | espaços, mensagens, threads |
| `people.googleapis.com` | nome/foto da conta conectada |
| `pubsub.googleapis.com` | push em tempo real (`users.watch`, `spaces.messages.subscribe`) |

## 3. Tela de consentimento OAuth

`APIs & Services → OAuth consent screen`

1. **User type**
   - `Internal` se o app é só para o seu Workspace (sem verificação, mais simples).
   - `External` para qualquer conta; exige **verificação do Google** para escopos sensíveis.
2. **App information**: nome `@mail`, e-mail de suporte, logo 120×120 (opcional).
3. **Authorized domains**: `atmail.app` (ou o domínio do seu backend).
4. **Scopes** — adicione exatamente estes (menor privilégio):

   | Escopo | Uso | Sensível? |
   | --- | --- | --- |
   | `openid`, `email`, `profile` | identidade da conta | não |
   | `https://www.googleapis.com/auth/gmail.modify` | ler, arquivar, marcar lido | **sim** |
   | `https://www.googleapis.com/auth/gmail.send` | enviar/respnder (opcional) | **sim** |
   | `https://www.googleapis.com/auth/chat.messages.readonly` | ler mensagens | **sim** |
   | `https://www.googleapis.com/auth/chat.spaces.readonly` | listar espaços | **sim** |

   > Prefere não pedir `gmail.send` de início? Deixe de fora: o app funciona em modo leitura +
   > organização, e o envio pede consentimento incremental na primeira resposta
   > (`include_granted_scopes=true`).

5. **Test users**: enquanto o app estiver em `Testing`, adicione as contas que vão testar
   (limite de 100). Sem isso o login retorna `Error 403: access_denied`.

## 4. Criar as credenciais (uma por plataforma)

`APIs & Services → Credentials → Create credentials → OAuth client ID`

### 4.1 Web (obrigatório — a web não pode guardar refresh token)

- Tipo: **Web application**
- **Authorized redirect URIs**:
  - `http://localhost:8081/auth/google/callback` (Expo web em dev)
  - `https://sync.atmail.app/auth/google/callback` (produção)
- **Authorized JavaScript origins**: `http://localhost:8081`, `https://app.atmail.app`

Fluxo: **Authorization Code + PKCE**, trocado no **backend**. O browser recebe um cookie
`HttpOnly` de sessão e nunca vê o refresh token.

### 4.2 iOS

- Tipo: **iOS**
- Bundle ID: `app.atmail.client` (igual ao `app.json`)

### 4.3 Android

- Tipo: **Android**
- Package name: `app.atmail.client`
- SHA-1 do keystore de debug e de release:

  ```bash
  keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android | grep SHA1
  ```

### 4.4 Desktop (Windows/macOS/Linux)

- Tipo: **Desktop app**
- O Tauri/Expo usam **loopback** (`http://127.0.0.1:<porta aleatória>`) ou **device code**.
  Cadastre `http://127.0.0.1` — o Google aceita qualquer porta no loopback para clients
  "Desktop app".
- Guarde o refresh token no cofre do SO (Stronghold/Keychain/Credential Manager).

## 5. Variáveis de ambiente

No `.env` do backend (nunca no bundle do cliente):

```env
GOOGLE_OAUTH_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
GOOGLE_OAUTH_REDIRECT_URI=https://sync.atmail.app/auth/google/callback
```

No app (apenas valores públicos, prefixo `EXPO_PUBLIC_`):

```env
EXPO_PUBLIC_SYNC_API_URL=https://sync.atmail.app
```

Sem `EXPO_PUBLIC_SYNC_API_URL` o app sobe em **modo demo** (dados de `createSeedData`, sem
rede). É assim que a UI pode ser avaliada antes de qualquer credencial existir.

## 6. Contrato que o backend precisa implementar

O cliente já fala este contrato (`apps/app/src/adapters/sync-client.ts`):

```
POST /sync/gmail          { accountId, cursor?, limit? }
POST /sync/google-chat    { accountId, cursor?, limit? }
POST /sync/microsoft-graph{ accountId, cursor?, limit? }
POST /sync/imap           { accountId, cursor?, limit? }
→ 200 {
    "messages": [ RawMessageDto ],
    "cursor": "12345",
    "removedIds": ["msg-1"],
    "requiresReauth": false
  }
→ 401 { "error": "reauth_required" }   // o app marca a conta como reauth-required
```

`RawMessageDto` (campos mínimos): `id`, `accountId`, `contextId`, `channel`,
`participants[]`, `snippet`, `bodyText`, `receivedAt`, `isRead`. Opcionais:
`subject`, `providerThreadId`, `folder`, `attachments[]`, `spaceId`, `spaceName`,
`senderName`, `isDraft`, `labels[]`.

Regras de ouro do backend:

1. Validar `accountId` contra a sessão (nunca aceitar `accountId` de outro usuário).
2. Traduzir Gmail `messages.list` → agrupar por `threadId` → `providerThreadId`.
3. Cursor do Gmail é `historyId` (use `users.getProfile` para o inicial e `users.history.list`
   a partir dele). Se `historyId` estiver expirado (404), faça full resync e devolva novo cursor.
4. Salvar `last_sync_at` incremental e limitar `limit ≤ 100` para não estourar memória no mobile.

## 7. Tempo real (opcional, mas recomendado)

### Gmail

```bash
# 1) tópico
gcloud pubsub topics create gmail-push
# 2) permissão para o Gmail publicar
gcloud pubsub topics add-iam-policy-binding gmail-push \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher
# 3) assinatura push para o backend
gcloud pubsub subscriptions create gmail-push-sub \
  --topic=gmail-push \
  --push-endpoint=https://sync.atmail.app/hooks/gmail
```

Depois, no backend, chamar `users.watch` (renovar a cada 24h–7 dias):

```
POST https://gmail.googleapis.com/gmail/v1/users/me/watch
{ "topicName": "projects/at-mail-prod/topics/gmail-push",
  "labelIds": ["INBOX"], "labelFilterBehavior": "INCLUDE" }
```

### Google Chat

Use `spaces.messages.subscribe` ou o evento de app do Chat. Exige que o app do Chat esteja
configurado em `console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat`
(aba **Configuration**): nome, avatar, descrição, escopos e URL do endpoint de eventos.

## 8. Verificar se está tudo certo

```bash
# token de teste (após o consentimento)
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://gmail.googleapis.com/gmail/v1/users/me/profile" | jq '{emailAddress, messagesTotal}'

curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://chat.googleapis.com/v1/spaces?pageSize=5" | jq '.spaces[]?.displayName'
```

No app: `EXPO_PUBLIC_SYNC_API_URL` definido → ao abrir, `SyncEngine` roda e o rodapé da
sidebar mostra `tudo sincronizado` (ou `reautorização necessária`).

## 9. Cotas e limites

| Recurso | Limite padrão | Efeito no app |
| --- | --- | --- |
| Gmail `queries per minute per user` | 250 | `concurrency: 3` + cursor incremental mantém longe do teto |
| Gmail `messages.get` | 2.500 unidades/dia por usuário (Workspace) | não baixar corpo de mensagem em listagem |
| Chat API | 60 req/min por projeto | paginação de espaços no backend, cache de 5 min |
| Pub/Sub | 10 GB/mês grátis | suficiente para 1 usuário típico |

## 10. Problemas comuns

| Sintoma | Causa provável | Correção |
| --- | --- | --- |
| `403 access_denied` no login | conta não está em *Test users* | adicionar em OAuth consent screen |
| `invalid_grant` após ~7 dias | app em `Testing` expira refresh token | publicar o app (`In production`) |
| `403 insufficientPermissions` no Chat | conta `@gmail.com` | Chat exige Workspace |
| `redirect_uri_mismatch` | URI diferente (barra final, http/https, porta) | copiar exatamente do Console |
| `429 rateLimitExceeded` | varredura completa repetida | usar `historyId` e backoff exponencial |
| Chat vazio, e-mail ok | escopos de Chat não consentidos | reautorizar com `include_granted_scopes=true` |

## 11. Privacidade e conformidade

- O backend só persiste: `accountId`, `cursor`, `last_sync_at` e o refresh token cifrado
  (AES-GCM com chave em KMS). Corpo de mensagem não fica no servidor além do necessário para
  a resposta.
- Escopos declarados na tela de consentimento precisam bater com os usados no código — o
  Google audita isso na verificação.
- Para verificação com escopos restritos (Gmail/ Chat), prepare: vídeo do fluxo, justificativa
  por escopo, política de privacidade pública e domínio verificado. Enquanto não verificar,
  limite-se a `Internal` ou a *Test users*.
