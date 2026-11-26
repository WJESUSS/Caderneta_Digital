export type PlanoId = 'gratis' | 'basico' | 'pro';

export interface PlanoConfig {
  id: PlanoId;
  nome: string;
  subtitulo: string;
  precoMensalCentavos: number;
  precoFormatado: string;
  limiteClientesAtivos: number | null;
  descricaoLimite: string;
  recursos: string[];
}

/**
 * Tabela centralizada dos planos da Caderneta Digital.
 * Edite os valores, limites ou descrições aqui para atualizar todo o app.
 */
export const PLANOS_CONFIG: Record<PlanoId, PlanoConfig> = {
  gratis: {
    id: 'gratis',
    nome: 'Grátis',
    subtitulo: 'Para começar sua caderneta digital',
    precoMensalCentavos: 0,
    precoFormatado: 'R$ 0',
    limiteClientesAtivos: 20,
    descricaoLimite: 'Até 20 clientes ativos',
    recursos: [
      'Até 20 clientes ativos',
      'Compras, pagamentos e cobrança no WhatsApp',
      'Link público de consulta e QR Code do comércio',
    ],
  },
  basico: {
    id: 'basico',
    nome: 'Básico',
    subtitulo: 'Para comércios em crescimento',
    precoMensalCentavos: 2990,
    precoFormatado: 'R$ 29,90/mês',
    limiteClientesAtivos: 100,
    descricaoLimite: 'Até 100 clientes ativos',
    recursos: [
      'Até 100 clientes ativos',
      'Tudo do plano Grátis incluído',
      'Suporte direto pelo WhatsApp',
    ],
  },
  pro: {
    id: 'pro',
    nome: 'Pro',
    subtitulo: 'Para alto volume sem limite de clientes',
    precoMensalCentavos: 5990,
    precoFormatado: 'R$ 59,90/mês',
    limiteClientesAtivos: null,
    descricaoLimite: 'Clientes ativos ilimitados',
    recursos: [
      'Clientes ativos ilimitados',
      'Atendentes e controle completo da equipe',
      'Atendimento prioritário pelo WhatsApp',
    ],
  },
};

export const PLANOS_LISTA: PlanoConfig[] = [
  PLANOS_CONFIG.gratis,
  PLANOS_CONFIG.basico,
  PLANOS_CONFIG.pro,
];

export const PERCENTUAL_AVISO_LIMITE = 80;

export interface AssinaturaComercio {
  plano: 'basico' | 'pro';
  validoAte: Date;
}

export interface PlanoResolvido {
  planoId: PlanoId;
  plano: PlanoConfig;
  assinaturaAtiva: boolean;
  validoAte: Date | null;
  expirada: boolean;
}

export interface UsoPlano {
  planoId: PlanoId;
  plano: PlanoConfig;
  clientesAtivos: number;
  limite: number | null;
  percentual: number;
  pertoDoLimite: boolean;
  noLimite: boolean;
  excedido: boolean;
  vagasRestantes: number | null;
  textoUso: string;
}

export class ErroLimitePlano extends Error {
  readonly codigo = 'LIMITE_PLANO' as const;
  readonly planoAtual: PlanoId;
  readonly clientesAtivos: number;
  readonly limite: number;

  constructor(mensagem: string, planoAtual: PlanoId, clientesAtivos: number, limite: number) {
    super(mensagem);
    this.name = 'ErroLimitePlano';
    this.planoAtual = planoAtual;
    this.clientesAtivos = clientesAtivos;
    this.limite = limite;
  }
}

export function isErroLimitePlano(err: unknown): boolean {
  if (err instanceof ErroLimitePlano) return true;
  if (err && typeof err === 'object' && 'codigo' in err) {
    return (err as { codigo?: unknown }).codigo === 'LIMITE_PLANO';
  }
  return false;
}

/**
 * Regra de contagem: apenas clientes com ativo === true e anonimizado === false contam no plano.
 */
export function isClienteAtivoParaPlano(cliente: { ativo: boolean; anonimizado: boolean }): boolean {
  return cliente.ativo === true && cliente.anonimizado === false;
}

