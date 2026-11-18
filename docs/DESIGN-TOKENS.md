# @mail — Design tokens (Figma → código)

## Princípio

Existe **uma** fonte de verdade visual: `packages/core/src/theme/figma.tokens.json`.
Nenhum componente pode conter valor literal de cor, espaçamento, raio ou tamanho de fonte.
O caminho é sempre:

```
Figma  ──(scripts/figma-sync-tokens.mjs)──►  figma.tokens.json
                                                   │
                                    packages/core/src/theme/tokens.ts
                                                   │
                                     packages/ui (useTheme())
```

## Estado atual: `provisional`

`figma.tokens.json` está com `meta.status: "provisional"` — valores neutros usados apenas para
o app rodar antes da extração. **Não são o design final.** O script sobrescreve os valores com
o que existe no Figma, sem inventar nada, e marca `status: "extracted"`.

## Como me passar a chave do Figma (passo a passo seguro)

Não cole a chave no chat: mensagens ficam em histórico/transcript. O caminho correto é um
arquivo local ignorado pelo git.

1. **Gerar o token** no Figma: `Settings → Security → Personal access tokens → Generate new token`.
   Escopos necessários:
   - `file_content:read` — ler frames, tipografia, espaçamentos e raios;
   - `file_variables:read` — ler as variáveis de cor (Light/Dark). *Exige plano
     Enterprise/Organization; se falhar, o script extrai só da árvore e avisa.*
2. **Gravar em arquivo com permissão restrita** (escolha **uma** opção):

   ```bash
   # opção A — dentro do repositório (já ignorado pelo .gitignore)
   cd ~/at-mail
   printf 'FIGMA_ACCESS_TOKEN=figd_SEU_TOKEN\nFIGMA_FILE_KEY=qqjxZUMeAj95mXV7wYtTEw\nFIGMA_NODE_ID=0-1\n' > .env
   chmod 600 .env

   # opção B — fora do repositório, one-shot no shell
   read -s FIGMA_ACCESS_TOKEN && export FIGMA_ACCESS_TOKEN
   ```

3. **Sincronizar**:

   ```bash
   npm run tokens:sync
   ```

4. **Conferir** se extraiu algo real:

   ```bash
   jq '.meta' packages/core/src/theme/figma.tokens.json
   # status deve virar "extracted"
   ```

5. **Revogar** o token no Figma depois da extração (`... → Revoke`). Ele não é necessário em
   runtime — só para gerar tokens.

> Prefere não usar chave pessoal? Alternativa: exporte o frame como **Figma → Export →
> "Copy as JSON"** (plugin "Figma to JSON") e me entregue o arquivo; o mapeamento manual
> continua igual.

## O que o script extrai

| Origem no Figma | Destino no token | Método |
| --- | --- | --- |
| Variáveis de cor (Light/Dark) | `color.<papel>.light` / `.dark` | `/v1/files/:key/variables/local`, casando nome normalizado com o papel (`color/surface-hover` → `surfaceHover`) |
| `fontSize` das camadas de texto | `typography.size.*` | distribuição dos tamanhos observados na escala |
| `itemSpacing` + paddings de auto-layout | `space.*` | valores ordenados e distribuídos |
| `cornerRadius` / raios por canto | `radius.sm/md/lg/xl` | valores ordenados |
| Larguras de frame | relatório `figma.raw.json` | auditoria (não altera layout automaticamente) |

Papéis de cor esperados (nomes canônicos, use estes nas variáveis do Figma para mapeamento
direto):

```
canvas · surface · surfaceHover · surfaceSelected · surfaceSunken
borderSubtle · borderStrong
textPrimary · textSecondary · textTertiary · textInverted
accent · accentMuted · accentText · focusRing
contextWork · contextStudies · contextPersonal · contextCustom
channelEmail · channelChat
danger · warning · success · unreadDot
```

Se o Figma usar outros nomes (ex.: `bg/base`, `fg/muted`), o script lista as variáveis não
mapeadas no relatório — renomeie no Figma ou adicione o alias no mapa `matchColorRole`.

## Regras de fidelidade

1. **Sem gradientes, sem sombras pesadas, sem glassmorphism** — só entra o que existir no
   arquivo. O token set não tem `shadow` justamente por isso; se o Figma tiver, cria-se o
   papel `shadow.<n>` com os valores exatos.
2. **Hierarquia por tipografia e espaço**, não por cor de fundo forte: `textPrimary` para
   título, `textSecondary` para corpo, `textTertiary` para metadado.
3. **Uma cor de destaque por contexto** (`contextWork` azul, `contextStudies` âmbar,
   `contextPersonal` verde) usada em pontos de 5–7 px e borda esquerda de 2 px na linha
   selecionada. Nunca em blocos grandes.
4. **Dark mode é derivado por papel**, não por inversão automática: cada papel tem valor
   próprio em `.dark`.
5. **Contraste mínimo**: texto primário ≥ 7:1, secundário ≥ 4.5:1, terciário ≥ 3:1 sobre
   `surface`.

## Consumo no código

```tsx
import { useTheme } from '@mail/ui';

const theme = useTheme(); // { mode, colors, fonts, typography, space, radius, layout, motion }

<View style={{ padding: theme.space[3], backgroundColor: theme.colors.surface }} />
```

Para CSS puro (landing, storybook), `cssVariables(mode)` devolve
`{ '--mail-color-canvas': '#FBFBFA', ... }`.

## Pendência conhecida

O link fornecido (`node-id=0-1`, arquivo "Untitled") aponta para o **documento raiz**. Para
extrair Desktop (3 colunas) e Mobile é necessário o node-id de cada frame, por exemplo
`?node-id=12-345`. Sem isso o script só consegue reportar as variáveis globais.
