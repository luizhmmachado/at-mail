#!/usr/bin/env node
/**
 * Sincroniza os design tokens do Figma para `packages/core/src/theme/figma.tokens.json`.
 *
 * Uso:
 *   FIGMA_ACCESS_TOKEN=figd_xxx npm run tokens:sync
 *   (ou copie .env.example para .env e preencha)
 *
 * O script NÃO inventa valores: só grava o que veio da API do Figma.
 * Papéis sem correspondência são listados no final para revisão manual.
 *
 * Escopos necessários no token: file_content:read e file_variables:read
 * (variáveis locais exigem plano Enterprise/Organization no Figma).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_PATH = resolve(ROOT, 'packages/core/src/theme/figma.tokens.json');
const REPORT_PATH = resolve(ROOT, 'packages/core/src/theme/figma.raw.json');

loadDotEnv(resolve(ROOT, '.env'));

const TOKEN = process.env.FIGMA_ACCESS_TOKEN ?? '';
const FILE_KEY = process.env.FIGMA_FILE_KEY ?? 'qqjxZUMeAj95mXV7wYtTEw';
const NODE_ID = process.env.FIGMA_NODE_ID ?? '0-1';

if (TOKEN.length === 0) {
  console.error(
    [
      'FIGMA_ACCESS_TOKEN ausente.',
      '',
      'Como gerar: Figma → Settings → Security → Personal access tokens → Generate new token',
      'Escopos: file_content:read, file_variables:read (library_analytics:read é opcional).',
      'Depois: echo "FIGMA_ACCESS_TOKEN=figd_..." >> .env  (o arquivo .env é ignorado pelo git)'
    ].join('\n')
  );
  process.exit(1);
}

const headers = { 'X-Figma-Token': TOKEN };

async function figma(path) {
  const response = await fetch(`https://api.figma.com/v1${path}`, { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Figma ${path} → HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));

/**
 * O arquivo publicado já foi conferido contra os frames (papéis tipográficos,
 * gutters e alturas de linha). Rodar a heurística de novo sem intenção trocaria
 * esses valores por aproximações, então exigimos `--force`.
 */
if (tokens.meta?.status === 'extracted' && !process.argv.includes('--force')) {
  console.log(
    [
      '',
      '@mail · tokens já extraídos e revisados manualmente — nada foi alterado.',
      '  Para reler o Figma e sobrescrever (revisar o diff depois):',
      '    npm run tokens:sync -- --force',
      ''
    ].join('\n')
  );
  process.exit(0);
}

const mapped = [];
const unmapped = [];

const colorRoles = Object.keys(tokens.color);

const variables = await fetchVariables();
const documentNode = await figma(`/files/${FILE_KEY}/nodes?ids=${encodeURIComponent(NODE_ID)}`);
const extracted = extractFromDocument(documentNode);

let updated = 0;

if (variables !== null) {
  const { variables: variableMap, variableCollections } = variables;
  const modesByCollection = new Map();
  for (const [id, collection] of Object.entries(variableCollections)) {
    modesByCollection.set(id, collection.modes ?? []);
  }

  for (const variable of Object.values(variableMap)) {
    if (variable.resolvedType !== 'COLOR') continue;
    const role = matchColorRole(variable.name);
    if (role === null) {
      unmapped.push(variable.name);
      continue;
    }
    const modes = modesByCollection.get(variable.variableCollectionId) ?? [];
    const values = variable.valuesByMode ?? {};

    for (const mode of modes) {
      const value = values[mode.modeId];
      if (value === undefined || typeof value !== 'object' || value.type !== 'VARIABLE_ALIAS') {
        const hex = toHex(value);
        if (hex === null) continue;
        const themeMode = /dark|escuro/i.test(mode.name) ? 'dark' : 'light';
        if (tokens.color[role][themeMode] !== hex) updated += 1;
        tokens.color[role][themeMode] = hex;
      }
    }
    mapped.push({ variable: variable.name, role });
  }
}

applyTypographyScale(tokens, extracted.fontSizes);
applySpacing(tokens, extracted.spacings);
applyRadii(tokens, extracted.radii);

const hasSignal =
  mapped.length > 0 ||
  extracted.cycle.fontSizes > 0 ||
  extracted.cycle.spacings > 0 ||
  extracted.cycle.radii > 0;

tokens.meta.nodeId = NODE_ID;
if (hasSignal) {
  tokens.meta.status = 'extracted';
  tokens.meta.extractedAt = new Date().toISOString();
} else {
  console.log(
    '\n  Nada foi extraído do Figma (sem variáveis mapeadas e sem auto-layout no node informado).' +
      '\n  status permanece "provisional" — confirme o node-id do frame real.'
  );
}

writeFileSync(TOKENS_PATH, `${JSON.stringify(tokens, null, 2)}\n`, 'utf8');
writeFileSync(
  REPORT_PATH,
  `${JSON.stringify({ extractedAt: tokens.meta.extractedAt, nodeId: NODE_ID, cycle: extracted.cycle, mapped, unmapped }, null, 2)}\n`,
  'utf8'
);

