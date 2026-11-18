# @mail — Google Cloud: login em produção

Projeto: **`at-mail-515112`** · Client ID: `77051752731-cp96clb7i04rk96asvdl0et37n00hnm3`

Este documento cobre o motivo de contas novas serem recusadas, o redirect HTTPS que
web/APK/desktop compartilham e as variáveis que o backend de sync precisa.

## 1. Por que só algumas contas entram

Enquanto a **Tela de consentimento OAuth** está em **Teste**, o Google só aceita as contas
listadas em *Usuários de teste*. Qualquer outra conta recebe `access_denied` — é exatamente o
"não permite novos cadastros que não estejam registrados no Google Cloud".

Publicar (não precisa de código):

1. <https://console.cloud.google.com/apis/credentials/consent?project=at-mail-515112>
2. **Tela de consentimento OAuth** → **Editar app**
3. Em *Tipo de usuário*, mantenha **Externo**; em *Status de publicação*, clique em
   **Publicar app** (Teste → Em produção).

### Escopos sensíveis/restritos

O app pede `gmail.modify`, `gmail.send` e os escopos de Chat — classificados pelo Google como
**restritos/sensíveis**. Em produção:

- contas de fora da organização veem o aviso "app não verificado" até a verificação concluir;
- a verificação de escopos restritos exige revisão do Google (e, para `gmail.*`, a avaliação
  CASA). Sem verificacao, o app fica publicado com limite de **100 usuários novos**;
- para uso interno/pessoal, a alternativa é manter a tela em **Teste** e cadastrar os e-mails
  em *Usuários de teste* (limite de 100).

Passo a passo de verificação: *Tela de consentimento OAuth → Verificação do app*.

## 2. Redirect URI (o que quebrava no APK e no desktop)

O Google **não aceita** `atmail://auth/google/callback` em clients do tipo *Web application*,
e a WebView do desktop/APK não recebe deep links por padrão. O fluxo agora é:

1. o app chama `POST /auth/google/start`; o backend cria um `state` de uso único (TTL de 10
   minutos, limitado por IP) e devolve ao app;
2. o app abre o Google com `redirect_uri = <SYNC_API_URL>/auth/google/callback` e esse `state`;
3. o backend só aceita o callback de um `state` que ele mesmo registrou — qualquer outro
   recebe 400, então a rota pública não grava nada arbitrário — e mostra "Login concluído";
4. o app consulta `GET /auth/google/code?state=…` até receber o `code` e então troca por uma
   sessão em `POST /auth/google/exchange` (PKCE, `code_verifier` no app).

Cadastre em **Credenciais → OAuth 2.0 Client IDs → (client Web) → URIs de redirecionamento
autorizados**:

```
https://at-mail-sync-legacy.vercel.app/auth/google/callback
http://localhost:8790/auth/google/callback
```

A primeira é produção; a segunda é o `npm run sync` local. O mesmo valor precisa estar em
`GOOGLE_OAUTH_REDIRECT_URI` do backend (ver abaixo).

## 3. Backend de sync (Vercel)

Variáveis do projeto `at-mail-sync-legacy` (Vercel → Settings → Environment Variables):

| Variável | Valor |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | Client ID acima |
| `GOOGLE_OAUTH_CLIENT_SECRET` | segredo do mesmo client Web |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://at-mail-sync-legacy.vercel.app/auth/google/callback` |
| `TOKEN_ENCRYPTION_KEY` | 32 bytes em base64 (`openssl rand -base64 32`) |
| `SESSION_SECRET` | string aleatória longa |
| `DATABASE_URL` | Postgres (o schema é criado no boot) |
| `PUBLIC_ORIGIN` | origem do app web, usada no CORS |

A tabela `atmail_oauth_pending` é criada automaticamente por `openDb`; não há migração manual.

## 4. Origens que o cliente usa

`apps/app/src/config.ts`:

- `EXPO_PUBLIC_SYNC_API_URL` → padrão `https://at-mail-sync-legacy.vercel.app`
- `EXPO_PUBLIC_GOOGLE_CLIENT_ID` → padrão o Client ID acima

Para builds locais, defina ambos antes de `npm run web` / `expo prebuild`.

## 5. Checklist de teste (uma conta nunca usada no app)

1. Publicar a tela de consentimento (passo 1).
2. Abrir o app **web** e clicar em *Continuar com Google*: consentimento no navegador →
   página "Login concluído" → lista carregando.
3. Repetir no **APK**: o botão abre o navegador do sistema (não uma WebView) e o app volta
   sozinho ao concluir.
4. Repetir no **.deb**: o botão abre o navegador padrão do Linux (plugin `opener`).
5. Se aparecer `access_denied`, a conta ainda não está liberada: revise *Usuários de teste* ou
   o status de publicação.
