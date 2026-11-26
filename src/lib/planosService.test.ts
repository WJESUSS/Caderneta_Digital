import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoreDoc = Record<string, unknown>;

const sim = vi.hoisted(() => {
  const collections = new Map<string, Map<string, StoreDoc>>();
  const state = {
    nowMs: Date.now(),
    assinaturaReadError: null as Error | null,
    lastOnSnapshotErrorCb: null as ((err: unknown) => void) | null,
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

  return { collections, state, MockTimestamp, getCol };
});

vi.mock('firebase/firestore', () => {
  return {
    Timestamp: sim.MockTimestamp,
    serverTimestamp: () => sim.MockTimestamp.fromMillis(sim.state.nowMs),
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
    onSnapshot: (
      ref: { colName: string; id: string },
      onNext: (snap: { id: string; exists: () => boolean; data: () => StoreDoc | undefined }) => void,
      onErr?: (err: unknown) => void
    ) => {
      sim.state.lastOnSnapshotErrorCb = onErr || null;
      if (ref.colName === 'assinaturas' && sim.state.assinaturaReadError) {
        onErr?.(sim.state.assinaturaReadError);
        return () => {};
      }
      const data = sim.getCol(ref.colName).get(ref.id);
      onNext({
        id: ref.id,
        exists: () => Boolean(data),
        data: () => data,
      });
      return () => {};
    },
    runTransaction: async () => {},
    getDoc: async (docRef: { colName: string; id: string }) => {
      if (docRef.colName === 'assinaturas' && sim.state.assinaturaReadError) {
        throw sim.state.assinaturaReadError;
      }
      const data = sim.getCol(docRef.colName).get(docRef.id);
      return {
        id: docRef.id,
        exists: () => Boolean(data),
        data: () => data,
      };
    },
    getDocFromServer: async (docRef: { colName: string; id: string }) => {
      const data = sim.getCol(docRef.colName).get(docRef.id);
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
            sim.getCol(ref.colName).set(ref.id, data);
          });
          return batchObj;
        },
        update: (ref: { colName: string; id: string }, partial: StoreDoc) => {
          ops.push(() => {
            const cur = sim.getCol(ref.colName).get(ref.id);
            if (!cur) throw new Error(`NOT_FOUND: ${ref.colName}/${ref.id}`);
            sim.getCol(ref.colName).set(ref.id, { ...cur, ...partial });
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
    throw err;
  },
  createSecondaryAuthApp: () => ({}),
}));

import {
  cadastrarCliente,
  carregarDadosExemplo,
  editarCliente,
  observarAssinatura,
} from './firestoreService';
import { isErroLimitePlano, type AssinaturaComercio } from './planos';

function seedClientes(comercioId: string, qtdAtivos: number, qtdInativos = 0, qtdAnon = 0) {
  const col = sim.getCol('clientes');
  for (let i = 1; i <= qtdAtivos; i += 1) {
    col.set(`cli_a_${i}`, {
      comercioId,
      nome: `Ativo ${i}`,
      whatsapp: `+557198888${String(i).padStart(4, '0')}`,
      ativo: true,
      anonimizado: false,
      consentimentoWhatsapp: true,
      limiteCredito: 10000,
      diaVencimento: 10,
      saldoDevedor: 0,
      valorVencido: 0,
      valorAVencer: 0,
      proximoVencimento: '',
    });
  }
  for (let i = 1; i <= qtdInativos; i += 1) {
    col.set(`cli_i_${i}`, {
      comercioId,
      nome: `Inativo ${i}`,
      whatsapp: `+557197777${String(i).padStart(4, '0')}`,
      ativo: false,
      anonimizado: false,
      consentimentoWhatsapp: true,
      limiteCredito: 10000,
      diaVencimento: 10,
      saldoDevedor: 0,
      valorVencido: 0,
      valorAVencer: 0,
      proximoVencimento: '',
    });
  }
  for (let i = 1; i <= qtdAnon; i += 1) {
    col.set(`cli_z_${i}`, {
      comercioId,
      nome: 'Cliente Anonimizado',
      whatsapp: 'ANONIMIZADO',
      ativo: false,
      anonimizado: true,
      consentimentoWhatsapp: false,
      limiteCredito: 0,
      diaVencimento: 10,
      saldoDevedor: 0,
      valorVencido: 0,
      valorAVencer: 0,
      proximoVencimento: '',
    });
  }
}

describe('Validação de limite de plano em firestoreService.ts', () => {
  const comercioId = 'com_teste';
  const uid = 'uid_dono';

  beforeEach(() => {
    sim.collections.clear();
    sim.state.nowMs = Date.now();
    sim.state.assinaturaReadError = null;
    sim.getCol('comercios').set(comercioId, {
      nome: 'Mercadinho Teste',
      limitePadrao: 20000,
      ultimoNumeroLancamento: 0,
    });
  });

  it('observarAssinatura retorna null sem erro quando há falha na leitura (fallback Grátis)', () => {
    sim.state.assinaturaReadError = new Error('Missing or insufficient permissions');
    let recebido: AssinaturaComercio | null | undefined;
    observarAssinatura(comercioId, (ass) => {
      recebido = ass;
    });
    expect(recebido).toBeNull();
  });

  it('bloqueia cadastrarCliente e reativar inativo ao atingir 20 ativos no plano Grátis, mas permite editar ativo existente', async () => {
    seedClientes(comercioId, 20, 1, 2);

    // 1. Novo cadastro bloqueado
    let errNovo: unknown;
    try {
      await cadastrarCliente({
        comercioId,
        nome: 'Novo Cliente',
        whatsappInput: '(71) 99999-0001',
        consentimentoWhatsapp: true,
        limiteCreditoCentavos: 20000,
        diaVencimento: 10,
        uid,
      });
    } catch (e) {
      errNovo = e;
    }
    expect(isErroLimitePlano(errNovo)).toBe(true);

    // 2. Reativação de inativo bloqueada
    let errReativar: unknown;
    try {
      await editarCliente({
        clienteId: 'cli_i_1',
        comercioId,
        perfil: 'dono',
        nome: 'Inativo 1',
        whatsappInput: '(71) 97777-0001',
        limiteCreditoCentavos: 10000,
        diaVencimento: 10,
        ativo: true,
        uid,
      });
    } catch (e) {
      errReativar = e;
    }
    expect(isErroLimitePlano(errReativar)).toBe(true);

    // 3. Editar cliente já ativo continua permitido normalmente
    await expect(
      editarCliente({
        clienteId: 'cli_a_1',
        comercioId,
        perfil: 'dono',
        nome: 'Ativo 1 Atualizado',
        whatsappInput: '(71) 98888-0001',
        limiteCreditoCentavos: 15000,
        diaVencimento: 15,
        ativo: true,
        uid,
      })
    ).resolves.toBeUndefined();
  });

  it('permite cadastrar quando inativos + anonimizados somam > 20 mas ativos < 20', async () => {
    seedClientes(comercioId, 19, 5, 3);
    const id = await cadastrarCliente({
      comercioId,
      nome: 'Vigésimo Ativo',
      whatsappInput: '(71) 99999-0020',
      consentimentoWhatsapp: true,
      limiteCreditoCentavos: 20000,
      diaVencimento: 10,
      uid,
    });
    expect(id).toContain('cli_');
  });

  it('bloqueia carregarDadosExemplo quando ultrapassar o limite e libera com assinatura Básico válida', async () => {
    seedClientes(comercioId, 15);

    // 15 + 9 demo > 20 (plano Grátis) -> bloqueado
    let errDemo: unknown;
    try {
      await carregarDadosExemplo({ comercioId, uid });
    } catch (e) {
      errDemo = e;
    }
    expect(isErroLimitePlano(errDemo)).toBe(true);

    // Assinatura Básico vencida -> ainda bloqueado
    sim.getCol('assinaturas').set(comercioId, {
      plano: 'basico',
      validoAte: sim.MockTimestamp.fromMillis(sim.state.nowMs - 60_000),
    });
    let errVencido: unknown;
    try {
      await carregarDadosExemplo({ comercioId, uid });
    } catch (e) {
      errVencido = e;
    }
    expect(isErroLimitePlano(errVencido)).toBe(true);

    // Assinatura Básico válida -> libera (15 + 9 = 24 <= 100)
    sim.getCol('assinaturas').set(comercioId, {
      plano: 'basico',
      validoAte: sim.MockTimestamp.fromMillis(sim.state.nowMs + 30 * 24 * 60 * 60 * 1000),
    });
    const res = await carregarDadosExemplo({ comercioId, uid });
    expect(res.adicionados).toBe(9);
  });
});
