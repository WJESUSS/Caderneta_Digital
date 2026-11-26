export type PerfilUsuario = 'dono' | 'atendente';
export type TipoLancamento = 'compra' | 'pagamento' | 'estorno';
export type FormaPagamento = 'fiado' | 'dinheiro' | 'pix_manual' | 'debito';

export interface Comercio {
  id: string;
  nome: string;
  limitePadrao: number;
  pinHash: string;
  pinSalt: string;
  pinTentativasErradas: number;
  pinBloqueadoAte: Date;
  donoUid: string;
  criadoEm: Date;
  pixChave?: string;
  pixRecebedor?: string;
  whatsappContato?: string;
  ultimoNumeroLancamento?: number;
  prazoSolicitacaoTitularDias?: number;
}

export interface Usuario {
  uid: string;
  comercioId: string;
  perfil: PerfilUsuario;
  nome: string;
  email: string;
  ativo: boolean;
  criadoPor: string;
  criadoEm: Date;
}

export interface Cliente {
  id: string;
  comercioId: string;
  nome: string;
  whatsapp: string;
  consentimentoWhatsapp: boolean;
  consentimentoEm: Date;
  semContatoWhatsapp?: boolean;
  limiteCredito: number;
  diaVencimento: number;
  ativo: boolean;
  anonimizado: boolean;
  saldoDevedor: number;
  valorVencido: number;
  valorAVencer: number;
  proximoVencimento: string;
  observacaoDono?: string;
  criadoEm: Date;
  atualizadoEm: Date;
}

export type TipoConsentimento = 'consentimento' | 'opt_out';
export type CanalConsentimento = 'cadastro' | 'whatsapp' | 'balcao' | 'link_consulta';

export interface ConsentimentoEvento {
  id: string;
  comercioId: string;
  clienteId: string;
  tipo: TipoConsentimento;
  dataHora: Date;
  canal: CanalConsentimento;
  responsavel: string;
  origem: string;
}

export type TipoSolicitacaoTitular = 'acesso' | 'correcao' | 'portabilidade' | 'exclusao';
export type StatusSolicitacaoTitular = 'aberta' | 'atendida';

export interface SolicitacaoTitular {
  id: string;
  comercioId: string;
  clienteId: string;
  tipo: TipoSolicitacaoTitular;
  dataAbertura: Date;
  prazoEm: Date;
  status: StatusSolicitacaoTitular;
  responsavel: string;
  observacao: string;
  concluidaPor?: string;
  dataConclusao?: Date | null;
}

export interface Lancamento {
  id: string;
  numero?: string;
  comercioId: string;
  clienteId: string;
  tipo: TipoLancamento;
  valor: number;
  forma: FormaPagamento;
  itens: string;
  vencimento: string;
  valorEmAberto: number;
  autorizadoExcecaoPor: string;
  estornoDe: string;
  justificativa: string;
  idempotencyKey: string;
  criadoPor: string;
  criadoEm: Date;
}

export interface LinkConsulta {
  tokenHash: string;
  comercioId: string;
  clienteId: string;
  expiraEm: Date;
  revogado: boolean;
  tentativasErradas: number;
  bloqueadoAte: Date;
  criadoPor: string;
  criadoEm: Date;
}

export interface LancamentoResumoPublico {
  id: string;
  numero?: string;
  tipo: TipoLancamento;
  valor: number;
  forma: FormaPagamento;
  itens: string;
  vencimento: string;
  valorEmAberto: number;
  criadoEmIso: string;
  estornado: boolean;
}

export interface ResumoPublicoCliente {
  comercioNome: string;
  primeiroNome: string;
  saldoDevedor: number;
  valorVencido: number;
  valorAVencer: number;
  limiteCredito?: number;
  limiteDisponivel?: number;
  proximoVencimento: string;
  atualizadoEmIso: string;
  lancamentos: LancamentoResumoPublico[];
  pixChave?: string;
  pixRecebedor?: string;
  comercioWhatsapp?: string;
}

export const BAHIA_TIMEZONE = 'America/Bahia';

