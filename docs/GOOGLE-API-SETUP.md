# @mail — Conectar contas Google (Gmail + Chat), do zero

Projeto Google Cloud já existente: **`at-mail-515112`**.
Este guia assume que você está logado no Console com a conta **dona** desse projeto.

---

## 0. Antes de tudo: onde cada coisa acontece

O erro mais comum é achar que tudo se resolve dentro do app. Não resolve. Existem **três
lugares** e cada passo pertence a um deles:

| Lugar | O que é | Para que serve aqui |
| --- | --- | --- |
| 🌐 **Navegador** | <https://console.cloud.google.com> logado na conta dona do projeto | ativar APIs, configurar consentimento, criar credenciais |
| ☁️ **Cloud Shell** | botão `>_` no topo do Console — abre um terminal **já autenticado** no projeto | rodar comandos `gcloud` (Pub/Sub, permissões) sem instalar nada |
| 🖥️ **Seu terminal** | o terminal do seu Ubuntu, na pasta `~/at-mail` | instalar dependências, rodar o app, gerar SHA-1, testar com `curl` |

> Ainda **não existe um servidor** de sincronização neste repositório. Enquanto ele não existir,
> o app roda em **modo demo**. O passo 4 explica exatamente onde cada valor vai e o passo 5
> mostra como reconhecer os dois modos. Ver também a seção [9](#9-o-que-ainda-não-existe-e-por-quê).

Comandos `gcloud` abaixo podem rodar **no Cloud Shell** (recomendado) ou no seu terminal se você
instalar o CLI (`sudo snap install google-cloud-cli --classic`, depois `gcloud auth login`).
Em qualquer caso, fixe o projeto:

```bash
gcloud config set project at-mail-515112
```

---

## 1. Ativar as APIs

🌐 **No navegador**, abra cada link e clique em **Ativar / Enable** (o `?project=` já seleciona o
projeto certo):

| API | Link |
| --- | --- |
| Gmail | <https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=at-mail-515112> |
| Google Chat | <https://console.cloud.google.com/apis/library/chat.googleapis.com?project=at-mail-515112> |
| People | <https://console.cloud.google.com/apis/library/people.googleapis.com?project=at-mail-515112> |
| Pub/Sub (opcional, tempo real) | <https://console.cloud.google.com/apis/library/pubsub.googleapis.com?project=at-mail-515112> |

☁️ **Ou no Cloud Shell**, um comando só:

```bash
gcloud services enable \
  gmail.googleapis.com \
  chat.googleapis.com \
  people.googleapis.com \
  pubsub.googleapis.com \
  --project at-mail-515112
```

Conferir depois (mostra a lista do que está habilitado):

```bash
gcloud services list --enabled --project at-mail-515112 | grep -E 'gmail|chat|people|pubsub'
```

⚠️ **Google Chat só funciona em conta Google Workspace** (domínio corporativo/educacional).
Se a conta que vai testar é `@gmail.com`, o Gmail funciona e o Chat retorna 403 — é limite do
Google, não bug do app.

---

## 2. Tela de consentimento OAuth

🌐 <https://console.cloud.google.com/apis/credentials/consent?project=at-mail-515112>

Preencha nesta ordem (a tela só libera a próxima etapa depois da anterior):

1. **Tipo de usuário** — `Interno` se o app é só para o seu Workspace; `Externo` para qualquer
   conta Google. Com `Externo` + app em `Testing`, o refresh token expira em ~7 dias.
2. **Informações do app**
   - Nome: `@mail`
   - E-mail de suporte: o seu
   - Domínio autorizado: pode deixar vazio em dev
   - Logo: opcional
3. **Escopos** → **Adicionar ou remover escopos** → cole a lista e marque cada um:

   ```
   openid
   .../auth/userinfo.email
   .../auth/userinfo.profile
   https://www.googleapis.com/auth/gmail.modify
   https://www.googleapis.com/auth/chat.messages.readonly
   https://www.googleapis.com/auth/chat.spaces.readonly
   ```

   `gmail.modify` = ler, arquivar e marcar como lido. **Não** inclui enviar.
   Para enviar e-mail adicione depois `https://www.googleapis.com/auth/gmail.send`
   (consentimento incremental, sem refazer tudo).
4. **Usuários de teste** (só para `Externo` + `Testing`): adicione **exatamente** a conta que vai
   fazer login. Sem isso o login morre com `Error 403: access_denied`.
5. **Resumo** → salvar.

---

## 3. Criar as credenciais

🌐 <https://console.cloud.google.com/apis/credentials?project=at-mail-515112> →
**Criar credenciais → ID do cliente OAuth**

Crie **um cliente por plataforma**. Você não precisa de todos no primeiro dia — comece pelo Web,
que é o que roda no seu Ubuntu.

### 3.1 Web (comece por aqui)

- Tipo: **Aplicativo da Web**
- Nome: `@mail web`
- **Origens JavaScript autorizadas**:
  - `http://localhost:8081`
- **URIs de redirecionamento autorizados**:
  - `http://localhost:8081/auth/google/callback`

Ao salvar, o Console mostra **Client ID** e **Client Secret**. Copie e feche — o secret também
pode ser baixado depois em “Baixar JSON”.

### 3.2 iOS (quando for rodar no simulador/iPhone)

- Tipo: **iOS**
- ID do pacote: `app.atmail.client` (igual ao `app.json` → `ios.bundleIdentifier`)

### 3.3 Android

- Tipo: **Android**
- Nome do pacote: `app.atmail.client`
- SHA-1 do keystore de debug — 🖥️ **no seu terminal**:

  ```bash
  keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android \
    | grep -i SHA1
  ```

  Cole o valor no Console. Sem esse SHA-1 o login Android falha com `10: DEVELOPER_ERROR`.

### 3.4 Desktop (Windows/macOS/Linux)

- Tipo: **App para computador**
- O app abre uma porta local (`http://127.0.0.1:<porta>`) para receber o código. O Google aceita
  qualquer porta nesse esquema; não precisa cadastrar a porta.

---

## 4. Onde colar os valores

Existem **dois** lugares, e confundir os dois é o que faz o app “não conectar”:

| Valor | Para onde vai | Quem lê | Pode ir para o repositório? |
| --- | --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | `.env` do **backend** | servidor de sincronização | não |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `.env` do **backend** | servidor de sincronização | **nunca** |
| `EXPO_PUBLIC_SYNC_API_URL` | `.env` da **raiz** | app (Expo/Tauri) | sim, é público |
| `FIGMA_ACCESS_TOKEN` | `.env` da raiz | script de tokens | não |

🖥️ **No seu terminal**, na raiz do projeto:

```bash
cd ~/at-mail
cp .env.example .env
chmod 600 .env
```

Edite `~/at-mail/.env` e deixe assim (troque pelos valores reais do Console):

```env
GOOGLE_OAUTH_CLIENT_ID=1234567890-xxxxxxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxx
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8081/auth/google/callback

# só preencha quando o backend existir; sem esta linha o app sobe em modo demo
# EXPO_PUBLIC_SYNC_API_URL=http://localhost:8790
```

> `EXPO_PUBLIC_*` é embutido no bundle e **vira público**. Nunca coloque secret com esse prefixo.
> O app **não** usa `GOOGLE_OAUTH_CLIENT_SECRET` — quem usa é o backend.

---

## 5. Rodar e saber em qual modo você está

🖥️ **No seu terminal**:

```bash
cd ~/at-mail
npm install
npm run web          # abre http://localhost:8081
```

Como interpretar o resultado:

| Rodapé da sidebar | Significado |
| --- | --- |
| `tudo sincronizado` + dados de exemplo | **modo demo** — `EXPO_PUBLIC_SYNC_API_URL` ausente, nada foi à rede |
| `sincronizando N contas` | modo real, `SyncEngine` rodando |
| `reautorização necessária` | o backend respondeu `401 reauth_required` — token expirado/revogado |
| `adaptador não registrado` | modo real ligado, mas o backend não respondeu nas rotas `/sync/*` |

O modo demo é intencional: permite avaliar contextos, caixa unificada e atalhos **antes** de
qualquer credencial existir.

---

## 6. Testar as credenciais sem escrever backend

O caminho mais rápido para provar que o Client ID/Secret e os escopos estão certos:

1. Abra o **OAuth 2.0 Playground**: <https://developers.google.com/oauthplayground>
2. Engrenagem (⚙) no canto superior direito → marque **Use your own OAuth credentials** →
   cole **Client ID** e **Client Secret** → feche.
3. Na lista de escopos, adicione e marque:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/chat.spaces.readonly`
4. **Authorize APIs** → faça login com a conta de teste → **Exchange authorization code for tokens**.
5. Copie o **Access token** e rode no seu terminal:

   ```bash
   ACCESS_TOKEN='cole_aqui_o_access_token'

   curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
     "https://gmail.googleapis.com/gmail/v1/users/me/profile" \
     | grep -E 'emailAddress|messagesTotal'
   ```

   Esperado: seu e-mail e a contagem de mensagens.

   ```bash
   curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
     "https://chat.googleapis.com/v1/spaces?pageSize=5" \
     | grep -o '"displayName": *"[^"]*"'
   ```

   Esperado: nomes de espaços. Se vier `403`, é conta sem Workspace (ver seção 1).

Se os dois `curl` funcionaram, **o Google está configurado**. O que falta é só o backend que troca
esse código por token e serve `/sync/*`.

---

## 7. Tempo real com Pub/Sub (opcional)

Só faz sentido depois do backend. ☁️ **No Cloud Shell**:

```bash
# tópico
gcloud pubsub topics create gmail-push --project at-mail-515112

# o Gmail precisa de permissão para publicar
gcloud pubsub topics add-iam-policy-binding gmail-push \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher \
  --project at-mail-515112

# assinatura que entrega no backend (troque pela URL real quando existir)
gcloud pubsub subscriptions create gmail-push-sub \
  --topic=gmail-push \
  --push-endpoint=https://SEU-BACKEND/hooks/gmail \
  --project at-mail-515112
```

Depois, no backend, chamar `users.watch` com o tópico
`projects/at-mail-515112/topics/gmail-push` e renovar antes de 7 dias
(o Google encerra o watch automaticamente).

No Google Chat: configure o app em
<https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat?project=at-mail-515112>
(aba **Configuration**: nome, avatar, escopos, URL de eventos).

---

## 8. Cotas

| Recurso | Limite padrão | Impacto no app |
| --- | --- | --- |
| Gmail `queries per minute per user` | 250 | sync incremental + `concurrency: 3` mantém longe |
| Gmail `messages.get` | 2.500 unidades/dia/usuário (Workspace) | não baixar corpo na listagem |
| Chat API | 60 req/min por projeto | cache de espaços no backend |
| Pub/Sub | 10 GB/mês grátis | suficiente para uso pessoal |

---

## 9. O que ainda não existe (e por quê)

O repositório tem **cliente**, não servidor. Por isso o botão “conectar conta” ainda não aparece
na interface: falta o serviço que faz a troca de código por token e chama o Google.

O contrato já está pronto em `apps/app/src/adapters/sync-client.ts`:

```
POST /sync/gmail          { accountId, cursor?, limit? }
POST /sync/google-chat    { accountId, cursor?, limit? }
→ 200 { messages: [...], cursor: "...", removedIds: [], requiresReauth: false }
→ 401 { error: "reauth_required" }
```

O que esse serviço precisa fazer, na ordem:

1. `GET /auth/google/start` → monta a URL de consentimento com PKCE e `state`.
2. `GET /auth/google/callback` → troca `code` por `access_token` + `refresh_token`, guarda o
   refresh **cifrado** e emite um cookie `HttpOnly` de sessão.
3. `POST /sync/gmail` → `users.getProfile` → `messages.list` → `messages.get` → traduz para
   `RawMessageDto` → devolve `cursor = historyId`.
4. `POST /sync/google-chat` → `spaces.list` + `spaces.messages.list` → mesmo DTO.

Enquanto isso não é implementado, a única forma de validar credenciais é a seção 6.

---

## 10. Checklist

- [ ] As 3–4 APIs aparecem como habilitadas em `gcloud services list --enabled`
- [ ] Tela de consentimento salva, com os escopos listados
- [ ] Sua conta está em **Usuários de teste** (se o app está em `Testing`)
- [ ] Cliente OAuth **Web** criado com `http://localhost:8081` em origens **e** em redirect
- [ ] Client ID/Secret colados no `.env` da raiz (sem `EXPO_PUBLIC_`)
- [ ] `curl` do Gmail retornou seu e-mail
- [ ] `curl` do Chat retornou espaços (ou 403 por conta `@gmail.com` — esperado)
- [ ] Rodapé da sidebar dizendo `tudo sincronizado`/`sincronizando` (modo real)

---

## 11. Erros comuns

| Sintoma exato | Onde olhar | Causa |
| --- | --- | --- |
| `Error 403: access_denied` na tela do Google | Console → Tela de consentimento → Usuários de teste | conta não autorizada |
| `invalid_grant` depois de ~7 dias | logs do backend | app em `Testing` expira refresh token → publicar o app |
| `redirect_uri_mismatch` | Console → Credenciais → seu cliente | URI diferente (barra final, `https` vs `http`, porta) |
| `403 insufficientPermissions` no Chat | API Chat | conta `@gmail.com` (Chat exige Workspace) |
| `10: DEVELOPER_ERROR` no Android | Console → cliente Android | SHA-1 ou package name diferente do build |
| `429 rateLimitExceeded` | logs do backend | varredura completa repetida; usar `historyId` + backoff |
| App mostra `adaptador não registrado` | terminal do backend | `EXPO_PUBLIC_SYNC_API_URL` aponta para algo que não responde |
| App mostra dados de exemplo | `~/at-mail/.env` | `EXPO_PUBLIC_SYNC_API_URL` comentado (modo demo) |

---

## 12. Privacidade

- O backend persiste o mínimo: `accountId`, `cursor`, `last_sync_at` e o refresh token cifrado.
- Corpo de mensagem não fica no servidor além do necessário para responder ao sync.
- Escopos declarados no consentimento precisam bater com os usados no código — o Google audita
  isso na verificação.
- Para sair de `Testing`: publique o app, publique política de privacidade e domínio verificado.
  Escopos restritos (Gmail/Chat) exigem vídeo do fluxo e justificativa por escopo.
