import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cliente, Lancamento } from './businessRules';

// Simulador fiel em memória do Firestore + regras de acesso para testar todo o fluxo sem depender de localStorage
type StoreDoc = Record<string, unknown>;

const sim = vi.hoisted(() => {
  const collections = new Map<string, Map<string, StoreDoc>>();
  const state = {
    currentUid: 'uid_dono' as string | null,
    nowMs: Date.now(),
  };

  class MockTimestamp {
    readonly seconds: number;
    readonly nanoseconds: number;
    constructor(seconds: number, nanoseconds = 0) {
      this.seconds = seconds;
      this.nanoseconds = nanoseconds;
    }
    toDate() {
      return new Date(this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000));
    }
    static fromDate(d: Date) {
      return MockTimestamp.fromMillis(d.getTime());
    }
    static fromMillis(ms: number) {
      const secs = Math.floor(ms / 1000);
      const nanos = (ms % 1000) * 1_000_000;
      return new MockTimestamp(secs, nanos);
    }
  }

  function getCol(name: string) {
    let c = collections.get(name);
    if (!c) {
      c = new Map<string, StoreDoc>();
      collections.set(name, c);
    }
    return c;
  }

  function resolveSentinels(data: StoreDoc): StoreDoc {
    const out: StoreDoc = {};
    for (const [k, v] of Object.entries(data)) {
      out[k] = v === '__SERVER_TIMESTAMP__' ? MockTimestamp.fromMillis(state.nowMs) : v;
    }
    return out;
  }

  function isMembro(comercioId: string): boolean {
    if (!state.currentUid) return false;
    const u = getCol('usuarios').get(state.currentUid);
    return Boolean(u && u.ativo === true && u.comercioId === comercioId);
  }

  function checkConsultaPublicaGetAllowed(data: StoreDoc | undefined): boolean {
    if (!data) {
      throw new Error('Missing or insufficient permissions.');
    }
    if (isMembro(String(data.comercioId))) return true;
    const revogado = Boolean(data.revogado);
    const expiraMs = (data.expiraEm as MockTimestamp).toDate().getTime();
    const bloqueadoMs = (data.bloqueadoAte as MockTimestamp).toDate().getTime();
    if (!revogado && expiraMs > state.nowMs && bloqueadoMs <= state.nowMs) {
      return true;
    }
    throw new Error('Missing or insufficient permissions.');
  }

  return {
    collections,
    state,
    MockTimestamp,
    getCol,
    resolveSentinels,
    checkConsultaPublicaGetAllowed,
  };
});

vi.mock('firebase/firestore', () => {
  return {
    Timestamp: sim.MockTimestamp,
    serverTimestamp: () => '__SERVER_TIMESTAMP__',
    collection: (_db: unknown, name: string) => ({ __type: 'col', name }),
    doc: (_db: unknown, colName: string, id: string) => ({
      __type: 'doc',
      colName,
      id,
      path: `${colName}/${id}`,
    }),
    query: (colRef: { name: string }, ...constraints: Array<{ field: string; value: unknown }>) => ({
      __type: 'query',
      colName: colRef.name,
      constraints,
    }),
    where: (field: string, _op: string, value: unknown) => ({ field, value }),
    orderBy: () => ({}),
    onSnapshot: () => () => {},
    runTransaction: async () => {},
    getDoc: async (docRef: { colName: string; id: string }) => {
      const data = sim.getCol(docRef.colName).get(docRef.id);
      if (docRef.colName === 'consultasPublicas') {
        sim.checkConsultaPublicaGetAllowed(data);
      }
      return {
        id: docRef.id,
        exists: () => Boolean(data),
        data: () => data,
      };
    },
    getDocFromServer: async (docRef: { colName: string; id: string }) => {
      const data = sim.getCol(docRef.colName).get(docRef.id);
      if (docRef.colName === 'consultasPublicas') {
        sim.checkConsultaPublicaGetAllowed(data);
      }
      return {
        id: docRef.id,
        exists: () => Boolean(data),
        data: () => data,
      };
    },
    getDocs: async (q: { colName: string; constraints: Array<{ field: string; value: unknown }> }) => {
      const entries = Array.from(sim.getCol(q.colName).entries()).filter(([, d]) =>
        q.constraints.every((c) => !c.field || d[c.field] === c.value)
      );
      return {
        docs: entries.map(([id, d]) => ({
          id,
          ref: { __type: 'doc', colName: q.colName, id },
          data: () => d,
        })),
      };
    },
    writeBatch: () => {
      const ops: Array<() => void> = [];
      const batchObj = {
        set: (ref: { colName: string; id: string }, data: StoreDoc) => {
          ops.push(() => {
            sim.getCol(ref.colName).set(ref.id, sim.resolveSentinels(data));
          });
          return batchObj;
        },
        update: (ref: { colName: string; id: string }, partial: StoreDoc) => {
          ops.push(() => {
            const existing = sim.getCol(ref.colName).get(ref.id);
            if (!existing) throw new Error(`NOT_FOUND: ${ref.colName}/${ref.id}`);
            sim.getCol(ref.colName).set(ref.id, { ...existing, ...sim.resolveSentinels(partial) });
          });
          return batchObj;
        },
        commit: async () => {
          for (const op of ops) op();
        },
      };
      return batchObj;
    },
  };
});

