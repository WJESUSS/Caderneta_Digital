import { normalizeWhatsAppBR } from './businessRules';

export type TipoChavePix = 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria';

export interface ValidacaoChavePixResult {
  valida: boolean;
  tipo?: TipoChavePix;
  tipoLabel?: string;
  chaveNormalizada?: string;
  erro?: string;
}

const TIPO_LABEL: Record<TipoChavePix, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'E-mail',
  telefone: 'Celular/Telefone',
  aleatoria: 'Chave aleatória',
};

export function validarCPF(cpfDigits: string): boolean {
  if (!/^\d{11}$/.test(cpfDigits)) return false;
  if (/^(\d)\1{10}$/.test(cpfDigits)) return false;

  let soma = 0;
  for (let i = 0; i < 9; i++) {
    soma += Number(cpfDigits[i]) * (10 - i);
  }
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== Number(cpfDigits[9])) return false;

  soma = 0;
  for (let i = 0; i < 10; i++) {
    soma += Number(cpfDigits[i]) * (11 - i);
  }
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  return resto === Number(cpfDigits[10]);
}

export function validarCNPJ(cnpjDigits: string): boolean {
  if (!/^\d{14}$/.test(cnpjDigits)) return false;
  if (/^(\d)\1{13}$/.test(cnpjDigits)) return false;

  const calcDigit = (base: string, weights: number[]) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += Number(base[i]) * weights[i];
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calcDigit(cnpjDigits, w1);
  if (d1 !== Number(cnpjDigits[12])) return false;

  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d2 = calcDigit(cnpjDigits, w2);
  return d2 === Number(cnpjDigits[13]);
}

/**
 * Valida e normaliza uma chave Pix conforme padrões do Banco Central do Brasil:
 * - Chave aleatória (EVP UUID)
 * - E-mail
 * - Telefone (+55 + DDD + 10 ou 11 dígitos)
 * - CPF (11 dígitos com DV válido)
 * - CNPJ (14 dígitos com DV válido)
 */
export function validarChavePix(raw: string): ValidacaoChavePixResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valida: false, erro: 'Informe a chave Pix.' };
  }

  // 1. Chave aleatória (UUID v4)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    const norm = trimmed.toLowerCase();
    return {
      valida: true,
      tipo: 'aleatoria',
      tipoLabel: TIPO_LABEL.aleatoria,
      chaveNormalizada: norm,
    };
  }

  // 2. E-mail
  if (trimmed.includes('@')) {
    const norm = trimmed.toLowerCase();
    if (norm.length <= 77 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(norm)) {
      return {
        valida: true,
        tipo: 'email',
        tipoLabel: TIPO_LABEL.email,
        chaveNormalizada: norm,
      };
    }
    return { valida: false, erro: 'E-mail inválido para chave Pix.' };
  }

  const digits = trimmed.replace(/\D/g, '');
  const temFormatoTelefone = trimmed.startsWith('+') || /[()\s]/.test(trimmed);
  const temFormatoDocumento = /[./]/.test(trimmed) || /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(trimmed);

  // 3. Telefone explícito (+55, parênteses ou espaços)
  if (temFormatoTelefone) {
    const e164 = normalizeWhatsAppBR(trimmed);
    if (e164) {
      return {
        valida: true,
        tipo: 'telefone',
        tipoLabel: TIPO_LABEL.telefone,
        chaveNormalizada: e164,
      };
    }
    return { valida: false, erro: 'Celular Pix inválido. Use DDD + número (ex: +5571999999999).' };
  }

  // 4. CNPJ (14 dígitos)
  if (digits.length === 14) {
    if (validarCNPJ(digits)) {
      return {
        valida: true,
        tipo: 'cnpj',
        tipoLabel: TIPO_LABEL.cnpj,
        chaveNormalizada: digits,
      };
    }
    return { valida: false, erro: 'CNPJ inválido para chave Pix.' };
  }

  // 5. Telefone com DDI 55 sem '+' (12 ou 13 dígitos)
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55') && !temFormatoDocumento) {
    const e164 = normalizeWhatsAppBR(digits);
    if (e164) {
      return {
        valida: true,
        tipo: 'telefone',
        tipoLabel: TIPO_LABEL.telefone,
        chaveNormalizada: e164,
      };
    }
  }

  // 6. CPF (11 dígitos) ou celular sem +55 (11 dígitos)
  if (digits.length === 11) {
    if (validarCPF(digits)) {
      return {
        valida: true,
        tipo: 'cpf',
        tipoLabel: TIPO_LABEL.cpf,
        chaveNormalizada: digits,
      };
    }
    if (!temFormatoDocumento) {
      const e164 = normalizeWhatsAppBR(digits);
      if (e164 && digits[2] === '9') {
        return {
          valida: true,
          tipo: 'telefone',
          tipoLabel: TIPO_LABEL.telefone,
          chaveNormalizada: e164,
        };
      }
    }
    return {
      valida: false,
      erro: 'CPF ou celular inválido. Para celular, prefira incluir +55 com DDD (ex: +5571999999999).',
    };
  }

  // 7. Telefone fixo sem +55 (10 dígitos)
  if (digits.length === 10 && !temFormatoDocumento) {
    const e164 = normalizeWhatsAppBR(digits);
    if (e164) {
      return {
        valida: true,
        tipo: 'telefone',
        tipoLabel: TIPO_LABEL.telefone,
        chaveNormalizada: e164,
      };
    }
  }

  return {
    valida: false,
    erro: 'Chave Pix inválida. Use CPF, CNPJ, e-mail, celular (+55...) ou chave aleatória.',
  };
}

