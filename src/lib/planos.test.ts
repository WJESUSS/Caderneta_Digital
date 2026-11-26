import { describe, expect, it } from 'vitest';
import {
  avaliarUsoPlano,
  buildWhatsAppSuporteAssinaturaUrl,
  contarClientesAtivos,
  ErroLimitePlano,
  isErroLimitePlano,
  PLANOS_CONFIG,
  resolverPlanoComercio,
  verificarPermissaoAdicaoClientes,
} from './planos';

describe('Sistema de Planos e Limites (src/lib/planos.ts)', () => {
  it('define os 3 planos com limites e preços esperados', () => {
    expect(PLANOS_CONFIG.gratis.limiteClientesAtivos).toBe(20);
    expect(PLANOS_CONFIG.gratis.precoMensalCentavos).toBe(0);

    expect(PLANOS_CONFIG.basico.limiteClientesAtivos).toBe(100);
    expect(PLANOS_CONFIG.basico.precoMensalCentavos).toBe(2990);

    expect(PLANOS_CONFIG.pro.limiteClientesAtivos).toBeNull();
    expect(PLANOS_CONFIG.pro.precoMensalCentavos).toBe(5990);
  });

  it('conta apenas clientes com ativo == true e anonimizado == false', () => {
    const total = contarClientesAtivos([
      { ativo: true, anonimizado: false },
      { ativo: true, anonimizado: false },
      { ativo: false, anonimizado: false },
      { ativo: true, anonimizado: true },
      { ativo: false, anonimizado: true },
    ]);
    expect(total).toBe(2);
  });

  it('retorna plano Grátis quando não há documento de assinatura', () => {
    const res = resolverPlanoComercio(null, new Date('2026-06-01T12:00:00Z'));
    expect(res.planoId).toBe('gratis');
    expect(res.assinaturaAtiva).toBe(false);
    expect(res.expirada).toBe(false);
  });

  it('retorna plano Grátis marcado como expirado quando validoAte já passou', () => {
    const agora = new Date('2026-06-10T12:00:00Z');
    const expirado = new Date('2026-06-09T23:59:59Z');
    const res = resolverPlanoComercio({ plano: 'basico', validoAte: expirado }, agora);
    expect(res.planoId).toBe('gratis');
    expect(res.assinaturaAtiva).toBe(false);
    expect(res.expirada).toBe(true);
    expect(res.validoAte?.getTime()).toBe(expirado.getTime());
  });

  it('ativa plano Básico ou Pro quando validoAte está no futuro', () => {
    const agora = new Date('2026-06-10T12:00:00Z');
    const futuro = new Date('2026-07-10T12:00:00Z');

    const basico = resolverPlanoComercio({ plano: 'basico', validoAte: futuro }, agora);
    expect(basico.planoId).toBe('basico');
    expect(basico.assinaturaAtiva).toBe(true);
    expect(basico.expirada).toBe(false);

    const pro = resolverPlanoComercio({ plano: 'pro', validoAte: futuro }, agora);
    expect(pro.planoId).toBe('pro');
    expect(pro.assinaturaAtiva).toBe(true);
  });

  it('sinaliza aviso a partir de 80% do limite e bloqueio a partir de 100%', () => {
    const gratis = resolverPlanoComercio(null);

    const abaixo = avaliarUsoPlano(15, gratis);
    expect(abaixo.pertoDoLimite).toBe(false);
    expect(abaixo.noLimite).toBe(false);
    expect(abaixo.textoUso).toBe('15 de 20 clientes');

    const aviso = avaliarUsoPlano(16, gratis);
    expect(aviso.pertoDoLimite).toBe(true);
    expect(aviso.noLimite).toBe(false);
    expect(aviso.percentual).toBe(80);
    expect(verificarPermissaoAdicaoClientes(aviso, 1).permitido).toBe(true);

    const limite = avaliarUsoPlano(20, gratis);
    expect(limite.pertoDoLimite).toBe(false);
    expect(limite.noLimite).toBe(true);
    expect(limite.excedido).toBe(false);
    expect(limite.vagasRestantes).toBe(0);
    expect(verificarPermissaoAdicaoClientes(limite, 1).permitido).toBe(false);

    const acima = avaliarUsoPlano(25, gratis);
    expect(acima.noLimite).toBe(true);
    expect(acima.excedido).toBe(true);
    expect(verificarPermissaoAdicaoClientes(acima, 1).permitido).toBe(false);
  });

  it('bloqueia adição em lote (dados de exemplo) quando soma ultrapassa limite', () => {
    const gratis = resolverPlanoComercio(null);
    const uso15 = avaliarUsoPlano(15, gratis);

    // 15 + 5 <= 20: permitido
    expect(verificarPermissaoAdicaoClientes(uso15, 5).permitido).toBe(true);
    // 15 + 9 > 20: bloqueado
    const negado = verificarPermissaoAdicaoClientes(uso15, 9);
    expect(negado.permitido).toBe(false);
    expect(negado.mensagem).toContain('9 clientes de exemplo');
  });

  it('permite clientes ilimitados no plano Pro', () => {
    const pro = resolverPlanoComercio(
      { plano: 'pro', validoAte: new Date('2099-01-01T00:00:00Z') },
      new Date('2026-06-01T00:00:00Z')
    );
    const uso = avaliarUsoPlano(1500, pro);
    expect(uso.limite).toBeNull();
    expect(uso.pertoDoLimite).toBe(false);
    expect(uso.noLimite).toBe(false);
    expect(uso.textoUso).toBe('1500 clientes ativos (ilimitado)');
    expect(verificarPermissaoAdicaoClientes(uso, 50).permitido).toBe(true);
  });

  it('gera link de WhatsApp com nome do comércio, ID e plano escolhido', () => {
    const url = buildWhatsAppSuporteAssinaturaUrl({
      whatsappSuporte: '(71) 99999-8888',
      comercioNome: 'Mercadinho Bom Preço',
      comercioId: 'com_12345',
      plano: PLANOS_CONFIG.basico,
    });
    expect(url).not.toBeNull();
    expect(url).toContain('https://wa.me/5571999998888?text=');
    const decoded = decodeURIComponent((url || '').split('?text=')[1]);
    expect(decoded).toContain('Mercadinho Bom Preço');
    expect(decoded).toContain('com_12345');
    expect(decoded).toContain('Básico');
  });

  it('identifica ErroLimitePlano corretamente', () => {
    const err = new ErroLimitePlano('Limite atingido', 'gratis', 20, 20);
    expect(isErroLimitePlano(err)).toBe(true);
    expect(isErroLimitePlano(new Error('Outro erro'))).toBe(false);
  });
});
