import { describe, expect, it } from 'vitest';
import {
  avaliarLinkConsulta,
  calcularVencimentoCompra,
  isCompraVencida,
  recalcularCarteiraCliente,
  validarCompra,
  validarPagamento,
  type LancamentoCalcInput,
} from './businessRules';
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