/**
 * Formata valor inteiro em centavos para "R$ 1.234,56"
 */
export function formatCentavos(centavos: number): string {
  const safe = Number.isFinite(centavos) ? Math.round(centavos) : 0;
  return (safe / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Converte texto digitado em reais (ex: "12,50" ou "125") para centavos inteiros.
 */
export function parseBRLToCentavos(raw: string): number {
  const cleaned = raw.replace(/[^\d,\.]/g, '').trim();
  if (!cleaned) return 0;

  let normalized = cleaned;
  if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    const parts = cleaned.split('.');
    if (parts.length > 2) {
      const dec = parts.pop();
      normalized = parts.join('') + '.' + dec;
    }
  }
  const num = Number.parseFloat(normalized);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100);
}

/**
 * Retorna data YYYY-MM-DD no fuso America/Bahia.
 */
export function getBahiaDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BAHIA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Formata YYYY-MM-DD para DD/MM/YYYY.
 */
export function formatDateBR(yyyyMmDd: string): string {
  if (!yyyyMmDd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return '—';
  const [y, m, d] = yyyyMmDd.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Valida e normaliza telefone brasileiro com DDD para E.164 (+55DDDNÚMERO).
 * Aceita fixo (10 dígitos) ou celular (11 dígitos) com ou sem +55.
 */
export function normalizeWhatsAppBR(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  let local = digits;
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    local = digits.slice(2);
  }
  if (local.length !== 10 && local.length !== 11) {
    return null;
  }
  const ddd = Number.parseInt(local.slice(0, 2), 10);
  if (ddd < 11 || ddd > 99) {
    return null;
  }
  return `+55${local}`;
}

export function formatWhatsAppDisplay(e164: string): string {
  if (!e164 || e164 === 'ANONIMIZADO') return 'Dados removidos';
  const digits = e164.replace(/\D/g, '');
  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return e164;
}

export function maskWhatsAppInput(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function buildWhatsAppUrl(e164: string, message: string): string {
  const digits = e164.replace(/\D/g, '');
  const full = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${full}?text=${encodeURIComponent(message)}`;
}

/**
 * Dias no mês (ano, mês 1-12).
 */
function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * RN14: O vencimento de uma compra é a primeira ocorrência do diaVencimento
 * A PARTIR da data da compra no fuso America/Bahia.
 * Trata virada de mês, ano e dias 29-31 com segurança.
 */
export function calcularVencimentoCompra(dataCompra: Date, diaVencimento: number): string {
  const compraStr = getBahiaDateString(dataCompra);
  const [yStr, mStr, dStr] = compraStr.split('-');
  let year = Number.parseInt(yStr, 10);
  let month = Number.parseInt(mStr, 10);
  const day = Number.parseInt(dStr, 10);
  const targetDay = Math.max(1, Math.min(31, Math.round(diaVencimento)));

  const dueThisMonth = Math.min(targetDay, daysInMonth(year, month));
  let finalDay = dueThisMonth;

  if (day > dueThisMonth) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    finalDay = Math.min(targetDay, daysInMonth(year, month));
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}`;
}

/**
 * RN14: A compra só é vencida A PARTIR DO DIA SEGUINTE ao vencimento,
 * se ainda houver valor em aberto.
 */
export function isCompraVencida(
  vencimento: string,
  valorEmAberto: number,
  hojeBahia: string = getBahiaDateString()
): boolean {
  if (valorEmAberto <= 0 || !vencimento) return false;
  return hojeBahia > vencimento;
}

export interface LancamentoCalcInput {
  id: string;
  tipo: TipoLancamento;
  valor: number;
  vencimento: string;
  estornoDe: string;
  criadoEmMs: number;
}

export interface ResultadoCarteira {
  saldoDevedor: number;
  valorVencido: number;
  valorAVencer: number;
  proximoVencimento: string;
  comprasAtualizadas: Map<string, number>;
  estornadosIds: Set<string>;
}

/**
 * RN07 + RN09 + RN10 + RN21:
 * Recalcula todo o histórico do cliente:
 * - Ignora lançamentos estornados
 * - Abate pagamentos da compra em aberto de vencimento mais antigo primeiro (FIFO)
 * - Separa valorVencido e valorAVencer exatamente (valorVencido + valorAVencer === saldoDevedor)
 */
export function recalcularCarteiraCliente(
  lancamentos: LancamentoCalcInput[],
  hojeBahia: string = getBahiaDateString()
): ResultadoCarteira {
  const estornadosIds = new Set<string>();
  for (const item of lancamentos) {
    if (item.tipo === 'estorno' && item.estornoDe) {
      estornadosIds.add(item.estornoDe);
    }
  }

  const comprasAtivas = lancamentos
    .filter((l) => l.tipo === 'compra' && !estornadosIds.has(l.id))
    .sort((a, b) => {
      const cmpVenc = a.vencimento.localeCompare(b.vencimento);
      if (cmpVenc !== 0) return cmpVenc;
      return a.criadoEmMs - b.criadoEmMs;
    });

  let totalPagamentos = 0;
  for (const item of lancamentos) {
    if (item.tipo === 'pagamento' && !estornadosIds.has(item.id)) {
      totalPagamentos += item.valor;
    }
  }

  const comprasAtualizadas = new Map<string, number>();
  let restantePagamento = totalPagamentos;
  let valorVencido = 0;
  let valorAVencer = 0;
  let proximoVencimento = '';

  for (const compra of comprasAtivas) {
    const abatido = Math.min(compra.valor, restantePagamento);
    restantePagamento -= abatido;
    const emAberto = compra.valor - abatido;
    comprasAtualizadas.set(compra.id, emAberto);

    if (emAberto > 0) {
      if (isCompraVencida(compra.vencimento, emAberto, hojeBahia)) {
        valorVencido += emAberto;
      } else {
        valorAVencer += emAberto;
      }
      if (!proximoVencimento || compra.vencimento < proximoVencimento) {
        proximoVencimento = compra.vencimento;
      }
    }
  }

  const saldoDevedor = valorVencido + valorAVencer;

  return {
    saldoDevedor,
    valorVencido,
    valorAVencer,
    proximoVencimento,
    comprasAtualizadas,
    estornadosIds,
  };
}

export interface ValidacaoCompraResult {
  permitida: boolean;
  exigePinDono: boolean;
  novoSaldo: number;
  motivo?: string;
}

/**
 * RN04 + RN05: Bloqueia compra acima do limite salvo exceção autorizada com PIN do Dono.
 */
export function validarCompra(
  saldoDevedorAtual: number,
  valorCompra: number,
  limiteCredito: number,
  excecaoAutorizadaPorPin: boolean
): ValidacaoCompraResult {
  if (!Number.isInteger(valorCompra) || valorCompra <= 0) {
    return {
      permitida: false,
      exigePinDono: false,
      novoSaldo: saldoDevedorAtual,
      motivo: 'Informe um valor maior que R$ 0,00.',
    };
  }
  const novoSaldo = saldoDevedorAtual + valorCompra;
  if (novoSaldo > limiteCredito && !excecaoAutorizadaPorPin) {
    return {
      permitida: false,
      exigePinDono: true,
      novoSaldo,
      motivo: 'Compra acima do limite',
    };
  }
  return {
    permitida: true,
    exigePinDono: novoSaldo > limiteCredito,
    novoSaldo,
  };
}

export interface ValidacaoPagamentoResult {
  permitido: boolean;
  novoSaldo: number;
  motivo?: string;
}

/**
 * RN08: Pagamento parcial ou total, nunca maior que o saldo devedor.
 */
export function validarPagamento(
  saldoDevedorAtual: number,
  valorPagamento: number
): ValidacaoPagamentoResult {
  if (!Number.isInteger(valorPagamento) || valorPagamento <= 0) {
    return {
      permitido: false,
      novoSaldo: saldoDevedorAtual,
      motivo: 'Informe um valor maior que R$ 0,00.',
    };
  }
  if (saldoDevedorAtual <= 0) {
    return {
      permitido: false,
      novoSaldo: 0,
      motivo: 'Este cliente não possui saldo em aberto.',
    };
  }
  if (valorPagamento > saldoDevedorAtual) {
    return {
      permitido: false,
      novoSaldo: saldoDevedorAtual,
      motivo: 'O pagamento não pode ser maior que o saldo devedor.',
    };
  }
  return {
    permitido: true,
    novoSaldo: saldoDevedorAtual - valorPagamento,
  };
}

export interface AvaliacaoLinkInput {
  revogado: boolean;
  expiraEmMs: number;
  bloqueadoAteMs: number;
  tentativasErradas: number;
  agoraMs: number;
  hashEsperado: string;
  hashInformado: string;
}

export type StatusLinkConsulta = 'ok' | 'invalido_digitos' | 'expirado_ou_revogado' | 'bloqueado';

/**
 * RN19: Valida link público de consulta (/s/:token).
 */
export function avaliarLinkConsulta(input: AvaliacaoLinkInput): StatusLinkConsulta {
  if (input.revogado || input.expiraEmMs <= input.agoraMs) {
    return 'expirado_ou_revogado';
  }
  if (input.bloqueadoAteMs > input.agoraMs || input.tentativasErradas >= 5) {
    return 'bloqueado';
  }
  if (input.hashEsperado !== input.hashInformado) {
    return 'invalido_digitos';
  }
  return 'ok';
}

/**
 * Calcula percentual de limite usado (0 a 100+); retorna 0 se limite <= 0 ou saldo <= 0.
 */
export function percentualLimiteUsado(saldoDevedor: number, limiteCredito: number): number {
  if (!Number.isFinite(saldoDevedor) || !Number.isFinite(limiteCredito) || limiteCredito <= 0 || saldoDevedor <= 0) {
    return 0;
  }
  return (saldoDevedor / limiteCredito) * 100;
}

/**
 * Tarefa 2: Retorna true quando o cliente usou >= 80% e < 100% do limite de crédito.
 */
export function estaPertoDoLimite(saldoDevedor: number, limiteCredito: number): boolean {
  if (!Number.isFinite(saldoDevedor) || !Number.isFinite(limiteCredito) || limiteCredito <= 0 || saldoDevedor <= 0) {
    return false;
  }
  return saldoDevedor * 100 >= limiteCredito * 80 && saldoDevedor < limiteCredito;
}

/**
 * Tarefa 4: Calcula quantos dias corridos se passaram desde a data de vencimento YYYY-MM-DD
 * até a data de referência em America/Bahia. Retorna 0 se ainda não venceu.
 */
export function calcularDiasAtraso(
  vencimentoIso: string,
  hojeBahia: string = getBahiaDateString()
): number {
  if (
    !vencimentoIso ||
    !/^\d{4}-\d{2}-\d{2}$/.test(vencimentoIso) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(hojeBahia)
  ) {
    return 0;
  }
  const [vy, vm, vd] = vencimentoIso.split('-').map(Number);
  const [hy, hm, hd] = hojeBahia.split('-').map(Number);
  const vencMs = Date.UTC(vy, vm - 1, vd);
  const hojeMs = Date.UTC(hy, hm - 1, hd);
  const diff = Math.floor((hojeMs - vencMs) / 86_400_000);
  return Math.max(0, diff);
}

/**
 * Formata o número sequencial curto do lançamento:
 * #CMP-0012, #PAG-0012 ou #EST-0012.
 */
export function formatarNumeroLancamento(tipo: TipoLancamento, sequencia: number): string {
  const prefixo = tipo === 'compra' ? 'CMP' : tipo === 'pagamento' ? 'PAG' : 'EST';
  const safeSeq = Math.max(1, Math.round(sequencia));
  return `#${prefixo}-${String(safeSeq).padStart(4, '0')}`;
}

/**
 * Retorna o número curto para exibição (#PAG-0012) ou fallback com os
 * 6 últimos caracteres do ID em maiúsculas (#B9F34E) para lançamentos antigos.
 */
export function obterNumeroLancamentoExibicao(
  numero: string | undefined,
  lancamentoId: string
): string {
  const limpo = (numero ?? '').trim();
  if (limpo) {
    return limpo.startsWith('#') ? limpo : `#${limpo}`;
  }
  const suffix = lancamentoId.replace(/^#/, '').slice(-6).toUpperCase();
  return suffix ? `#${suffix}` : '#------';
}

const PREPOSICOES_NOME = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/**
 * Formata nome próprio em português (Title Case mantendo preposições em minúscula).
 */
export function formatarNomePropio(nome: string): string {
  const limpo = nome.trim();
  if (!limpo) return '';
  return limpo
    .split(/\s+/)
    .map((palavra, idx) => {
      const lower = palavra.toLocaleLowerCase('pt-BR');
      if (idx > 0 && PREPOSICOES_NOME.has(lower)) {
        return lower;
      }
      return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
    })
    .join(' ');
}

/**
 * RF17 / RN12: Regra central de bloqueio de envio pelo WhatsApp.
 * Retorna false se não houver consentimento OU se houver opt-out (semContatoWhatsapp)
 * OU se o cliente estiver anonimizado.
 */
export function podeEnviarWhatsApp(
  cliente:
    | {
        consentimentoWhatsapp?: boolean;
        semContatoWhatsapp?: boolean;
        anonimizado?: boolean;
        whatsapp?: string;
      }
    | null
    | undefined
): boolean {
  if (!cliente) return false;
  if (cliente.anonimizado || cliente.whatsapp === 'ANONIMIZADO') return false;
  if (!cliente.consentimentoWhatsapp) return false;
  if (cliente.semContatoWhatsapp) return false;
  return true;
}

export function motivoBloqueioWhatsApp(
  cliente:
    | {
        consentimentoWhatsapp?: boolean;
        semContatoWhatsapp?: boolean;
        anonimizado?: boolean;
        whatsapp?: string;
      }
    | null
    | undefined
): string {
  if (!cliente) return 'Dados do cliente indisponíveis para envio.';
  if (cliente.anonimizado || cliente.whatsapp === 'ANONIMIZADO') {
    return 'Envio bloqueado: cliente anonimizado pela LGPD.';
  }
  if (cliente.semContatoWhatsapp) {
    return 'Envio bloqueado: cliente pediu opt-out (não receber mensagens no WhatsApp).';
  }
  if (!cliente.consentimentoWhatsapp) {
    return 'Envio bloqueado: cliente sem consentimento registrado para WhatsApp.';
  }
  return '';
}

/**
 * RF19: Calcula a data limite de atendimento de solicitação do titular (padrão 15 dias).
 */
export function calcularDataPrazoSolicitacao(
  abertura: Date = new Date(),
  diasPrazo: number = 15
): Date {
  const diasValidos = Math.max(1, Math.min(90, Math.round(diasPrazo || 15)));
  return new Date(abertura.getTime() + diasValidos * 86_400_000);
}

export type SituacaoPrazoSolicitacao = 'atendida' | 'vencida' | 'perto_prazo' | 'no_prazo';

/**
 * RF19: Avalia se a solicitação está no prazo, perto do vencimento (<= 3 dias) ou vencida.
 */
export function avaliarPrazoSolicitacao(
  prazoEm: Date,
  status: StatusSolicitacaoTitular,
  agora: Date = new Date()
): { situacao: SituacaoPrazoSolicitacao; diasRestantes: number } {
  if (status === 'atendida') {
    return { situacao: 'atendida', diasRestantes: 0 };
  }
  const diffMs = prazoEm.getTime() - agora.getTime();
  const diasRestantes = Math.ceil(diffMs / 86_400_000);
  if (diffMs < 0) {
    return { situacao: 'vencida', diasRestantes };
  }
  if (diasRestantes <= 3) {
    return { situacao: 'perto_prazo', diasRestantes };
  }
  return { situacao: 'no_prazo', diasRestantes };
}