vi.mock('./firebase', () => ({
  db: {},
  OperationType: {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    GET: 'get',
    WRITE: 'write',
  },
  handleFirestoreError: (err: unknown) => {
    throw err instanceof Error ? err : new Error(String(err));
  },
}));

import {
  consultarSaldoPublicoPorToken,
  editarCliente,
  gerarLinkConsulta,
  revogarLinkConsulta,
} from './firestoreService';

const COMERCIO_ID = 'com_teste_01';

const clienteBase: Cliente = {
  id: 'cli_teste_01',
  comercioId: COMERCIO_ID,
  nome: 'Maria das Graças Santos',
  whatsapp: '+5571988884321',
  consentimentoWhatsapp: true,
  consentimentoEm: new Date(),
  semContatoWhatsapp: false,
  limiteCredito: 50000,
  diaVencimento: 10,
  ativo: true,
  anonimizado: false,
  saldoDevedor: 12000,
  valorVencido: 5000,
  valorAVencer: 7000,
  proximoVencimento: '2026-12-10',
  observacaoDono: '',
  criadoEm: new Date(),
  atualizadoEm: new Date(),
};

const lancamentosBase: Lancamento[] = [
  {
    id: 'lnc_01',
    numero: '#CMP-0001',
    comercioId: COMERCIO_ID,
    clienteId: clienteBase.id,
    tipo: 'compra',
    valor: 12000,
    forma: 'fiado',
    itens: 'Feijão, arroz e café',
    vencimento: '2026-11-10',
    valorEmAberto: 12000,
    autorizadoExcecaoPor: '',
    estornoDe: '',
    justificativa: '',
    idempotencyKey: 'cmp_12345678',
    criadoPor: 'uid_dono',
    criadoEm: new Date('2026-11-01T12:00:00Z'),
  },
];

