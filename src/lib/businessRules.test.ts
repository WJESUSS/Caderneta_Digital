import { describe, expect, it } from 'vitest';
import {
  avaliarLinkConsulta,
  avaliarPrazoSolicitacao,
  calcularDataPrazoSolicitacao,
  calcularDiasAtraso,
  calcularVencimentoCompra,
  estaPertoDoLimite,
  formatarNomePropio,
  formatarNumeroLancamento,
  isCompraVencida,
  obterNumeroLancamentoExibicao,
  percentualLimiteUsado,
  podeEnviarWhatsApp,
  recalcularCarteiraCliente,
  validarCompra,
  validarPagamento,
  type LancamentoCalcInput,
} from './businessRules';
import { crc16CCITT, gerarPayloadPixEstatico, validarChavePix } from './pix';
import { checkPublicUrlSafety, resolveAppPublicUrl } from './qrUrl';

describe('RN04 e RN05 - Limite de crédito e exceção', () => {
  it('permite compra dentro do limite', () => {
    const r = validarCompra(10000, 5000, 20000, false);
    expect(r.permitida).toBe(true);
    expect(r.exigePinDono).toBe(false);
    expect(r.novoSaldo).toBe(15000);
  });

  it('bloqueia compra acima do limite sem PIN do Dono', () => {
    const r = validarCompra(18000, 5000, 20000, false);
    expect(r.permitida).toBe(false);
    expect(r.exigePinDono).toBe(true);
    expect(r.motivo).toBe('Compra acima do limite');
  });

  it('permite compra acima do limite quando autorizada com PIN do Dono', () => {
    const r = validarCompra(18000, 5000, 20000, true);
    expect(r.permitida).toBe(true);
    expect(r.novoSaldo).toBe(23000);
  });
});

describe('RN08 - Pagamento parcial, total e bloqueio acima do saldo', () => {
  it('bloqueia pagamento maior que o saldo devedor', () => {
    const r = validarPagamento(10000, 10001);
    expect(r.permitido).toBe(false);
  });

  it('permite pagamento parcial e total', () => {
    const parcial = validarPagamento(10000, 4000);
    expect(parcial.permitido).toBe(true);
    expect(parcial.novoSaldo).toBe(6000);

    const total = validarPagamento(10000, 10000);
    expect(total.permitido).toBe(true);
    expect(total.novoSaldo).toBe(0);
  });
});

describe('RN14 - Vencimento e atraso em America/Bahia', () => {
  it('usa o próprio dia quando a compra ocorre no dia do vencimento', () => {
    const d = new Date('2026-03-10T15:00:00-03:00');
    expect(calcularVencimentoCompra(d, 10)).toBe('2026-03-10');
  });

  it('avança para o mês seguinte quando já passou do dia de vencimento', () => {
    const d = new Date('2026-03-15T15:00:00-03:00');
    expect(calcularVencimentoCompra(d, 10)).toBe('2026-04-10');
  });

  it('trata virada de ano corretamente', () => {
    const d = new Date('2026-12-20T15:00:00-03:00');
    expect(calcularVencimentoCompra(d, 5)).toBe('2027-01-05');
  });

  it('trata dias 29-31 em fevereiro sem vazar para março', () => {
    const d = new Date('2026-02-05T15:00:00-03:00');
    expect(calcularVencimentoCompra(d, 31)).toBe('2026-02-28');
  });

  it('só considera vencida a partir do dia seguinte ao vencimento', () => {
    expect(isCompraVencida('2026-05-10', 5000, '2026-05-10')).toBe(false);
    expect(isCompraVencida('2026-05-10', 5000, '2026-05-11')).toBe(true);
    expect(isCompraVencida('2026-05-10', 0, '2026-05-15')).toBe(false);
  });
});