/**
 * Calcula CRC-16/CCITT-FALSE (polinômio 0x1021, valor inicial 0xFFFF)
 * exigido pelo padrão EMVCo / BR Code do Banco Central.
 */
export function crc16CCITT(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= (payload.charCodeAt(i) & 0xff) << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(id: string, value: string): string {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

function sanitizePixField(text: string, maxLen: number, fallback: string): string {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 .\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, maxLen);
  return normalized || fallback;
}

export interface PixStaticPayloadParams {
  chavePix: string;
  nomeRecebedor: string;
  cidade?: string;
  valorCentavos?: number | null;
  txid?: string;
}

/**
 * Gera payload Pix estático no padrão BR Code EMV com CRC16.
 * Nunca dispara cobrança ou baixa automática — gera apenas o código para leitura no app do banco.
 */
export function gerarPayloadPixEstatico(params: PixStaticPayloadParams): string {
  const valid = validarChavePix(params.chavePix);
  const chave = valid.valida && valid.chaveNormalizada ? valid.chaveNormalizada : params.chavePix.trim();
  const nome = sanitizePixField(params.nomeRecebedor, 25, 'COMERCIO');
  const cidade = sanitizePixField(params.cidade || 'SALVADOR', 15, 'SALVADOR');
  const txidClean = (params.txid || '***').replace(/[^A-Za-z0-9*]/g, '').slice(0, 25) || '***';

  const merchantAccountInfo = tlv('00', 'br.gov.bcb.pix') + tlv('01', chave);
  const additionalData = tlv('05', txidClean);

  const parts = [
    tlv('00', '01'),
    tlv('26', merchantAccountInfo),
    tlv('52', '0000'),
    tlv('53', '986'),
  ];

  if (typeof params.valorCentavos === 'number' && params.valorCentavos > 0) {
    parts.push(tlv('54', (params.valorCentavos / 100).toFixed(2)));
  }

  parts.push(
    tlv('58', 'BR'),
    tlv('59', nome),
    tlv('60', cidade),
    tlv('62', additionalData)
  );

  const bodyWithoutCrc = `${parts.join('')}6304`;
  return `${bodyWithoutCrc}${crc16CCITT(bodyWithoutCrc)}`;
}