describe('Fluxo completo de link público de consulta (/s/:token)', () => {
  beforeEach(() => {
    sim.collections.clear();
    sim.state.nowMs = Date.now();
    sim.state.currentUid = 'uid_dono';

    sim.getCol('comercios').set(COMERCIO_ID, {
      nome: 'Mercadinho Central',
      pixChave: '71988880000',
      pixRecebedor: 'Mercadinho Central',
      whatsappContato: '+5571988880000',
    });
    sim.getCol('usuarios').set('uid_dono', {
      comercioId: COMERCIO_ID,
      perfil: 'dono',
      ativo: true,
    });
    sim.getCol('usuarios').set('uid_atendente', {
      comercioId: COMERCIO_ID,
      perfil: 'atendente',
      ativo: true,
    });
    sim.getCol('clientes').set(clienteBase.id, {
      ...clienteBase,
    });
    sim.getCol('lancamentos').set('lnc_01', {
      ...lancamentosBase[0],
      criadoEm: sim.MockTimestamp.fromDate(lancamentosBase[0].criadoEm),
    });
  });

  it('1 & 3. Gera link pelo Dono e abre em outro celular (sem login e sem localStorage)', async () => {
    const { rawToken } = await gerarLinkConsulta({
      comercioId: COMERCIO_ID,
      comercioNome: 'Mercadinho Central',
      cliente: clienteBase,
      lancamentos: lancamentosBase,
      uid: 'uid_dono',
    });

    // Simula outro aparelho: cliente deslogado e sem localStorage
    sim.state.currentUid = null;
    const resp = await consultarSaldoPublicoPorToken(rawToken, '4321');
    expect(resp.status).toBe('ok');
    if (resp.status === 'ok') {
      expect(resp.resumo.comercioNome).toBe('Mercadinho Central');
      expect(resp.resumo.primeiroNome).toBe('Maria');
      expect(resp.resumo.saldoDevedor).toBe(12000);
      expect(resp.resumo.limiteDisponivel).toBe(38000);
      expect(resp.resumo.atualizadoEmIso).toBeTruthy();
      expect(resp.resumo.lancamentos).toHaveLength(1);
    }
  });

  it('2. Gera link pelo Atendente e abre no celular do cliente', async () => {
    sim.state.currentUid = 'uid_atendente';
    const { rawToken } = await gerarLinkConsulta({
      comercioId: COMERCIO_ID,
      comercioNome: 'Mercadinho Central',
      cliente: clienteBase,
      lancamentos: lancamentosBase,
      uid: 'uid_atendente',
    });

    sim.state.currentUid = null;
    const resp = await consultarSaldoPublicoPorToken(rawToken, '4321');
    expect(resp.status).toBe('ok');
  });

  it('4. Mantém funcionamento após fechar/reabrir navegador (token em maiúsculas ou espaços)', async () => {
    const { rawToken } = await gerarLinkConsulta({
      comercioId: COMERCIO_ID,
      comercioNome: 'Mercadinho Central',
      cliente: clienteBase,
      lancamentos: lancamentosBase,
      uid: 'uid_dono',
    });

    sim.state.currentUid = null;
    const primeira = await consultarSaldoPublicoPorToken(rawToken, '4321');
    expect(primeira.status).toBe('ok');

    // Simula reabrir navegador em outro momento dentro da validade
    sim.state.nowMs += 2 * 24 * 60 * 60 * 1000;
    const segunda = await consultarSaldoPublicoPorToken(`  ${rawToken.toUpperCase()}  `, '4321');
    expect(segunda.status).toBe('ok');
  });

  it('5. Atualiza saldo e dígitos quando cadastro/lançamentos mudam após gerar o link', async () => {
    const { rawToken } = await gerarLinkConsulta({
      comercioId: COMERCIO_ID,
      comercioNome: 'Mercadinho Central',
      cliente: clienteBase,
      lancamentos: lancamentosBase,
      uid: 'uid_dono',
    });

    // Novo lançamento + edição do cliente no comércio
    sim.getCol('lancamentos').set('lnc_02', {
      comercioId: COMERCIO_ID,
      clienteId: clienteBase.id,
      numero: '#CMP-0002',
      tipo: 'compra',
      valor: 8000,
      forma: 'fiado',
      itens: 'Pão e leite',
      vencimento: '2026-12-10',
      valorEmAberto: 8000,
      estornoDe: '',
      criadoEm: sim.MockTimestamp.fromMillis(sim.state.nowMs),
    });

    await editarCliente({
      comercioId: COMERCIO_ID,
      clienteId: clienteBase.id,
      nome: 'Maria Santos Atualizada',
      whatsappInput: '(71) 98888-9988',
      limiteCreditoCentavos: 60000,
      diaVencimento: 10,
      consentimentoWhatsapp: true,
      consentimentoAnterior: true,
      uid: 'uid_dono',
      perfil: 'dono',
    });

    sim.state.currentUid = null;
    const resp = await consultarSaldoPublicoPorToken(rawToken, '9988');
    expect(resp.status).toBe('ok');
    if (resp.status === 'ok') {
      expect(resp.resumo.saldoDevedor).toBe(20000);
      expect(resp.resumo.limiteDisponivel).toBe(40000);
      expect(resp.resumo.lancamentos).toHaveLength(2);
    }
  });

  it('6. Rejeita link expirado', async () => {
    const { rawToken } = await gerarLinkConsulta({
      comercioId: COMERCIO_ID,
      comercioNome: 'Mercadinho Central',
      cliente: clienteBase,
      lancamentos: lancamentosBase,
      uid: 'uid_dono',
    });

    sim.state.nowMs += 31 * 24 * 60 * 60 * 1000;
    sim.state.currentUid = null;
    const resp = await consultarSaldoPublicoPorToken(rawToken, '4321');
    expect(resp.status).toBe('indisponivel');
  });

  it('7. Rejeita token inválido/inexistente e dígitos incorretos com bloqueio após 5 erros', async () => {
    const malformado = await consultarSaldoPublicoPorToken('abc-invalido', '4321');
    expect(malformado.status).toBe('indisponivel');

    const inexistente = await consultarSaldoPublicoPorToken('a'.repeat(64), '4321');
    expect(inexistente.status).toBe('indisponivel');

    const { rawToken } = await gerarLinkConsulta({
      comercioId: COMERCIO_ID,
      comercioNome: 'Mercadinho Central',
      cliente: clienteBase,
      lancamentos: lancamentosBase,
      uid: 'uid_dono',
    });

    sim.state.currentUid = null;
    for (let i = 1; i <= 4; i++) {
      const errado = await consultarSaldoPublicoPorToken(rawToken, '0000');
      expect(errado).toEqual({ status: 'invalido_digitos', tentativasRestantes: 5 - i });
    }
    const quinto = await consultarSaldoPublicoPorToken(rawToken, '0000');
    expect(quinto.status).toBe('bloqueado');
  });

  it('8. Rejeita link revogado', async () => {
    const { rawToken, tokenHash } = await gerarLinkConsulta({
      comercioId: COMERCIO_ID,
      comercioNome: 'Mercadinho Central',
      cliente: clienteBase,
      lancamentos: lancamentosBase,
      uid: 'uid_dono',
    });

    await revogarLinkConsulta({
      comercioId: COMERCIO_ID,
      tokenHash,
      uid: 'uid_dono',
    });

    sim.state.currentUid = null;
    const resp = await consultarSaldoPublicoPorToken(rawToken, '4321');
    expect(resp.status).toBe('indisponivel');
  });
});
