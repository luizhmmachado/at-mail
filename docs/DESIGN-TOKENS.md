# @mail — Design tokens (Figma → código)

## Princípio

Existe **uma** fonte de verdade visual: `packages/core/src/theme/figma.tokens.json`.
Nenhum componente declara cor, espaçamento, raio ou tamanho de fonte literal. O caminho é:

```
Figma (qqjxZUMeAj95mXV7wYtTEw)
   │  frames 2:2 (@mail · Desktop 1440×900) e 2:6 (@mail · Mobile 390×844)
   ▼
figma.tokens.json  ──►  tokens.ts (papéis semânticos light/dark)
   │
   ▼
packages/ui  useTheme() + typeStyle()  ──►  Expo / Tauri
```

## Estado atual: `extracted`

O arquivo foi lido da API do Figma e conferido contra os dois frames. `meta.status` é
`"extracted"` e `meta.frames` registra os node-ids usados.

### Cores (light)

| Papel | Valor | Onde aparece |
| --- | --- | --- |
| `canvas` / `rail` | `#FAFAFA` | fundo do rail e do frame |
| `surface` | `#FFFFFF` | caixa unificada e coluna de leitura |
| `surfaceSelected` | `#F4F6FA` | linha selecionada |
| `surfaceSunken` | `#FAFAFA` | busca, cartão de mensagem anterior, anexo |
| `divider` | `#F0F0F2` | divisor recuado da linha |
| `borderSubtle` | `#E4E4E7` | hairlines, bordas de campo |
| `textPrimary` | `#18181B` | nomes, assuntos, corpo |
| `textSecondary` | `#71717A` | trecho, metadados |
| `accent` | `#1D4ED8` | contexto ativo, não lido, barra de seleção |
| `accentMuted` | `#EEF2FA` | fundo do tile de contexto ativo |
| `segmentTrack` | `#F4F4F5` | trilho do segmentado desktop |
| `segmentThumb` | `#FFFFFF` | polegar do segmentado |
| `contextWork` | `#8D9AA8` | indicador Trabalho |
| `contextStudies` | `#B7A58C` | indicador Estudos |
| `contextPersonal` | `#8EA696` | indicador Pessoal |

`scrim` e `shadow` existem apenas para os overlays (busca global e menu de contexto); não há
sombra em nenhuma superfície do frame.

### Tipografia

Família **Inter** (400/500/600), embarcada via `@expo-google-fonts/inter`. Como cada peso é um
arquivo separado, `typeStyle()` escolhe a família pelo peso — `fontWeight` sintetizado mudaria
as métricas.

| Papel | Tamanho / entrelinha | Uso |
| --- | --- | --- |
| `railBrand` | 27 / 33 · 600 | “@” do rail |
| `railContext` | 10 / 12 | rótulo do tile |
| `inboxTitle` | 20 / 24 · 600 | “Todas as caixas” |
| `search` | 12 / 15 | campo de busca |
| `segment` | 12 / 15 | Tudo / E-mail / Chat |
| `sectionLabel` | 10 / 12 · 500 | HOJE, ONTEM |
| `rowName` | 12 / 15 · 600 | remetentes (desktop) |
| `rowSubject` | 12 / 15 · 500 | assunto (desktop) |
| `rowSnippet` | 10,5 / 13 | trecho (desktop) |
| `rowMeta` | 10 / 12 | hora (desktop) |
| `rowNameMobile` | 13 / 16 · 600 | remetentes (mobile) |
| `rowSubjectMobile` | 13 / 16 · 500 | assunto (mobile) |
| `rowSnippetMobile` | 11 / 13 | trecho (mobile) |
| `rowContextMobile` | 9 / 11 | nome do contexto (mobile) |
| `mobileTitle` | 22 / 27 · 600 | título no mobile |
| `readerTitle` | 28 / 45 · 600 | assunto aberto |
| `readerBody` | 14 / 25 | corpo da mensagem atual |
| `earlierName` | 13 / 21 · 500 | cartão de mensagem anterior |
| `earlierBody` | 12 / 19 | corpo do cartão |
| `readerMeta` | 11 / 18 | hora, “para mim”, contador |
| `composeLabel` | 12 / 19 | “Responder a …” |
| `composeHint` | 10 / 16 | “⌘ Enter para enviar” |
| `button` | 12 / 19 · 500 | Enviar |
| `navLabel` | 10 / 12 | navegação inferior |

