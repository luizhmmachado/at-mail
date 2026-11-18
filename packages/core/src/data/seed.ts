import { brand } from '../domain/ids';
import type { Account, ChatMessage, ContextWorkspace, EmailMessage, MailMessage } from '../domain/models';
import { createPresetContexts } from '../state/store';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface SeedData {
  contexts: ContextWorkspace[];
  accounts: Account[];
  messages: MailMessage[];
}

export function createSeedData(now: number = Date.now()): SeedData {
  const contexts = createPresetContexts(now);
  const work = brand.context('work');
  const studies = brand.context('studies');
  const personal = brand.context('personal');

  const accounts: Account[] = [
    {
      id: brand.account('acc-work-mail'),
      provider: 'gmail',
      channel: 'email',
      transport: 'oauth2-google',
      email: 'ana.trabalho@empresa.com',
      displayName: 'Ana · Trabalho',
      contextId: work,
      status: 'connected',
      lastSyncedAt: now - 2 * MINUTE,
      secretRef: brand.secret('account:acc-work-mail:oauth'),
      createdAt: now - 90 * 24 * HOUR,
      updatedAt: now - 2 * MINUTE
    },
    {
      id: brand.account('acc-work-chat'),
      provider: 'google-chat',
      channel: 'chat',
      transport: 'oauth2-google',
      email: 'ana.trabalho@empresa.com',
      displayName: 'Chat · Trabalho',
      contextId: work,
      status: 'connected',
      lastSyncedAt: now - 1 * MINUTE,
      secretRef: brand.secret('account:acc-work-chat:oauth'),
      createdAt: now - 90 * 24 * HOUR,
      updatedAt: now - 1 * MINUTE
    },
    {
      id: brand.account('acc-studies-mail'),
      provider: 'gmail',
      channel: 'email',
      transport: 'oauth2-google',
      email: 'ana.estudos@gmail.com',
      displayName: 'Ana · Estudos',
      contextId: studies,
      status: 'connected',
      lastSyncedAt: now - 18 * MINUTE,
      secretRef: brand.secret('account:acc-studies-mail:oauth'),
      createdAt: now - 400 * 24 * HOUR,
      updatedAt: now - 18 * MINUTE
    },
    {
      id: brand.account('acc-personal-mail'),
      provider: 'icloud',
      channel: 'email',
      transport: 'imap-smtp',
      email: 'ana.pessoal@icloud.com',
      displayName: 'Ana · Pessoal',
      contextId: personal,
      status: 'connected',
      lastSyncedAt: now - 41 * MINUTE,
      secretRef: brand.secret('account:acc-personal-mail:imap'),
      createdAt: now - 700 * 24 * HOUR,
      updatedAt: now - 41 * MINUTE
    },
    {
      id: brand.account('acc-personal-chat'),
      provider: 'google-chat',
      channel: 'chat',
      transport: 'oauth2-google',
      email: 'ana.pessoal@gmail.com',
      displayName: 'Chat · Pessoal',
      contextId: personal,
      status: 'connected',
      lastSyncedAt: now - 6 * MINUTE,
      secretRef: brand.secret('account:acc-personal-chat:oauth'),
      createdAt: now - 600 * 24 * HOUR,
      updatedAt: now - 6 * MINUTE
    }
  ];

  const ana = { name: 'Ana Ribeiro', email: 'ana.trabalho@empresa.com' };
  const bruno = { name: 'Bruno Salles', email: 'bruno.salles@empresa.com' };
  const carla = { name: 'Carla Menezes', email: 'carla.menezes@empresa.com' };
  const diego = { name: 'Diego Farias', email: 'diego.farias@empresa.com' };
  const prof = { name: 'Helena Prado', email: 'helena.prado@universidade.edu.br' };
  const mae = { name: 'Marta Ribeiro', email: 'marta.ribeiro@icloud.com' };
  const clube = { name: 'Clube do Livro', email: 'livro@pessoal.dev' };

  const messages: MailMessage[] = [
    email({
      id: 'm-work-1',
      account: 'acc-work-mail',
      contextId: work,
      folder: 'inbox',
      subject: 'Revisão do RFC de sincronização offline',
      snippet: 'Deixei três pontos em aberto sobre resolução de conflito...',
      body:
        'Ana,\n\nDeixei três pontos em aberto no RFC sobre resolução de conflito quando o app volta online:\n\n' +
        '1. Estratégia de merge por cursor (historyId) versus last-write-wins.\n' +
        '2. O que fazemos com rascunhos criados offline em duas contas do mesmo contexto.\n' +
        '3. Limite de itens por resposta da API para não estourar memória no mobile.\n\n' +
        'Consegue fechar até quinta? Preciso disso para o plano de capacidade.\n\nBruno',
      receivedAt: now - 9 * MINUTE,
      isRead: false,
      isStarred: true,
      participants: [bruno, ana],
      providerThreadId: 'thread-rfc-offline'
    }),
    email({
      id: 'm-work-2',
      account: 'acc-work-mail',
      contextId: work,
      folder: 'inbox',
      subject: 'Re: Revisão do RFC de sincronização offline',
      snippet: 'Faz sentido. Sobre o item 2, eu proporia um rascunho único por contexto...',
      body:
        'Faz sentido. Sobre o item 2, eu proporia um rascunho único por contexto, com anexo de proveniência ' +
        'para sabermos de qual conta ele nasceu. Assim evitamos duplicidade sem perder a informação.\n\nAna',
      receivedAt: now - 4 * MINUTE,
      isRead: false,
      isStarred: false,
      participants: [ana, bruno],
      providerThreadId: 'thread-rfc-offline',
      rfcMessageId: '<c4@empresa.com>',
      inReplyTo: '<a1@empresa.com>'
    }),
    email({
      id: 'm-work-3',
      account: 'acc-work-mail',
      contextId: work,
      folder: 'inbox',
      subject: 'Janela de deploy — quinta 22h',
      snippet: 'Confirmado com o time de infraestrutura. Rollback em até 10 minutos.',
      body: 'Confirmado com o time de infraestrutura. Rollback em até 10 minutos.\n\nCarla',
      receivedAt: now - 3 * HOUR,
      isRead: true,
      isStarred: false,
      participants: [carla, ana, diego],
      providerThreadId: 'thread-deploy',
      attachments: [{ id: 'att-1', fileName: 'runbook-deploy.pdf', mimeType: 'application/pdf', sizeInBytes: 284_112 }]
    }),
    email({
      id: 'm-work-4',
      account: 'acc-work-mail',
      contextId: work,
      folder: 'inbox',
      subject: 'Contrato de licenças — assinatura pendente',
      snippet: 'O jurídico liberou. Falta apenas a sua assinatura no anexo.',
      body: 'O jurídico liberou. Falta apenas a sua assinatura no anexo.\n\nDiego',
      receivedAt: now - 26 * HOUR,
      isRead: true,
      isStarred: false,
      participants: [diego, ana],
      providerThreadId: 'thread-contrato'
    }),
    chat({
      id: 'c-work-1',
      account: 'acc-work-chat',
      contextId: work,
      spaceId: 'space-engenharia',
      spaceName: 'Engenharia · Produto',
      sender: bruno,
      text: 'Subi o preview do novo painel de threads. Quem quiser revisar, está no ambiente de staging.',
      receivedAt: now - 12 * MINUTE,
      isRead: false,
      isMentioned: false
    }),
    chat({
      id: 'c-work-2',
      account: 'acc-work-chat',
      contextId: work,
      spaceId: 'space-engenharia',
      spaceName: 'Engenharia · Produto',
      sender: carla,
      text: '@Ana o gráfico de latência p95 do sync precisa do seu review antes do deploy.',
      receivedAt: now - 6 * MINUTE,
      isRead: false,
      isMentioned: true
    }),
    chat({
      id: 'c-work-3',
      account: 'acc-work-chat',
      contextId: work,
      spaceId: 'space-design',
      spaceName: 'Design System',
      sender: diego,
      text: 'Atualizei os tokens de densidade da lista. O espaçamento entre linhas caiu de 72 para 68.',
      receivedAt: now - 5 * HOUR,
      isRead: true,
      isMentioned: false
    }),
    email({
      id: 'm-studies-1',
      account: 'acc-studies-mail',
      contextId: studies,
      folder: 'inbox',
      subject: 'Entrega do trabalho final — prorrogação aprovada',
      snippet: 'A banca aprovou a prorrogação até 30/11. Mantenha o formato de submissão.',
      body:
        'Prezada Ana,\n\nA banca aprovou a prorrogação da entrega até 30/11. Mantenha o formato de submissão ' +
        '(PDF, até 20 páginas) e a mesma estrutura de referências.\n\nAtenciosamente,\nProfa. Helena Prado',
      receivedAt: now - 47 * MINUTE,
      isRead: false,
      isStarred: true,
      participants: [prof, ana],
      providerThreadId: 'thread-tcc',
      attachments: [{ id: 'att-2', fileName: 'normas-submissao.pdf', mimeType: 'application/pdf', sizeInBytes: 512_000 }]
    }),
    email({
      id: 'm-studies-2',
      account: 'acc-studies-mail',
      contextId: studies,
      folder: 'inbox',
      subject: 'Lista 4 de Sistemas Distribuídos',
      snippet: 'Prazo: sexta, 23h59. Dúvidas pelo fórum da disciplina.',
      body: 'Prazo: sexta, 23h59. Dúvidas pelo fórum da disciplina.',
      receivedAt: now - 30 * HOUR,
      isRead: true,
      isStarred: false,
      participants: [{ name: 'Monitoria SD', email: 'monitoria@universidade.edu.br' }, ana],
      providerThreadId: 'thread-lista4'
    }),
    email({
      id: 'm-personal-1',
      account: 'acc-personal-mail',
      contextId: personal,
      folder: 'inbox',
      subject: 'Domingo na casa da vó?',
      snippet: 'Levo o bolo. Você busca a Mari na rodoviária?',
      body: 'Levo o bolo. Você busca a Mari na rodoviária?\n\nMãe',
      receivedAt: now - 2 * HOUR,
      isRead: false,
      isStarred: false,
      participants: [mae, ana],
      providerThreadId: 'thread-domingo'
    }),
    email({
      id: 'm-personal-2',
      account: 'acc-personal-mail',
      contextId: personal,
      folder: 'inbox',
      subject: 'Encontro do clube — leitura de novembro',
      snippet: 'O livro do mês é "A vegetariana". Encontro dia 28, 19h30.',
      body: 'O livro do mês é "A vegetariana". Encontro dia 28, 19h30, na livraria da praça.',
      receivedAt: now - 3 * 24 * HOUR,
      isRead: true,
      isStarred: false,
      participants: [clube, ana],
      providerThreadId: 'thread-clube'
    }),
    chat({
      id: 'c-personal-1',
      account: 'acc-personal-chat',
      contextId: personal,
      spaceId: 'space-familia',
      spaceName: 'Família',
      sender: mae,
      text: 'Confirma o horário de domingo? Preciso avisar a tia Cida.',
      receivedAt: now - 6 * MINUTE,
      isRead: false,
      isMentioned: true
    }),
    chat({
      id: 'c-personal-2',
      account: 'acc-personal-chat',
      contextId: personal,
      spaceId: 'space-familia',
      spaceName: 'Família',
      sender: { name: 'Mari Ribeiro', email: 'mari@icloud.com' },
      text: 'Chego às 14h40 no terminal Rodoviário Norte.',
      receivedAt: now - 90 * MINUTE,
      isRead: true,
      isMentioned: false
    })
  ];

  return { contexts, accounts, messages };
}

