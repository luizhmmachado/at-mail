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

### De onde vem cada valor (resumo)

| Variável | Origem | Onde colar |
| --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | Console → **Google Auth Platform → Clientes** (criado no passo 3, aparece no modal “Cliente OAuth criado”) | `.env` na raiz de `~/at-mail` |
| `GOOGLE_OAUTH_CLIENT_SECRET` | mesmo lugar — campo **Segredo do cliente** / botão **Baixar JSON** | `.env` na raiz de `~/at-mail` |
| `EXPO_PUBLIC_SYNC_API_URL` | **não vem do Google.** É a URL do *seu* serviço de sincronização, que ainda não existe | `.env` na raiz (deixe comentado = modo demo) |

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
   fazer login — passo a passo na seção [2.1](#21-usuários-de-teste-onde-exatamente). Sem isso o
   login morre com `Error 403: access_denied`.
5. **Resumo** → salvar.

### 2.1 Usuários de teste: onde exatamente

> Só existe lista de teste quando o app está em **Testing / Teste**. Se ele estiver em
> **In production / Em produção**, não há lista: qualquer conta Google pode autorizar (sujeito à
> verificação dos escopos restritos).

**Interface nova (Google Auth Platform — a que aparece em 2025/2026):**

1. Abra: <https://console.cloud.google.com/auth/audience?project=at-mail-515112>
2. No topo, confirme o status **Teste / Testing**.
3. Role até o bloco **Usuários de teste / Test users**.
4. Clique em **+ Adicionar usuários / Add users**.
5. Digite o **e-mail completo Google** que fará login na tela de consentimento, ex.:
   `ana.trabalho@empresa.com`. Aperte **Enter** para virar uma “chip” antes de salvar.
   - Não precisa ser do mesmo domínio do projeto, mas **precisa existir** como conta Google.
   - Para testar **Chat**, use uma conta **Workspace** (domínio corporativo/educacional).
   - Para testar o **Gmail pessoal**, adicione também a conta `@gmail.com` — pode ter as duas na
     lista (limite: 100 usuários).
6. Clique em **Salvar / Save**. A lista atualiza na hora; não há etapa de aprovação.

**Interface antiga (Tela de consentimento OAuth):**

1. <https://console.cloud.google.com/apis/credentials/consent?project=at-mail-515112>
2. Seção **Usuários de teste** → **+ ADD USERS** → digite o e-mail → **SAVE**.

**Como saber que pegou:** abra a URL de consentimento em uma janela anônima, escolha a conta de
teste e conclua. Se aparecer `Error 403: access_denied`, o e-mail digitado não bateu com a conta
usada no login (ou o app está em `Testing` e a conta não está na lista).

> ⚠️ Testar Chat exige **duas** coisas: a conta na lista de teste **e** o app do Chat configurado
> em <https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat?project=at-mail-515112>
> (seção 7). Só a lista de teste não faz `spaces.list` retornar espaços.

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

Ao salvar, o Console abre o modal **“Cliente OAuth criado”** com Client ID e Client Secret —
é a única vez que o segredo aparece completo. Detalhes de onde encontrar depois: seção
[3.5](#35-onde-aparecem-o-client-id-e-o-client-secret).

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

### 3.5 Onde aparecem o Client ID e o Client Secret

**No momento da criação** — ao clicar em **Criar / Create**, o Google abre um modal
**“Cliente OAuth criado / OAuth client created”** com:

```
ID do cliente:      1234567890-abc123def456.apps.googleusercontent.com   ← GOOGLE_OAUTH_CLIENT_ID
Segredo do cliente: GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx                     ← GOOGLE_OAUTH_CLIENT_SECRET
```

- Botão **Baixar JSON** → salva `client_secret_....apps.googleusercontent.com.json` com os dois
  valores. Guarde fora do repositório (ex.: `~/.config/at-mail/`).
- Botão **Copiar** ao lado de cada campo.
- O segredo **só é exibido integralmente nesse modal**. Se você fechar sem copiar, não tem como
  “ver de novo” — só gerar outro (abaixo).

**Depois, para consultar novamente:**

1. <https://console.cloud.google.com/auth/clients?project=at-mail-515112>
   *(interface antiga: <https://console.cloud.google.com/apis/credentials?project=at-mail-515112>)*
2. Clique no **nome** do cliente (ex.: `@mail web`).
3. **ID do cliente** aparece no topo da página — é público, pode ir para o app.
4. **Segredo do cliente / Client secrets** → lista de segredos. O valor antigo não é reexibido: use
   **Adicionar segredo / Add secret** para gerar um novo (o antigo continua válido até ser
   excluído — exclua depois de migrar) ou **Baixar JSON** para obter o par completo.

**Quem tem segredo:**

| Tipo de cliente | Client ID | Client Secret |
| --- | --- | --- |
| Web | sim | **sim** — obrigatório (fluxo com backend) |
| Desktop | sim | sim, mas não é confidencial (app instalado) |
| iOS | sim | **não existe** |
| Android | sim | **não existe** |

---

## 4. Onde colar os valores

Existem **dois** lugares, e confundir os dois é o que faz o app “não conectar”:

| Valor | De onde vem | Para onde vai | Quem lê | Vai para o git? |
| --- | --- | --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | seção 3.5 (modal “Cliente OAuth criado”) | `.env` da raiz | backend de sync | não (mas é público) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | seção 3.5, mesmo modal | `.env` da raiz | backend de sync | **nunca** |
| `EXPO_PUBLIC_SYNC_API_URL` | **você define** — não vem do Google | `.env` da raiz | app Expo/Tauri | sim, é público |
| `FIGMA_ACCESS_TOKEN` | Figma → Settings → Security | `.env` da raiz | script de tokens | não |

### 4.1 `GOOGLE_OAUTH_CLIENT_ID`

1. Copie do modal da seção 3.5 (ou da página do cliente, campo **ID do cliente**).
2. Formato: termina em **`.apps.googleusercontent.com`**. Se não termina assim, você copiou outra
   coisa (ex.: o *número* do projeto, `at-mail-515112` — esse **não** serve).
3. Cole em `~/at-mail/.env`:

   ```env
   GOOGLE_OAUTH_CLIENT_ID=1234567890-abc123def456.apps.googleusercontent.com
   ```

### 4.2 `GOOGLE_OAUTH_CLIENT_SECRET`

1. Copie do mesmo modal / da seção **Segredo do cliente**.
2. Formato: começa com **`GOCSPX-`**.
3. Cole na linha seguinte do `.env`:

   ```env
   GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx
   ```

4. **Nunca** com prefixo `EXPO_PUBLIC_`. Esse prefixo é embutido no bundle JavaScript e qualquer
   pessoa com o app instalado lê o valor. O app não usa esse segredo: quem usa é o backend.

### 4.3 `EXPO_PUBLIC_SYNC_API_URL`

**Este valor não existe no Console do Google.** Ele é a URL do *seu* serviço de sincronização —
o programa que recebe `/sync/gmail` e `/sync/google-chat` (seção 9). Você só tem um valor para
colocar aqui depois de subir esse serviço. Três estados possíveis:

| Situação | Valor no `.env` | O que acontece no app |
| --- | --- | --- |
| Serviço ainda não existe (hoje) | `# EXPO_PUBLIC_SYNC_API_URL=...` comentado, ou linha ausente | modo demo, dados de exemplo, nenhuma chamada de rede |
| Serviço rodando na sua máquina | `EXPO_PUBLIC_SYNC_API_URL=http://localhost:8790` | o app chama o serviço local; precisa reiniciar o `npm run web` |
| Serviço publicado | `EXPO_PUBLIC_SYNC_API_URL=https://sync.seudominio.app` | produção; `https` obrigatório fora de localhost |

**Regra de host — o `localhost` não é o mesmo para todo mundo:**

| Onde o app roda | URL correta |
| --- | --- |
| navegador no seu Ubuntu | `http://localhost:8790` |
| simulador iOS (Xcode) | `http://localhost:8790` |
| emulador Android | `http://10.0.2.2:8790` (o `10.0.2.2` é o “seu PC” visto de dentro do emulador) |
| celular físico no Wi-Fi | `http://192.168.x.y:8790` — descubra o IP com `hostname -I` 🖥️ e suba o serviço em `0.0.0.0` |
| desktop Tauri | `http://localhost:8790` |

**Como validar que a URL está certa** (antes mesmo de o app usar):

```bash
curl -i -X POST http://localhost:8790/sync/gmail \
  -H 'content-type: application/json' -d '{"accountId":"teste"}'
```

- `401`/`400` com corpo JSON → serviço existe e está respondendo. ✅
- `Connection refused` → nada escutando nessa porta: é exatamente o estado de hoje, por isso a
  linha fica **comentada** no `.env`.

> `EXPO_PUBLIC_*` é lido na hora do bundle. Depois de mudar o `.env`, pare o `npm run web`
> (`Ctrl+C`) e suba de novo — hot reload não recarrega variáveis de ambiente.

### 4.4 Montando o `.env`

🖥️ **No seu terminal**, na raiz do projeto:

```bash
cd ~/at-mail
cp .env.example .env
chmod 600 .env
```

Resultado esperado (valores reais do seu Console):

```env
GOOGLE_CLOUD_PROJECT=at-mail-515112
GOOGLE_OAUTH_CLIENT_ID=1234567890-abc123def456.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8081/auth/google/callback

# comentado = modo demo; descomente quando o serviço de sync existir
# EXPO_PUBLIC_SYNC_API_URL=http://localhost:8790
```

Conferir o que foi gravado sem expor o segredo:

```bash
grep -E '^(GOOGLE_OAUTH_CLIENT_ID|EXPO_PUBLIC_SYNC_API_URL)=' .env   # mostra id e url
grep -c '^GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-' .env                  # deve imprimir 1
git status --short .env                                             # deve não listar nada
```

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
- [ ] Sua conta está em **Usuários de teste** (seção 2.1) — status do app em `Testing`
- [ ] Cliente OAuth **Web** criado com `http://localhost:8081` em origens **e** em redirect
- [ ] `GOOGLE_OAUTH_CLIENT_ID` copiado do modal e terminando em `.apps.googleusercontent.com`
- [ ] `GOOGLE_OAUTH_CLIENT_SECRET` começando com `GOCSPX-`, **sem** prefixo `EXPO_PUBLIC_`
- [ ] `grep -c '^GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-' .env` imprime `1`
- [ ] `EXPO_PUBLIC_SYNC_API_URL` comentado (modo demo) **ou** respondendo segundo a seção 4.3
- [ ] `curl` do Gmail retornou seu e-mail
- [ ] `curl` do Chat retornou espaços (ou 403 por conta `@gmail.com` — esperado)
- [ ] Rodapé da sidebar dizendo `tudo sincronizado`/`sincronizando` (modo real)

---

## 11. Erros comuns

| Sintoma exato | Onde olhar | Causa |
| --- | --- | --- |
| `Error 403: access_denied` na tela do Google | Console → Tela de consentimento → Usuários de teste | conta não autorizada |
| `invalid_grant` depois de ~7 dias | logs do backend | app em `Testing` expira refresh token → publicar o app |
| `invalid_client` no Playground ou em `/auth/google/callback` | Console → Credenciais → cliente | Client Secret errado/revogado, ou ID de outro projeto → gerar novo segredo (3.5) |
| `Connection refused` no app ao abrir | `~/at-mail/.env` | `EXPO_PUBLIC_SYNC_API_URL` aponta para um serviço que não está rodando → comente a linha (modo demo) |
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