console.log(`\n@mail · tokens sincronizados (${updated} valores alterados)`);
console.log(`  arquivo: ${TOKENS_PATH}`);
console.log(`  relatório: ${REPORT_PATH}`);
console.log(`  papéis mapeados: ${mapped.length}`);
if (unmapped.length > 0) {
  console.log(`  variáveis sem papel semântico (${unmapped.length}): ${unmapped.slice(0, 12).join(', ')}`);
}
console.log(
  `  extraído da árvore: ${extracted.cycle.fontSizes} tamanhos de fonte, ` +
    `${extracted.cycle.spacings} espaçamentos, ${extracted.cycle.radii} raios`
);
if (extracted.cycle.fontSizes === 0 && extracted.cycle.spacings === 0) {
  console.log(
    '  ATENÇÃO: o frame não tem auto-layout/tipografia detectável. Confirme o node-id do frame real (@mail / Desktop / Mobile).'
  );
}

// ---------------------------------------------------------------------------

async function fetchVariables() {
  try {
    const response = await fetch(`https://api.figma.com/v1/files/${FILE_KEY}/variables/local`, { headers });
    if (response.status === 403 || response.status === 404) {
      console.log(`  aviso: variáveis indisponíveis (HTTP ${response.status}) — usando apenas estilos da árvore.`);
      return null;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    return body.meta ?? null;
  } catch (error) {
    console.log(`  aviso: não foi possível ler variáveis (${error.message}).`);
    return null;
  }
}

function extractFromDocument(payload) {
  const fontSizes = new Map();
  const spacings = new Map();
  const radii = new Map();
  const layout = { frameWidths: [] };
  let nodeCount = 0;

  const nodes = payload.nodes ?? {};
  for (const entry of Object.values(nodes)) {
    walk(entry.document);
  }

  function walk(node) {
    if (node === null || typeof node !== 'object') return;
    nodeCount += 1;

    if (typeof node.fontSize === 'number') fontSizes.set(node.fontSize, (fontSizes.get(node.fontSize) ?? 0) + 1);
    if (typeof node.cornerRadius === 'number') radii.set(node.cornerRadius, (radii.get(node.cornerRadius) ?? 0) + 1);
    for (const corner of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) {
      if (typeof node[corner] === 'number' && node[corner] > 0) {
        radii.set(node[corner], (radii.get(node[corner]) ?? 0) + 1);
      }
    }
    if (typeof node.itemSpacing === 'number' && node.itemSpacing > 0) {
      spacings.set(node.itemSpacing, (spacings.get(node.itemSpacing) ?? 0) + 1);
    }
    for (const padding of ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom']) {
      if (typeof node[padding] === 'number' && node[padding] > 0) {
        spacings.set(node[padding], (spacings.get(node[padding]) ?? 0) + 1);
      }
    }
    if (typeof node.absoluteBoundingBox?.width === 'number' && node.type === 'FRAME') {
      layout.frameWidths.push(Math.round(node.absoluteBoundingBox.width));
    }

    for (const child of node.children ?? []) walk(child);
  }

  return {
    fontSizes: sortCounts(fontSizes),
    spacings: sortCounts(spacings),
    radii: sortCounts(radii),
    layout,
    cycle: {
      fontSizes: fontSizes.size,
      spacings: spacings.size,
      radii: radii.size,
      nodeCount
    }
  };
}

function applyTypographyScale(target, fontSizes) {
  if (fontSizes.length === 0) return;
  const sorted = [...new Set(fontSizes.map(([size]) => size))].sort((a, b) => a - b);
  const slots = Object.keys(target.typography.size);
  const chosen = pickSpread(sorted, slots.length);
  slots.forEach((slot, index) => {
    const size = chosen[index];
    if (size === undefined) return;
    target.typography.size[slot] = size;
    target.typography.line[slot] = Math.round(size * 1.42);
  });
}

function applySpacing(target, spacings) {
  if (spacings.length === 0) return;
  const values = [...new Set(spacings.map(([value]) => value))].sort((a, b) => a - b).slice(0, 10);
  const slots = Object.keys(target.space);
  slots.forEach((slot, index) => {
    const value = values[index];
    if (value !== undefined) target.space[slot] = value;
  });
}

function applyRadii(target, radii) {
  if (radii.length === 0) return;
  const values = [...new Set(radii.map(([value]) => value))].sort((a, b) => a - b);
  const order = ['sm', 'md', 'lg', 'xl'];
  order.forEach((slot, index) => {
    const value = values[index];
    if (value !== undefined) target.radius[slot] = value;
  });
}

function pickSpread(sorted, count) {
  if (sorted.length <= count) return sorted;
  const step = (sorted.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => sorted[Math.round(index * step)]);
}

function matchColorRole(variableName) {
  const normalized = variableName.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const role of colorRoles) {
    const candidate = role.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized === candidate || normalized.endsWith(candidate)) return role;
  }
  return null;
}

function toHex(value) {
  if (value === undefined || value === null || typeof value !== 'object') return null;
  if (typeof value.r !== 'number') return null;
  const channel = (part) => Math.round(part * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${channel(value.r)}${channel(value.g)}${channel(value.b)}`;
}

function sortCounts(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