interface EmailSeed {
  id: string;
  account: string;
  contextId: string;
  folder: 'inbox' | 'sent' | 'draft' | 'archived';
  subject: string;
  snippet: string;
  body: string;
  receivedAt: number;
  isRead: boolean;
  isStarred: boolean;
  participants: { name: string; email: string }[];
  providerThreadId: string;
  rfcMessageId?: string;
  inReplyTo?: string;
  attachments?: { id: string; fileName: string; mimeType: string; sizeInBytes: number }[];
  unreadAt?: number;
}

function email(seed: EmailSeed): EmailMessage {
  return {
    id: brand.message(seed.id),
    accountId: brand.account(seed.account),
    contextId: brand.context(seed.contextId),
    channel: 'email',
    participants: seed.participants,
    snippet: seed.snippet,
    bodyText: seed.body,
    receivedAt: seed.receivedAt,
    isRead: seed.isRead,
    isStarred: seed.isStarred,
    isMentioned: false,
    labels: [],
    subject: seed.subject,
    providerThreadId: seed.providerThreadId,
    rfcMessageId: seed.rfcMessageId,
    inReplyTo: seed.inReplyTo,
    references: [],
    folder: seed.folder,
    attachments: seed.attachments ?? []
  };
}

interface ChatSeed {
  id: string;
  account: string;
  contextId: string;
  spaceId: string;
  spaceName: string;
  sender: { name: string; email: string };
  text: string;
  receivedAt: number;
  isRead: boolean;
  isMentioned: boolean;
}

function chat(seed: ChatSeed): ChatMessage {
  return {
    id: brand.message(seed.id),
    accountId: brand.account(seed.account),
    contextId: brand.context(seed.contextId),
    channel: 'chat',
    participants: [seed.sender],
    snippet: seed.text,
    bodyText: seed.text,
    receivedAt: seed.receivedAt,
    isRead: seed.isRead,
    isStarred: false,
    isMentioned: seed.isMentioned,
    labels: [],
    spaceId: brand.space(seed.spaceId),
    spaceName: seed.spaceName,
    senderName: seed.sender.name,
    isDirectMessage: false
  };
}