describe('RN09, RN21 e RN07 - Saldo, abatimento FIFO e estorno', () => {
  it('abate compra de vencimento mais antigo primeiro e separa vencido/a vencer', () => {
    const lancs: LancamentoCalcInput[] = [
      { id: 'c1', tipo: 'compra', valor: 10000, vencimento: '2026-04-05', estornoDe: '', criadoEmMs: 1 },
      { id: 'c2', tipo: 'compra', valor: 8000, vencimento: '2026-05-05', estornoDe: '', criadoEmMs: 2 },
      { id: 'p1', tipo: 'pagamento', valor: 12000, vencimento: '', estornoDe: '', criadoEmMs: 3 },
    ];
    // Hoje = 2026-04-20 (c1 estaria vencida se tivesse aberto, c2 é a vencer)
    const r = recalcularCarteiraCliente(lancs, '2026-04-20');
    expect(r.comprasAtualizadas.get('c1')).toBe(0);
    expect(r.comprasAtualizadas.get('c2')).toBe(6000);
    expect(r.saldoDevedor).toBe(6000);
    expect(r.valorVencido).toBe(0);
    expect(r.valorAVencer).toBe(6000);
  });

  it('compra recente não fica vencida por existir outra antiga em atraso', () => {
    const lancs: LancamentoCalcInput[] = [
      { id: 'c1', tipo: 'compra', valor: 5000, vencimento: '2026-04-05', estornoDe: '', criadoEmMs: 1 },
      { id: 'c2', tipo: 'compra', valor: 7000, vencimento: '2026-05-05', estornoDe: '', criadoEmMs: 2 },
    ];
    const r = recalcularCarteiraCliente(lancs, '2026-04-10');
    expect(r.valorVencido).toBe(5000);
    expect(r.valorAVencer).toBe(7000);
    expect(r.saldoDevedor).toBe(12000);
  });

  it('estorno de pagamento recalcula saldo e valorEmAberto corretamente', () => {
    const lancs: LancamentoCalcInput[] = [
      { id: 'c1', tipo: 'compra', valor: 10000, vencimento: '2026-04-05', estornoDe: '', criadoEmMs: 1 },
      { id: 'p1', tipo: 'pagamento', valor: 10000, vencimento: '', estornoDe: '', criadoEmMs: 2 },
      { id: 'e1', tipo: 'estorno', valor: 10000, vencimento: '', estornoDe: 'p1', criadoEmMs: 3 },
    ];
    const r = recalcularCarteiraCliente(lancs, '2026-04-10');
    expect(r.saldoDevedor).toBe(10000);
    expect(r.valorVencido).toBe(10000);
    expect(r.comprasAtualizadas.get('c1')).toBe(10000);
  });
});

describe('RN19 - Link público de consulta de saldo', () => {
  const base = {
    revogado: false,
    expiraEmMs: 2_000_000,
    bloqueadoAteMs: 0,
    tentativasErradas: 0,
    agoraMs: 1_000_000,
    hashEsperado: 'abc',
    hashInformado: 'abc',
  };

  it('permite consulta quando válido e dígitos conferem', () => {
    expect(avaliarLinkConsulta(base)).toBe('ok');
  });

  it('bloqueia link expirado ou revogado', () => {
    expect(avaliarLinkConsulta({ ...base, revogado: true })).toBe('expirado_ou_revogado');
    expect(avaliarLinkConsulta({ ...base, expiraEmMs: 999_999 })).toBe('expirado_ou_revogado');
  });

  it('bloqueia após 5 erros ou dentro da janela de bloqueio', () => {
    expect(avaliarLinkConsulta({ ...base, tentativasErradas: 5 })).toBe('bloqueado');
    expect(avaliarLinkConsulta({ ...base, bloqueadoAteMs: 1_500_000 })).toBe('bloqueado');
  });
});

describe('QR Code - URL de produção', () => {
  it('usa VITE_APP_PUBLIC_URL quando definida e nunca localhost', () => {
    const url = resolveAppPublicUrl('https://caderneta-prod.run.app/', 'http://localhost:3000');
    expect(url).toBe('https://caderneta-prod.run.app');
    expect(url).not.toContain('localhost');
    expect(checkPublicUrlSafety(url).isUnsafe).toBe(false);
  });

  it('emite aviso quando aponta para localhost ou HTTP sem TLS', () => {
    expect(checkPublicUrlSafety('http://localhost:3000').isUnsafe).toBe(true);
    expect(checkPublicUrlSafety('http://caderneta.exemplo.com').isUnsafe).toBe(true);
  });
});