O letter-spacing do arquivo é **-1% do tamanho da fonte** em todos os papéis; `typeStyle()`
converte para px (12 px → `-0.12`).

### Layout

| Token | Valor | Uso |
| --- | --- | --- |
| `sidebarWidth` | 64 | rail |
| `contextTile` | 48 × 58, raio 8 | tile de contexto |
| `contextTileGap` | 14 | entre tiles |
| `listWidth` | 360 | caixa unificada |
| `inboxPaddingX` | 20 | respiro do cabeçalho |
| `inboxTitleTop` | 27 | topo do título |
| `searchHeight` | 34, raio 6 | busca |
| `segmentHeight` | 32, raio 6 | segmentado desktop |
| `rowHeight` | 72 | linha desktop |
| `rowDotInset` | 16 | indicador de contexto |
| `rowContentInset` | 29 | texto da linha |
| `dividerInset` | 24 | divisor |
| `headerHeight` | 72 | barra de ações do leitor |
| `readerPadding` | 80 | gutter da leitura (1016 → 856) |
| `readerTitleGap` | 38 | respiro sob a barra |
| `tagHeight` | 26, raio 4 | etiqueta de canal/contexto |
| `composerMinHeight` | 132, raio 8 | compositor |
| `mobileRowHeight` | 84 | linha mobile |
| `mobileBottomNavHeight` | 84 | navegação inferior |

Breakpoint: abaixo de **860 px** a interface vira lista + leitor em tela cheia com navegação
inferior.

## Atualizar os tokens

```bash
npm run tokens:sync              # não faz nada se status = extracted (proteção)
npm run tokens:sync -- --force   # relê o Figma e sobrescreve (revise o diff)
```

A proteção existe porque o arquivo foi conferido à mão: a heurística de auto-layout não
reconstrói sozinha os papéis tipográficos (`roles`) nem os gutters medidos nas coordenadas dos
frames.

Para extrair de outro arquivo/frame:

```bash
FIGMA_FILE_KEY=... FIGMA_NODE_ID=12-345 npm run tokens:sync -- --force
```

O token do Figma precisa de `file_content:read` e `file_variables:read` e fica em `.env`
(ignorado pelo git, `chmod 600`). Não é usado em runtime — revogue depois da extração.

## Regras de fidelidade

1. **Sem gradientes, sem glassmorphism, sem sombra em superfície.** Só entram os overlays
   (`scrim`/`shadow`) porque o menu e a busca global flutuam sobre a lista.
2. **Hierarquia por tipografia e espaço**, não por blocos de cor.
3. **Uma cor por contexto**, usada em pontos de 5–8 px e no tile ativo. Nunca em áreas grandes.
4. **Destaque azul** apenas em: contexto ativo, não lido, barra de 2 px da linha selecionada.
5. **Dark mode derivado por papel** — o arquivo não tem modo escuro; os valores `.dark` são
   escolhidos um a um, não invertidos.
6. **Ícones são desenhados com `View`** (`packages/ui/src/components/Glyph.tsx`) nas medidas do
   frame (12–21 px, traço 1,2). Uma icon font mudaria o peso óptico e exigiria recalibrar cada uso.

## Consumo no código

```tsx
const theme = useTheme();

<Text style={{ ...typeStyle(theme, 'rowName'), color: theme.colors.textPrimary }} />
<View style={{ height: theme.layout.rowHeight, backgroundColor: theme.colors.surface }} />
```

`typeStyle(theme, papel, peso?)` devolve família, tamanho, entrelinha e tracking; a cor fica
explícita para o papel semântico (`textPrimary`, `textSecondary`, …). `cssVariables(mode)`
continua disponível para CSS puro.

## O que não veio do Figma

- **Dark mode** — derivado (ver `meta.darkMode`).
- **Estados de hover** — o frame é estático; usa-se `surfaceHover` como incremento sutil.
- **Barra de status do iOS** (`9:41`, wifi, bateria) — é do sistema operacional; o app não
  desenha uma barra falsa. Por isso o cabeçalho mobile começa no título, e não 57 px abaixo.
- **Comportamento do compositor** — o frame mostra o estado visual; envio real depende do
  serviço de sincronização.
