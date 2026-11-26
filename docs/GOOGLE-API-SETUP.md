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

Publicar não remove o aviso de app não verificado. Em produção, contas fora da lista de
teste podem tentar autorizar o app, mas escopos confidenciais/restritos não aprovados
continuam exibindo o aviso e sujeitos ao limite vitalício de 100 usuários do projeto.
Para remover o aviso, verifique e publique a marca e conclua a análise de acesso a dados.
Isso exige que a lista de escopos do Google Cloud corresponda aos escopos realmente
solicitados pelos clientes OAuth, justificativas para cada escopo confidencial/restrito
e um vídeo do YouTube demonstrando o uso dos escopos em todos os clientes OAuth do projeto.
O domínio usado no branding também precisa ser verificado no Google Search Console.

### Escopos sensíveis/restritos

O app pede `gmail.modify` e `chat.messages.readonly` (restritos), além de
`chat.messages.create`, `chat.messages.reactions`, `chat.users.readstate`,
`chat.spaces.create` e `chat.spaces.readonly`.
`gmail.modify` já permite ler, editar e enviar e-mails, então não é necessário pedir
`gmail.send` também. Em produção:

- contas de fora da organização veem o aviso "app não verificado" até a verificação concluir;
- os escopos restritos exigem análise do Google; como o servidor processa esses dados,
  também pode ser necessária uma avaliação de segurança independente (CASA);
- sem verificação, o limite é de **100 usuários no total durante a vida do projeto**, não
  apenas novos usuários;
- para uso interno/pessoal, a alternativa é manter a tela em **Teste** e cadastrar os e-mails
  em *Usuários de teste* (limite de 100).

Inicie em *Tela de consentimento OAuth → Central de verificação*. O envio fica disponível
depois que a marca estiver verificada/publicada e os dados de escopo, justificativas e vídeo
estiverem preenchidos. A aprovação final depende da análise do Google.

## 2. Redirect URI (o que quebrava no APK e no desktop)

O Google **não aceita** `atmail://auth/google/callback` em clients do tipo *Web application*,
e a WebView do desktop/APK não recebe deep links por padrão. O fluxo agora é:

1. o app chama `POST /auth/google/start`; o backend cria um `state` de uso único (TTL de 10
   minutos, limitado por IP) e devolve ao app;
2. o app abre o Google com `redirect_uri = <SYNC_API_URL>/auth/google/callback` e esse `state`;
3. o backend só aceita o callback de um `state` que ele mesmo registrou — qualquer outro
   recebe 400, então a rota pública não grava nada arbitrário — e mostra "Login concluído";
4. o app consulta `POST /auth/google/code` com o `state` até receber o `code` e então troca por uma
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
| `DATABASE_URL` | Postgres (o schema é criado no boot) |
| `PUBLIC_ORIGINS` | origens permitidas pelo CORS, separadas por vírgula (ex.: `https://at-mail.vercel.app,http://tauri.localhost,tauri://localhost`) |

A tabela `atmail_oauth_pending` é criada automaticamente por `openDb`; não há migração manual.

## 4. Escopos e recursos

O app solicita `gmail.modify` para exibir, organizar e enviar mensagens; `chat.messages.readonly`
e `chat.spaces.readonly` para ler o Google Chat; `chat.messages.create` e `chat.spaces.create`
para criar conversas e enviar mensagens; `chat.messages.reactions` para adicionar e remover
reações; e `chat.users.readstate` para sincronizar a leitura. Contas já conectadas precisam
ser adicionadas novamente para conceder novos escopos. O compositor de e-mail e Chat aceita
até 10 arquivos, com 3 MB no total.

## 5. Origens que o cliente usa

`apps/app/src/config.ts`:

- `EXPO_PUBLIC_SYNC_API_URL` → padrão `https://at-mail-sync-legacy.vercel.app`
- `EXPO_PUBLIC_GOOGLE_CLIENT_ID` → padrão o Client ID acima

Para builds locais, defina ambos antes de `npm run web` / `expo prebuild`.

## 6. Notificações push mobile

O APK registra um token Expo autenticado em `/accounts/push-token`. O worker `/api/push/cron`
consulta Gmail e Google Chat a cada cinco minutos, deduplica mensagens por usuário/conta e
envia o push pelo Expo Push Service.

Para produzir um APK apto a receber push com o app fechado:

1. configure um app Android no Firebase com o pacote `app.atmail.client`;
2. salve `google-services.json` em `apps/app/google-services.json`;
3. envie a chave FCM v1 ao projeto Expo EAS `ae3fd8e1-4744-4fcf-8623-a1a63cb6646d`;
4. configure `CRON_SECRET` na Vercel e `PUSH_CRON_SECRET` no GitHub com o mesmo valor;
5. instale um APK novo e conceda a permissão de notificações.

Os arquivos `google-services.json` e `GoogleService-Info.plist` estão ignorados pelo Git.
Nunca publique chaves privadas ou arquivos de conta de serviço no repositório.

## 7. Checklist de teste (uma conta nunca usada no app)

1. Publicar a tela de consentimento (passo 1).
2. Abrir o app **web** e clicar em *Continuar com Google*: consentimento no navegador →
   página "Login concluído" → lista carregando.
3. Repetir no **APK**: o botão abre o navegador do sistema (não uma WebView) e o app volta
   sozinho ao concluir.
4. Repetir no **.deb**: o botão abre o navegador padrão do Linux (plugin `opener`).
5. Se aparecer `access_denied`, a conta ainda não está liberada: revise *Usuários de teste* ou
   o status de publicação.