describe('Tarefa 1 - Validação de Chave Pix e BR Code EMV com CRC16', () => {
  it('valida CPF, CNPJ, e-mail, celular e chave aleatória corretamente', () => {
    expect(validarChavePix('52998224725')).toMatchObject({
      valida: true,
      tipo: 'cpf',
      chaveNormalizada: '52998224725',
    });
    expect(validarChavePix('111.111.111-11').valida).toBe(false);

    expect(validarChavePix('11.222.333/0001-81')).toMatchObject({
      valida: true,
      tipo: 'cnpj',
      chaveNormalizada: '11222333000181',
    });
    expect(validarChavePix('11.222.333/0001-00').valida).toBe(false);

    expect(validarChavePix('Loja@Exemplo.COM')).toMatchObject({
      valida: true,
      tipo: 'email',
      chaveNormalizada: 'loja@exemplo.com',
    });

    expect(validarChavePix('(71) 99999-8888')).toMatchObject({
      valida: true,
      tipo: 'telefone',
      chaveNormalizada: '+5571999998888',
    });

    expect(validarChavePix('123E4567-E89B-12D3-A456-426614174000')).toMatchObject({
      valida: true,
      tipo: 'aleatoria',
      chaveNormalizada: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(validarChavePix('').valida).toBe(false);
    expect(validarChavePix('chave-invalida').valida).toBe(false);
  });

  it('calcula CRC16-CCITT padrão corretamente', () => {
    expect(crc16CCITT('123456789')).toBe('29B1');
  });

  it('gera BR Code EMV estático válido com e sem valor', () => {
    const semValor = gerarPayloadPixEstatico({
      chavePix: 'loja@exemplo.com',
      nomeRecebedor: 'Mercadinho São José',
    });
    expect(semValor.startsWith('000201')).toBe(true);
    expect(semValor).toContain('br.gov.bcb.pix');
    expect(semValor).toContain('5919MERCADINHO SAO JOSE');
    expect(semValor).not.toContain('540');

    const bodySemValor = semValor.slice(0, -4);
    const crcSemValor = semValor.slice(-4);
    expect(crc16CCITT(bodySemValor)).toBe(crcSemValor);

    const comValor = gerarPayloadPixEstatico({
      chavePix: 'loja@exemplo.com',
      nomeRecebedor: 'Mercadinho São José',
      valorCentavos: 2550,
    });
    expect(comValor).toContain('540525.50');
    const bodyComValor = comValor.slice(0, -4);
    const crcComValor = comValor.slice(-4);
    expect(crc16CCITT(bodyComValor)).toBe(crcComValor);
  });
});

describe('Tarefa 2 - Percentual de limite usado e selo Perto do limite', () => {
  it('calcula percentual usado com segurança para limites zerados', () => {
    expect(percentualLimiteUsado(8000, 10000)).toBe(80);
    expect(percentualLimiteUsado(5000, 0)).toBe(0);
    expect(percentualLimiteUsado(0, 10000)).toBe(0);
  });

  it('marca perto do limite apenas entre >= 80% e < 100%', () => {
    expect(estaPertoDoLimite(7999, 10000)).toBe(false);
    expect(estaPertoDoLimite(8000, 10000)).toBe(true);
    expect(estaPertoDoLimite(9999, 10000)).toBe(true);
    expect(estaPertoDoLimite(10000, 10000)).toBe(false);
    expect(estaPertoDoLimite(12000, 10000)).toBe(false);
    expect(estaPertoDoLimite(5000, 0)).toBe(false);
  });
});

describe('Tarefa 4 - Cálculo de dias de atraso', () => {
  it('calcula dias de atraso corretamente a partir do vencimento mais antigo', () => {
    expect(calcularDiasAtraso('2026-05-10', '2026-05-10')).toBe(0);
    expect(calcularDiasAtraso('2026-05-10', '2026-05-08')).toBe(0);
    expect(calcularDiasAtraso('2026-05-10', '2026-05-11')).toBe(1);
    expect(calcularDiasAtraso('2026-05-10', '2026-05-17')).toBe(7);
    expect(calcularDiasAtraso('2026-05-10', '2026-05-26')).toBe(16);
    expect(calcularDiasAtraso('', '2026-05-26')).toBe(0);
  });
});

describe('Recibo e comprovante - Número curto e formatação de nome próprio', () => {
  it('gera números curtos #CMP-XXXX, #PAG-XXXX e #EST-XXXX com 4 dígitos', () => {
    expect(formatarNumeroLancamento('compra', 1)).toBe('#CMP-0001');
    expect(formatarNumeroLancamento('pagamento', 12)).toBe('#PAG-0012');
    expect(formatarNumeroLancamento('estorno', 1045)).toBe('#EST-1045');
    expect(formatarNumeroLancamento('pagamento', 12345)).toBe('#PAG-12345');
  });

  it('usa o campo numero quando presente e faz fallback com os 6 últimos caracteres do ID', () => {
    expect(obterNumeroLancamentoExibicao('#PAG-0012', 'lnc_1795456211240_c1d0e22e43b9f34e')).toBe('#PAG-0012');
    expect(obterNumeroLancamentoExibicao('CMP-0005', 'lnc_123')).toBe('#CMP-0005');
    expect(obterNumeroLancamentoExibicao(undefined, 'lnc_1795456211240_c1d0e22e43b9f34e')).toBe('#B9F34E');
    expect(obterNumeroLancamentoExibicao('', 'pag_abc123')).toBe('#ABC123');
  });

  it('formata nome próprio preservando preposições de, da, do, das, dos e e em minúscula', () => {
    expect(formatarNomePropio('WASHINGTON JESUS DOS SANTOS')).toBe('Washington Jesus dos Santos');
    expect(formatarNomePropio('  maria   da   silva  e  souza ')).toBe('Maria da Silva e Souza');
    expect(formatarNomePropio('joão DE oliveira')).toBe('João de Oliveira');
    expect(formatarNomePropio('ANA DAS DORES DO CARMO')).toBe('Ana das Dores do Carmo');
    expect(formatarNomePropio('   ')).toBe('');
  });
});

describe('RF17 / RN12 - Opt-out e bloqueio de envio por WhatsApp', () => {
  it('permite envio para cliente com consentimento e sem opt-out', () => {
    expect(
      podeEnviarWhatsApp({
        consentimentoWhatsapp: true,
        semContatoWhatsapp: false,
        anonimizado: false,
        whatsapp: '+5571999998888',
      })
    ).toBe(true);
  });

  it('bloqueia envio quando cliente tem opt-out (mesmo mantendo consentimentoWhatsapp true)', () => {
    expect(
      podeEnviarWhatsApp({
        consentimentoWhatsapp: true,
        semContatoWhatsapp: true,
        anonimizado: false,
        whatsapp: '+5571999998888',
      })
    ).toBe(false);
  });

  it('bloqueia envio para cliente sem consentimento ou anonimizado', () => {
    expect(
      podeEnviarWhatsApp({
        consentimentoWhatsapp: false,
        semContatoWhatsapp: false,
        anonimizado: false,
        whatsapp: '+5571999998888',
      })
    ).toBe(false);
    expect(
      podeEnviarWhatsApp({
        consentimentoWhatsapp: true,
        semContatoWhatsapp: false,
        anonimizado: true,
        whatsapp: 'ANONIMIZADO',
      })
    ).toBe(false);
  });
});

describe('RF19 - Prazo de solicitações do titular (LGPD)', () => {
  it('calcula prazo padrão de 15 dias e identifica no prazo, perto do prazo e vencida', () => {
    const abertura = new Date('2026-11-01T12:00:00Z');
    const prazo = calcularDataPrazoSolicitacao(abertura, 15);
    expect(prazo.toISOString()).toBe('2026-11-16T12:00:00.000Z');

    expect(avaliarPrazoSolicitacao(prazo, 'aberta', new Date('2026-11-10T12:00:00Z')).situacao).toBe('no_prazo');
    expect(avaliarPrazoSolicitacao(prazo, 'aberta', new Date('2026-11-14T12:00:00Z')).situacao).toBe('perto_prazo');
    expect(avaliarPrazoSolicitacao(prazo, 'aberta', new Date('2026-11-17T12:00:00Z')).situacao).toBe('vencida');
    expect(avaliarPrazoSolicitacao(prazo, 'atendida', new Date('2026-11-20T12:00:00Z')).situacao).toBe('atendida');
  });
});