export function contarClientesAtivos(
  clientes: ReadonlyArray<{ ativo: boolean; anonimizado: boolean }>
): number {
  let count = 0;
  for (const cliente of clientes) {
    if (isClienteAtivoParaPlano(cliente)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Resolve o plano vigente do comércio a partir do documento em `assinaturas/{comercioId}`.
 * Documento ausente, inválido ou vencido retorna sempre o plano Grátis.
 */
export function resolverPlanoComercio(
  assinatura: { plano?: unknown; validoAte?: Date | null } | null | undefined,
  agora: Date = new Date()
): PlanoResolvido {
  if (!assinatura) {
    return {
      planoId: 'gratis',
      plano: PLANOS_CONFIG.gratis,
      assinaturaAtiva: false,
      validoAte: null,
      expirada: false,
    };
  }

  const planoRaw = assinatura.plano;
  if (planoRaw !== 'basico' && planoRaw !== 'pro') {
    return {
      planoId: 'gratis',
      plano: PLANOS_CONFIG.gratis,
      assinaturaAtiva: false,
      validoAte: null,
      expirada: false,
    };
  }

  const validoAte = assinatura.validoAte instanceof Date ? assinatura.validoAte : null;
  const validoMs = validoAte ? validoAte.getTime() : NaN;
  if (!validoAte || Number.isNaN(validoMs) || validoMs <= agora.getTime()) {
    return {
      planoId: 'gratis',
      plano: PLANOS_CONFIG.gratis,
      assinaturaAtiva: false,
      validoAte: validoAte && !Number.isNaN(validoMs) && validoMs > 0 ? validoAte : null,
      expirada: Boolean(validoAte && !Number.isNaN(validoMs) && validoMs > 0),
    };
  }

  return {
    planoId: planoRaw,
    plano: PLANOS_CONFIG[planoRaw],
    assinaturaAtiva: true,
    validoAte,
    expirada: false,
  };
}

export function avaliarUsoPlano(
  clientesAtivos: number,
  planoResolvido: PlanoResolvido
): UsoPlano {
  const ativos = Math.max(0, Math.floor(clientesAtivos));
  const limite = planoResolvido.plano.limiteClientesAtivos;

  if (limite === null) {
    return {
      planoId: planoResolvido.planoId,
      plano: planoResolvido.plano,
      clientesAtivos: ativos,
      limite: null,
      percentual: 0,
      pertoDoLimite: false,
      noLimite: false,
      excedido: false,
      vagasRestantes: null,
      textoUso: `${ativos} ${ativos === 1 ? 'cliente ativo' : 'clientes ativos'} (ilimitado)`,
    };
  }

  const percentual = limite > 0 ? Math.min(999, Math.round((ativos / limite) * 100)) : 100;
  const pertoDoLimite = ativos * 100 >= limite * PERCENTUAL_AVISO_LIMITE && ativos < limite;
  const noLimite = ativos >= limite;
  const excedido = ativos > limite;
  const vagasRestantes = Math.max(0, limite - ativos);

  return {
    planoId: planoResolvido.planoId,
    plano: planoResolvido.plano,
    clientesAtivos: ativos,
    limite,
    percentual,
    pertoDoLimite,
    noLimite,
    excedido,
    vagasRestantes,
    textoUso: `${ativos} de ${limite} clientes`,
  };
}

export function verificarPermissaoAdicaoClientes(
  uso: UsoPlano,
  quantidadeNovos: number = 1
): { permitido: boolean; mensagem: string | null } {
  const qtd = Math.max(0, Math.floor(quantidadeNovos));
  if (qtd === 0 || uso.limite === null) {
    return { permitido: true, mensagem: null };
  }

  if (uso.clientesAtivos + qtd > uso.limite) {
    if (qtd === 1) {
      return {
        permitido: false,
        mensagem: `Limite do plano ${uso.plano.nome} atingido (${uso.clientesAtivos} de ${uso.limite} clientes ativos). Veja os planos para continuar cadastrando ou reativando clientes.`,
      };
    }
    return {
      permitido: false,
      mensagem: `Não é possível adicionar ${qtd} clientes de exemplo: seu plano ${uso.plano.nome} permite até ${uso.limite} clientes ativos e você já possui ${uso.clientesAtivos}.`,
    };
  }

  return { permitido: true, mensagem: null };
}

export function formatValidadePlanoBR(validoAte: Date | null): string {
  if (!validoAte || Number.isNaN(validoAte.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Bahia',
  }).format(validoAte);
}

export function buildWhatsAppSuporteAssinaturaUrl(params: {
  whatsappSuporte: string;
  comercioNome: string;
  comercioId: string;
  plano: PlanoConfig;
}): string | null {
  const digits = params.whatsappSuporte.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const normalized = digits.startsWith('55') && digits.length >= 12 ? digits : `55${digits}`;
  const mensagem = [
    `Olá! Gostaria de assinar o plano ${params.plano.nome} (${params.plano.precoFormatado}) no Caderneta Digital.`,
    '',
    `Comércio: ${params.comercioNome}`,
    `ID do comércio: ${params.comercioId}`,
    `Plano escolhido: ${params.plano.nome}`,
  ].join('\n');
  return `https://wa.me/${normalized}?text=${encodeURIComponent(mensagem)}`;
}
