import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  type UserCredential,
} from 'firebase/auth';
import { createSecondaryAuthApp, db, handleFirestoreError, OperationType } from './firebase';
import {
  calcularVencimentoCompra,
  getBahiaDateString,
  normalizeWhatsAppBR,
  recalcularCarteiraCliente,
  validarCompra,
  validarPagamento,
  type Cliente,
  type Comercio,
  type FormaPagamento,
  type Lancamento,
  type LancamentoCalcInput,
  type LinkConsulta,
  type ResumoPublicoCliente,
  type Usuario,
} from './businessRules';
import {
  decryptPublicPayload,
  encryptPublicPayload,
  generateRandomTokenHex,
  hashPin,
  sha256Hex,
  verifyPin,
} from './crypto';
import { generateIdempotencyKey } from './offlineQueue';

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate();
  if (val instanceof Date) return val;
  return new Date(0);
}

function makeDocId(prefix: string): string {
  const rand = generateRandomTokenHex(8);
  return `${prefix}_${Date.now()}_${rand}`;
}

export async function carregarUsuarioAtual(uid: string): Promise<Usuario | null> {
  try {
    const snap = await getDoc(doc(db, 'usuarios', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      uid: snap.id,
      comercioId: String(d.comercioId),
      perfil: d.perfil === 'dono' ? 'dono' : 'atendente',
      nome: String(d.nome),
      email: String(d.email),
      ativo: Boolean(d.ativo),
      criadoPor: String(d.criadoPor),
      criadoEm: toDate(d.criadoEm),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `usuarios/${uid}`);
  }
}

export async function criarComercioEDono(params: {
  uid: string;
  email: string;
  nomeDono: string;
  nomeComercio: string;
  limitePadraoCentavos: number;
  pin4?: string;
}): Promise<{ comercioId: string }> {
  const comercioId = makeDocId('com');
  const pinClean = (params.pin4 || '').trim();
  const pinData =
    /^\d{4}$/.test(pinClean) ? await hashPin(pinClean) : { hash: '', salt: '' };

  const batch = writeBatch(db);
  const comercioRef = doc(db, 'comercios', comercioId);
  const usuarioRef = doc(db, 'usuarios', params.uid);
  const auditRef = doc(db, 'auditoria', makeDocId('aud'));

  batch.set(comercioRef, {
    nome: params.nomeComercio.trim(),
    limitePadrao: Math.max(0, Math.round(params.limitePadraoCentavos)),
    pinHash: pinData.hash,
    pinSalt: pinData.salt,
    pinTentativasErradas: 0,
    pinBloqueadoAte: Timestamp.fromMillis(0),
    donoUid: params.uid,
    criadoEm: serverTimestamp(),
  });

  batch.set(usuarioRef, {
    comercioId,
    perfil: 'dono',
    nome: params.nomeDono.trim(),
    email: params.email.trim().toLowerCase(),
    ativo: true,
    criadoPor: params.uid,
    criadoEm: serverTimestamp(),
  });

  try {
    await batch.commit();
    await writeBatch(db)
      .set(auditRef, {
        comercioId,
        quem: params.uid,
        acao: 'comercio_criado',
        detalhes: `Comércio "${params.nomeComercio.trim()}" criado pelo Dono.`,
        quando: serverTimestamp(),
      })
      .commit();
    return { comercioId };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `comercios/${comercioId}`);
  }
}

export function observarComercio(
  comercioId: string,
  onData: (comercio: Comercio | null) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'comercios', comercioId),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const d = snap.data();
      onData({
        id: snap.id,
        nome: String(d.nome),
        limitePadrao: Number(d.limitePadrao ?? 0),
        pinHash: String(d.pinHash ?? ''),
        pinSalt: String(d.pinSalt ?? ''),
        pinTentativasErradas: Number(d.pinTentativasErradas ?? 0),
        pinBloqueadoAte: toDate(d.pinBloqueadoAte),
        donoUid: String(d.donoUid),
        criadoEm: toDate(d.criadoEm),
      });
    },
    (err) => {
      if (onError) {
        onError(err);
      } else {
        handleFirestoreError(err, OperationType.GET, `comercios/${comercioId}`);
      }
    }
  );
}

export function observarClientes(
  comercioId: string,
  onData: (clientes: Cliente[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const q = query(collection(db, 'clientes'), where('comercioId', '==', comercioId));
  return onSnapshot(
    q,
    (snap) => {
      const list: Cliente[] = snap.docs
        .map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            comercioId: String(d.comercioId),
            nome: String(d.nome),
            whatsapp: String(d.whatsapp),
            consentimentoWhatsapp: Boolean(d.consentimentoWhatsapp),
            consentimentoEm: toDate(d.consentimentoEm),
            limiteCredito: Number(d.limiteCredito ?? 0),
            diaVencimento: Number(d.diaVencimento ?? 10),
            ativo: Boolean(d.ativo),
            anonimizado: Boolean(d.anonimizado),
            saldoDevedor: Number(d.saldoDevedor ?? 0),
            valorVencido: Number(d.valorVencido ?? 0),
            valorAVencer: Number(d.valorAVencer ?? 0),
            proximoVencimento: String(d.proximoVencimento ?? ''),
            criadoEm: toDate(d.criadoEm),
            atualizadoEm: toDate(d.atualizadoEm),
          };
        })
        .sort((a, b) => b.valorVencido - a.valorVencido);
      onData(list);
    },
    (err) => {
      if (onError) {
        onError(err);
      } else {
        handleFirestoreError(err, OperationType.LIST, 'clientes');
      }
    }
  );
}

export function observarLancamentosCliente(
  comercioId: string,
  clienteId: string,
  onData: (lancamentos: Lancamento[]) => void
): Unsubscribe {
  const q = query(collection(db, 'lancamentos'), where('comercioId', '==', comercioId));
  return onSnapshot(
    q,
    (snap) => {
      const list: Lancamento[] = snap.docs
        .filter((docSnap) => docSnap.data().clienteId === clienteId)
        .map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            comercioId: String(d.comercioId),
            clienteId: String(d.clienteId),
            tipo: d.tipo,
            valor: Number(d.valor ?? 0),
            forma: d.forma,
            itens: String(d.itens ?? ''),
            vencimento: String(d.vencimento ?? ''),
            valorEmAberto: Number(d.valorEmAberto ?? 0),
            autorizadoExcecaoPor: String(d.autorizadoExcecaoPor ?? ''),
            estornoDe: String(d.estornoDe ?? ''),
            justificativa: String(d.justificativa ?? ''),
            idempotencyKey: String(d.idempotencyKey ?? ''),
            criadoPor: String(d.criadoPor),
            criadoEm: toDate(d.criadoEm),
          };
        })
        .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'lancamentos')
  );
}

export function observarUsuariosComercio(
  comercioId: string,
  onData: (usuarios: Usuario[]) => void
): Unsubscribe {
  const q = query(collection(db, 'usuarios'), where('comercioId', '==', comercioId));
  return onSnapshot(
    q,
    (snap) => {
      const list: Usuario[] = snap.docs
        .map((docSnap) => {
          const d = docSnap.data();
          return {
            uid: docSnap.id,
            comercioId: String(d.comercioId),
            perfil: (d.perfil === 'dono' ? 'dono' : 'atendente') as Usuario['perfil'],
            nome: String(d.nome),
            email: String(d.email),
            ativo: Boolean(d.ativo),
            criadoPor: String(d.criadoPor),
            criadoEm: toDate(d.criadoEm),
          };
        })
        .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'usuarios')
  );
}

export function observarLinksCliente(
  comercioId: string,
  clienteId: string,
  onData: (links: LinkConsulta[]) => void
): Unsubscribe {
  const q = query(collection(db, 'linksConsulta'), where('comercioId', '==', comercioId));
  return onSnapshot(
    q,
    (snap) => {
      const list: LinkConsulta[] = snap.docs
        .filter((docSnap) => docSnap.data().clienteId === clienteId)
        .map((docSnap) => {
          const d = docSnap.data();
          return {
            tokenHash: docSnap.id,
            comercioId: String(d.comercioId),
            clienteId: String(d.clienteId),
            expiraEm: toDate(d.expiraEm),
            revogado: Boolean(d.revogado),
            tentativasErradas: Number(d.tentativasErradas ?? 0),
            bloqueadoAte: toDate(d.bloqueadoAte),
            criadoPor: String(d.criadoPor),
            criadoEm: toDate(d.criadoEm),
          };
        })
        .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'linksConsulta')
  );
}

export async function cadastrarCliente(params: {
  comercioId: string;
  nome: string;
  whatsappInput: string;
  consentimentoWhatsapp: boolean;
  limiteCreditoCentavos: number;
  diaVencimento: number;
  uid: string;
}): Promise<string> {
  const e164 = normalizeWhatsAppBR(params.whatsappInput);
  if (!e164) {
    throw new Error('WhatsApp inválido. Informe DDD + número com 10 ou 11 dígitos.');
  }
  if (!params.consentimentoWhatsapp) {
    throw new Error('É obrigatório confirmar o consentimento LGPD do cliente.');
  }

  // RN01: Telefone único no comércio (consulta por comercioId sem exigir índice composto)
  const dupQuery = query(
    collection(db, 'clientes'),
    where('comercioId', '==', params.comercioId)
  );
  let dupSnap;
  try {
    dupSnap = await getDocs(dupQuery);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'clientes');
  }
  if (dupSnap.docs.some((d) => d.data().whatsapp === e164)) {
    throw new Error('Já existe um cliente cadastrado com este número de WhatsApp neste comércio.');
  }

  const clienteId = makeDocId('cli');
  const dia = Math.max(1, Math.min(28, Math.round(params.diaVencimento)));
  const batch = writeBatch(db);

  batch.set(doc(db, 'clientes', clienteId), {
    comercioId: params.comercioId,
    nome: params.nome.trim(),
    whatsapp: e164,
    consentimentoWhatsapp: true,
    consentimentoEm: serverTimestamp(),
    limiteCredito: Math.max(0, Math.round(params.limiteCreditoCentavos)),
    diaVencimento: dia,
    ativo: true,
    anonimizado: false,
    saldoDevedor: 0,
    valorVencido: 0,
    valorAVencer: 0,
    proximoVencimento: '',
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
  });

  batch.set(doc(db, 'auditoria', makeDocId('aud')), {
    comercioId: params.comercioId,
    quem: params.uid,
    acao: 'cliente_cadastrado',
    detalhes: `Cliente "${params.nome.trim()}" cadastrado.`,
    quando: serverTimestamp(),
  });

  try {
    await batch.commit();
    return clienteId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `clientes/${clienteId}`);
  }
}

export async function editarCliente(params: {
  clienteId: string;
  comercioId: string;
  perfil: 'dono' | 'atendente';
  nome: string;
  whatsappInput: string;
  consentimentoWhatsapp: boolean;
  limiteCreditoCentavos: number;
  diaVencimento: number;
  ativo?: boolean;
  uid: string;
}): Promise<void> {
  const e164 = normalizeWhatsAppBR(params.whatsappInput);
  if (!e164) {
    throw new Error('WhatsApp inválido. Informe DDD + número.');
  }

  const dupQuery = query(
    collection(db, 'clientes'),
    where('comercioId', '==', params.comercioId)
  );
  const dupSnap = await getDocs(dupQuery);
  const otherDup = dupSnap.docs.find((d) => d.id !== params.clienteId && d.data().whatsapp === e164);
  if (otherDup) {
    throw new Error('Outro cliente já utiliza este WhatsApp neste comércio.');
  }

  const dia = Math.max(1, Math.min(28, Math.round(params.diaVencimento)));
  const batch = writeBatch(db);
  const clienteRef = doc(db, 'clientes', params.clienteId);

  const payload: Record<string, unknown> = {
    nome: params.nome.trim(),
    whatsapp: e164,
    consentimentoWhatsapp: params.consentimentoWhatsapp,
    diaVencimento: dia,
    atualizadoEm: serverTimestamp(),
  };

  if (params.perfil === 'dono') {
    payload.limiteCredito = Math.max(0, Math.round(params.limiteCreditoCentavos));
    if (typeof params.ativo === 'boolean') {
      payload.ativo = params.ativo;
    }
  }

  batch.update(clienteRef, payload);

  // Se Dono inativar cliente, revoga links ativos automaticamente
  if (params.perfil === 'dono' && params.ativo === false) {
    const linksSnap = await getDocs(
      query(
        collection(db, 'linksConsulta'),
        where('comercioId', '==', params.comercioId)
      )
    );
    for (const lDoc of linksSnap.docs.filter((d) => d.data().clienteId === params.clienteId)) {
      batch.update(lDoc.ref, { revogado: true });
      batch.update(doc(db, 'consultasPublicas', lDoc.id), {
        revogado: true,
        atualizadoEm: serverTimestamp(),
      });
    }
  }

  batch.set(doc(db, 'auditoria', makeDocId('aud')), {
    comercioId: params.comercioId,
    quem: params.uid,
    acao: 'cliente_editado',
    detalhes: `Cadastro de "${params.nome.trim()}" atualizado.`,
    quando: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `clientes/${params.clienteId}`);
  }
}

export async function anonimizarClienteLGPD(params: {
  comercioId: string;
  clienteId: string;
  uid: string;
}): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'clientes', params.clienteId), {
    nome: 'Cliente Anonimizado',
    whatsapp: 'ANONIMIZADO',
    consentimentoWhatsapp: false,
    ativo: false,
    anonimizado: true,
    atualizadoEm: serverTimestamp(),
  });

  const linksSnap = await getDocs(
    query(
      collection(db, 'linksConsulta'),
      where('comercioId', '==', params.comercioId)
    )
  );
  for (const lDoc of linksSnap.docs.filter((d) => d.data().clienteId === params.clienteId)) {
    batch.update(lDoc.ref, { revogado: true });
    batch.update(doc(db, 'consultasPublicas', lDoc.id), {
      revogado: true,
      atualizadoEm: serverTimestamp(),
    });
  }

  batch.set(doc(db, 'auditoria', makeDocId('aud')), {
    comercioId: params.comercioId,
    quem: params.uid,
    acao: 'lgpd_anonimizacao',
    detalhes: `Dados do cliente ${params.clienteId} anonimizados e links revogados.`,
    quando: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `clientes/${params.clienteId}`);
  }
}

async function sincronizarConsultasPublicasCliente(params: {
  comercioId: string;
  comercioNome: string;
  clienteId: string;
  clienteNome: string;
  clienteWhatsapp: string;
  saldoDevedor: number;
  valorVencido: number;
  valorAVencer: number;
  proximoVencimento: string;
  lancamentos: LancamentoCalcInput[];
  estornadosIds: Set<string>;
  comprasAtualizadas: Map<string, number>;
  rawLancamentosDocs: Array<{
    id: string;
    tipo: Lancamento['tipo'];
    valor: number;
    forma: FormaPagamento;
    itens: string;
    vencimento: string;
    criadoEmMs: number;
  }>;
}): Promise<void> {
  if (!params.clienteWhatsapp || params.clienteWhatsapp === 'ANONIMIZADO') return;

  const linksSnap = await getDocs(
    query(
      collection(db, 'linksConsulta'),
      where('comercioId', '==', params.comercioId)
    )
  );

  const activeLinks = linksSnap.docs.filter(
    (d) => d.data().clienteId === params.clienteId && !d.data().revogado
  );
  if (activeLinks.length === 0) return;

  const last4 = params.clienteWhatsapp.slice(-4);
  const primeiroNome = params.clienteNome.trim().split(/\s+/)[0] || 'Cliente';

  const resumo: ResumoPublicoCliente = {
    comercioNome: params.comercioNome,
    primeiroNome,
    saldoDevedor: params.saldoDevedor,
    valorVencido: params.valorVencido,
    valorAVencer: params.valorAVencer,
    proximoVencimento: params.proximoVencimento,
    atualizadoEmIso: new Date().toISOString(),
    lancamentos: params.rawLancamentosDocs
      .slice()
      .sort((a, b) => b.criadoEmMs - a.criadoEmMs)
      .slice(0, 30)
      .map((l) => ({
        id: l.id,
        tipo: l.tipo,
        valor: l.valor,
        forma: l.forma,
        itens: l.itens,
        vencimento: l.vencimento,
        valorEmAberto: params.comprasAtualizadas.get(l.id) ?? 0,
        criadoEmIso: new Date(l.criadoEmMs).toISOString(),
        estornado: params.estornadosIds.has(l.id),
      })),
  };

  const json = JSON.stringify(resumo);
  const batch = writeBatch(db);
  for (const linkDoc of activeLinks) {
    const tokenHash = linkDoc.id;
    const enc = await encryptPublicPayload(json, tokenHash, `${params.comercioId}:${last4}`);
    batch.update(doc(db, 'consultasPublicas', tokenHash), {
      comercioNome: params.comercioNome,
      payloadCifrado: enc,
      atualizadoEm: serverTimestamp(),
    });
  }
  await batch.commit();
}

async function fetchClientLancamentos(comercioId: string, clienteId: string) {
  const snap = await getDocs(
    query(
      collection(db, 'lancamentos'),
      where('comercioId', '==', comercioId)
    )
  );
  return snap.docs
    .filter((d) => d.data().clienteId === clienteId)
    .map((d) => {
      const data = d.data();
      return {
        ref: d.ref,
        id: d.id,
        tipo: data.tipo as Lancamento['tipo'],
        valor: Number(data.valor ?? 0),
        valorEmAberto: Number(data.valorEmAberto ?? 0),
        forma: data.forma as FormaPagamento,
        itens: String(data.itens ?? ''),
        vencimento: String(data.vencimento ?? ''),
        estornoDe: String(data.estornoDe ?? ''),
        idempotencyKey: String(data.idempotencyKey ?? ''),
        criadoEmMs: toDate(data.criadoEm).getTime() || Date.now(),
      };
    });
}

export async function registrarCompra(params: {
  comercioId: string;
  comercioNome: string;
  clienteId: string;
  valorCentavos: number;
  itens?: string;
  autorizadoExcecaoPor?: string;
  uid: string;
  idempotencyKey?: string;
}): Promise<{ lancamentoId: string; novoSaldo: number }> {
  const idem = params.idempotencyKey || generateIdempotencyKey('cmp');

  const existingLancamentos = await fetchClientLancamentos(params.comercioId, params.clienteId);
  const existingIdem = existingLancamentos.find((l) => l.idempotencyKey === idem);
  if (existingIdem) {
    const cliSnap = await getDoc(doc(db, 'clientes', params.clienteId));
    return {
      lancamentoId: existingIdem.id,
      novoSaldo: Number(cliSnap.data()?.saldoDevedor ?? 0),
    };
  }

  const lancamentoId = makeDocId('lnc');
  const agora = new Date();
  const hojeBahia = getBahiaDateString(agora);

  let resultadoCarteiraFinal!: ReturnType<typeof recalcularCarteiraCliente>;
  let clienteNome = '';
  let clienteWhatsapp = '';
  let novoLancamentoCalc: LancamentoCalcInput | null = null;
  let vencimentoStr = '';

  try {
    await runTransaction(db, async (tx) => {
      const cliRef = doc(db, 'clientes', params.clienteId);
      const cliSnap = await tx.get(cliRef);
      if (!cliSnap.exists()) throw new Error('Cliente não encontrado.');
      const cli = cliSnap.data();
      if (!cli.ativo || cli.anonimizado) {
        throw new Error('Cliente inativo ou anonimizado.');
      }

      clienteNome = String(cli.nome);
      clienteWhatsapp = String(cli.whatsapp);
      const limiteCredito = Number(cli.limiteCredito ?? 0);
      const diaVencimento = Number(cli.diaVencimento ?? 10);

      // Recompute authoritative balance from ledger
      const baseCalc: LancamentoCalcInput[] = existingLancamentos.map((l) => ({
        id: l.id,
        tipo: l.tipo,
        valor: l.valor,
        vencimento: l.vencimento,
        estornoDe: l.estornoDe,
        criadoEmMs: l.criadoEmMs,
      }));
      const atual = recalcularCarteiraCliente(baseCalc, hojeBahia);

      const check = validarCompra(
        atual.saldoDevedor,
        params.valorCentavos,
        limiteCredito,
        Boolean(params.autorizadoExcecaoPor)
      );
      if (!check.permitida) {
        throw new Error(check.motivo || 'Compra acima do limite');
      }

      vencimentoStr = calcularVencimentoCompra(agora, diaVencimento);
      novoLancamentoCalc = {
        id: lancamentoId,
        tipo: 'compra',
        valor: params.valorCentavos,
        vencimento: vencimentoStr,
        estornoDe: '',
        criadoEmMs: agora.getTime(),
      };

      const novoCalc = recalcularCarteiraCliente([...baseCalc, novoLancamentoCalc], hojeBahia);
      resultadoCarteiraFinal = novoCalc;

      const valorEmAbertoCompra = novoCalc.comprasAtualizadas.get(lancamentoId) ?? params.valorCentavos;

      tx.set(doc(db, 'lancamentos', lancamentoId), {
        comercioId: params.comercioId,
        clienteId: params.clienteId,
        tipo: 'compra',
        valor: params.valorCentavos,
        forma: 'fiado',
        itens: (params.itens || '').trim().slice(0, 240),
        vencimento: vencimentoStr,
        valorEmAberto: valorEmAbertoCompra,
        autorizadoExcecaoPor: params.autorizadoExcecaoPor || '',
        estornoDe: '',
        justificativa: '',
        idempotencyKey: idem,
        criadoPor: params.uid,
        criadoEm: serverTimestamp(),
      });

      tx.update(cliRef, {
        saldoDevedor: novoCalc.saldoDevedor,
        valorVencido: novoCalc.valorVencido,
        valorAVencer: novoCalc.valorAVencer,
        proximoVencimento: novoCalc.proximoVencimento,
        atualizadoEm: serverTimestamp(),
      });

      tx.set(doc(db, 'auditoria', makeDocId('aud')), {
        comercioId: params.comercioId,
        quem: params.uid,
        acao: params.autorizadoExcecaoPor ? 'compra_excecao' : 'compra_registrada',
        detalhes: `Compra de ${params.valorCentavos} centavos para ${clienteNome}.`,
        quando: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof Error && (err.message.includes('limite') || err.message.includes('Cliente'))) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, 'lancamentos');
  }

  if (novoLancamentoCalc) {
    try {
      await sincronizarConsultasPublicasCliente({
        comercioId: params.comercioId,
        comercioNome: params.comercioNome,
        clienteId: params.clienteId,
        clienteNome,
        clienteWhatsapp,
        saldoDevedor: resultadoCarteiraFinal.saldoDevedor,
        valorVencido: resultadoCarteiraFinal.valorVencido,
        valorAVencer: resultadoCarteiraFinal.valorAVencer,
        proximoVencimento: resultadoCarteiraFinal.proximoVencimento,
        lancamentos: [...existingLancamentos, novoLancamentoCalc],
        estornadosIds: resultadoCarteiraFinal.estornadosIds,
        comprasAtualizadas: resultadoCarteiraFinal.comprasAtualizadas,
        rawLancamentosDocs: [
          ...existingLancamentos,
          {
            id: lancamentoId,
            tipo: 'compra',
            valor: params.valorCentavos,
            forma: 'fiado',
            itens: (params.itens || '').trim().slice(0, 240),
            vencimento: vencimentoStr,
            criadoEmMs: agora.getTime(),
          },
        ],
      });
    } catch (syncErr) {
      console.warn('Aviso ao sincronizar link público após compra:', syncErr);
    }
  }

  return { lancamentoId, novoSaldo: resultadoCarteiraFinal.saldoDevedor };
}

export async function registrarPagamento(params: {
  comercioId: string;
  comercioNome: string;
  clienteId: string;
  valorCentavos: number;
  forma: 'dinheiro' | 'pix_manual' | 'debito';
  uid: string;
  idempotencyKey?: string;
}): Promise<{ lancamentoId: string; novoSaldo: number }> {
  const idem = params.idempotencyKey || generateIdempotencyKey('pag');

  const existingLancamentos = await fetchClientLancamentos(params.comercioId, params.clienteId);
  const existingIdem = existingLancamentos.find((l) => l.idempotencyKey === idem);
  if (existingIdem) {
    const cliSnap = await getDoc(doc(db, 'clientes', params.clienteId));
    return {
      lancamentoId: existingIdem.id,
      novoSaldo: Number(cliSnap.data()?.saldoDevedor ?? 0),
    };
  }
  const lancamentoId = makeDocId('lnc');
  const agora = new Date();
  const hojeBahia = getBahiaDateString(agora);

  let resultadoCarteiraFinal!: ReturnType<typeof recalcularCarteiraCliente>;
  let clienteNome = '';
  let clienteWhatsapp = '';
  let novoLancamentoCalc: LancamentoCalcInput | null = null;

  try {
    await runTransaction(db, async (tx) => {
      const cliRef = doc(db, 'clientes', params.clienteId);
      const cliSnap = await tx.get(cliRef);
      if (!cliSnap.exists()) throw new Error('Cliente não encontrado.');
      const cli = cliSnap.data();
      if (!cli.ativo || cli.anonimizado) {
        throw new Error('Cliente inativo ou anonimizado.');
      }

      clienteNome = String(cli.nome);
      clienteWhatsapp = String(cli.whatsapp);

      const baseCalc: LancamentoCalcInput[] = existingLancamentos.map((l) => ({
        id: l.id,
        tipo: l.tipo,
        valor: l.valor,
        vencimento: l.vencimento,
        estornoDe: l.estornoDe,
        criadoEmMs: l.criadoEmMs,
      }));
      const atual = recalcularCarteiraCliente(baseCalc, hojeBahia);

      const check = validarPagamento(atual.saldoDevedor, params.valorCentavos);
      if (!check.permitido) {
        throw new Error(check.motivo || 'Pagamento inválido.');
      }

      novoLancamentoCalc = {
        id: lancamentoId,
        tipo: 'pagamento',
        valor: params.valorCentavos,
        vencimento: '',
        estornoDe: '',
        criadoEmMs: agora.getTime(),
      };

      const novoCalc = recalcularCarteiraCliente([...baseCalc, novoLancamentoCalc], hojeBahia);
      resultadoCarteiraFinal = novoCalc;

      tx.set(doc(db, 'lancamentos', lancamentoId), {
        comercioId: params.comercioId,
        clienteId: params.clienteId,
        tipo: 'pagamento',
        valor: params.valorCentavos,
        forma: params.forma,
        itens: '',
        vencimento: '',
        valorEmAberto: 0,
        autorizadoExcecaoPor: '',
        estornoDe: '',
        justificativa: '',
        idempotencyKey: idem,
        criadoPor: params.uid,
        criadoEm: serverTimestamp(),
      });

      for (const l of existingLancamentos) {
        if (l.tipo === 'compra') {
          const aberto = novoCalc.comprasAtualizadas.get(l.id) ?? 0;
          if (aberto !== l.valorEmAberto) {
            tx.update(l.ref, { valorEmAberto: aberto });
          }
        }
      }

      tx.update(cliRef, {
        saldoDevedor: novoCalc.saldoDevedor,
        valorVencido: novoCalc.valorVencido,
        valorAVencer: novoCalc.valorAVencer,
        proximoVencimento: novoCalc.proximoVencimento,
        atualizadoEm: serverTimestamp(),
      });

      tx.set(doc(db, 'auditoria', makeDocId('aud')), {
        comercioId: params.comercioId,
        quem: params.uid,
        acao: 'pagamento_registrado',
        detalhes: `Pagamento (${params.forma}) de ${params.valorCentavos} centavos de ${clienteNome}.`,
        quando: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof Error && (err.message.includes('maior') || err.message.includes('saldo'))) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, 'lancamentos');
  }

  if (novoLancamentoCalc) {
    try {
      await sincronizarConsultasPublicasCliente({
        comercioId: params.comercioId,
        comercioNome: params.comercioNome,
        clienteId: params.clienteId,
        clienteNome,
        clienteWhatsapp,
        saldoDevedor: resultadoCarteiraFinal.saldoDevedor,
        valorVencido: resultadoCarteiraFinal.valorVencido,
        valorAVencer: resultadoCarteiraFinal.valorAVencer,
        proximoVencimento: resultadoCarteiraFinal.proximoVencimento,
        lancamentos: [...existingLancamentos, novoLancamentoCalc],
        estornadosIds: resultadoCarteiraFinal.estornadosIds,
        comprasAtualizadas: resultadoCarteiraFinal.comprasAtualizadas,
        rawLancamentosDocs: [
          ...existingLancamentos,
          {
            id: lancamentoId,
            tipo: 'pagamento',
            valor: params.valorCentavos,
            forma: params.forma,
            itens: '',
            vencimento: '',
            criadoEmMs: agora.getTime(),
          },
        ],
      });
    } catch (syncErr) {
      console.warn('Aviso ao sincronizar link público após pagamento:', syncErr);
    }
  }

  return { lancamentoId, novoSaldo: resultadoCarteiraFinal.saldoDevedor };
}

export async function estornarLancamento(params: {
  comercioId: string;
  comercioNome: string;
  clienteId: string;
  lancamentoAlvo: Lancamento;
  justificativa: string;
  uid: string;
}): Promise<void> {
  const just = params.justificativa.trim();
  if (just.length < 3) {
    throw new Error('Informe uma justificativa com pelo menos 3 caracteres para o estorno.');
  }
  if (params.lancamentoAlvo.tipo === 'estorno') {
    throw new Error('Não é possível estornar um estorno.');
  }

  const existingLancamentos = await fetchClientLancamentos(params.comercioId, params.clienteId);
  if (existingLancamentos.some((l) => l.tipo === 'estorno' && l.estornoDe === params.lancamentoAlvo.id)) {
    throw new Error('Este lançamento já foi estornado.');
  }

  const estornoId = makeDocId('est');
  const agora = new Date();
  const hojeBahia = getBahiaDateString(agora);

  let resultadoCarteiraFinal!: ReturnType<typeof recalcularCarteiraCliente>;
  let clienteNome = '';
  let clienteWhatsapp = '';

  const estornoCalc: LancamentoCalcInput = {
    id: estornoId,
    tipo: 'estorno',
    valor: params.lancamentoAlvo.valor,
    vencimento: '',
    estornoDe: params.lancamentoAlvo.id,
    criadoEmMs: agora.getTime(),
  };

  try {
    await runTransaction(db, async (tx) => {
      const cliRef = doc(db, 'clientes', params.clienteId);
      const cliSnap = await tx.get(cliRef);
      if (!cliSnap.exists()) throw new Error('Cliente não encontrado.');
      const cli = cliSnap.data();
      clienteNome = String(cli.nome);
      clienteWhatsapp = String(cli.whatsapp);

      const baseCalc: LancamentoCalcInput[] = existingLancamentos.map((l) => ({
        id: l.id,
        tipo: l.tipo,
        valor: l.valor,
        vencimento: l.vencimento,
        estornoDe: l.estornoDe,
        criadoEmMs: l.criadoEmMs,
      }));

      const novoCalc = recalcularCarteiraCliente([...baseCalc, estornoCalc], hojeBahia);
      resultadoCarteiraFinal = novoCalc;

      tx.set(doc(db, 'lancamentos', estornoId), {
        comercioId: params.comercioId,
        clienteId: params.clienteId,
        tipo: 'estorno',
        valor: params.lancamentoAlvo.valor,
        forma: params.lancamentoAlvo.forma,
        itens: params.lancamentoAlvo.itens,
        vencimento: '',
        valorEmAberto: 0,
        autorizadoExcecaoPor: '',
        estornoDe: params.lancamentoAlvo.id,
        justificativa: just.slice(0, 300),
        idempotencyKey: `est_${params.lancamentoAlvo.id}`,
        criadoPor: params.uid,
        criadoEm: serverTimestamp(),
      });

      for (const l of existingLancamentos) {
        if (l.tipo === 'compra') {
          const aberto = novoCalc.comprasAtualizadas.get(l.id) ?? 0;
          if (aberto !== l.valorEmAberto) {
            tx.update(l.ref, { valorEmAberto: aberto });
          }
        }
      }

      tx.update(cliRef, {
        saldoDevedor: novoCalc.saldoDevedor,
        valorVencido: novoCalc.valorVencido,
        valorAVencer: novoCalc.valorAVencer,
        proximoVencimento: novoCalc.proximoVencimento,
        atualizadoEm: serverTimestamp(),
      });

      tx.set(doc(db, 'auditoria', makeDocId('aud')), {
        comercioId: params.comercioId,
        quem: params.uid,
        acao: 'lancamento_estornado',
        detalhes: `Estorno de ${params.lancamentoAlvo.tipo} (${params.lancamentoAlvo.valor}c) — Motivo: ${just.slice(0, 120)}`,
        quando: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('estorn')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, 'lancamentos');
  }

  try {
    await sincronizarConsultasPublicasCliente({
      comercioId: params.comercioId,
      comercioNome: params.comercioNome,
      clienteId: params.clienteId,
      clienteNome,
      clienteWhatsapp,
      saldoDevedor: resultadoCarteiraFinal.saldoDevedor,
      valorVencido: resultadoCarteiraFinal.valorVencido,
      valorAVencer: resultadoCarteiraFinal.valorAVencer,
      proximoVencimento: resultadoCarteiraFinal.proximoVencimento,
      lancamentos: [...existingLancamentos, estornoCalc],
      estornadosIds: resultadoCarteiraFinal.estornadosIds,
      comprasAtualizadas: resultadoCarteiraFinal.comprasAtualizadas,
      rawLancamentosDocs: [
        ...existingLancamentos,
        {
          id: estornoId,
          tipo: 'estorno',
          valor: params.lancamentoAlvo.valor,
          forma: params.lancamentoAlvo.forma,
          itens: params.lancamentoAlvo.itens,
          vencimento: '',
          criadoEmMs: agora.getTime(),
        },
      ],
    });
  } catch (syncErr) {
    console.warn('Aviso ao sincronizar link público após estorno:', syncErr);
  }
}

export async function verificarPinDono(comercio: Comercio, pinInput: string): Promise<string> {
  if (!comercio.pinHash || !comercio.pinSalt) {
    throw new Error('O Dono ainda não configurou o PIN de 4 dígitos em Configurações.');
  }
  const agora = Date.now();
  if (comercio.pinBloqueadoAte.getTime() > agora) {
    throw new Error('PIN temporariamente bloqueado por excesso de tentativas. Aguarde 15 minutos.');
  }
  if (!/^\d{4}$/.test(pinInput)) {
    throw new Error('Digite o PIN com exatamente 4 números.');
  }

  const ok = await verifyPin(pinInput, comercio.pinSalt, comercio.pinHash);
  const comRef = doc(db, 'comercios', comercio.id);

  if (!ok) {
    const novasTentativas = Math.min(5, comercio.pinTentativasErradas + 1);
    const bloqueio = novasTentativas >= 5 ? Timestamp.fromMillis(agora + 15 * 60 * 1000) : Timestamp.fromMillis(0);
    await writeBatch(db)
      .update(comRef, {
        pinTentativasErradas: novasTentativas,
        pinBloqueadoAte: bloqueio,
      })
      .commit();
    throw new Error(
      novasTentativas >= 5
        ? 'PIN incorreto 5 vezes. Bloqueado por 15 minutos.'
        : `PIN incorreto (${novasTentativas}/5 tentativas).`
    );
  }

  if (comercio.pinTentativasErradas > 0) {
    await writeBatch(db)
      .update(comRef, {
        pinTentativasErradas: 0,
        pinBloqueadoAte: Timestamp.fromMillis(0),
      })
      .commit();
  }

  return comercio.donoUid;
}

export async function salvarConfigComercio(params: {
  comercioId: string;
  nome: string;
  limitePadraoCentavos: number;
  novoPin4?: string;
  uid: string;
}): Promise<void> {
  const payload: Record<string, unknown> = {
    nome: params.nome.trim(),
    limitePadrao: Math.max(0, Math.round(params.limitePadraoCentavos)),
  };
  if (params.novoPin4 && /^\d{4}$/.test(params.novoPin4)) {
    const hashed = await hashPin(params.novoPin4);
    payload.pinHash = hashed.hash;
    payload.pinSalt = hashed.salt;
    payload.pinTentativasErradas = 0;
    payload.pinBloqueadoAte = Timestamp.fromMillis(0);
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'comercios', params.comercioId), payload);
  batch.set(doc(db, 'auditoria', makeDocId('aud')), {
    comercioId: params.comercioId,
    quem: params.uid,
    acao: 'config_atualizada',
    detalhes: 'Configurações do comércio atualizadas.',
    quando: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `comercios/${params.comercioId}`);
  }
}

export async function criarAtendente(params: {
  comercioId: string;
  nome: string;
  email: string;
  senhaProvisoria: string;
  donoUid: string;
}): Promise<void> {
  const nomeLimpo = params.nome.trim();
  const emailLimpo = params.email.trim().toLowerCase();

  if (nomeLimpo.length < 2 || nomeLimpo.length > 80) {
    throw new Error('Informe o nome do(a) atendente com pelo menos 2 letras.');
  }
  if (!emailLimpo.includes('@') || emailLimpo.length < 5) {
    throw new Error('Informe um e-mail válido para o(a) atendente.');
  }
  if (params.senhaProvisoria.length < 6) {
    throw new Error('A senha provisória precisa ter pelo menos 6 caracteres.');
  }

  const { secondaryAuth, cleanup } = createSecondaryAuthApp();
  let cred: UserCredential | null = null;
  let createdNewAuthUser = false;

  try {
    try {
      cred = await createUserWithEmailAndPassword(
        secondaryAuth,
        emailLimpo,
        params.senhaProvisoria
      );
      createdNewAuthUser = true;
    } catch (authErr) {
      const msg = authErr instanceof Error ? authErr.message : String(authErr);
      if (msg.includes('auth/email-already-in-use')) {
        try {
          cred = await signInWithEmailAndPassword(
            secondaryAuth,
            emailLimpo,
            params.senhaProvisoria
          );
        } catch {
          throw new Error(
            'Este e-mail já está cadastrado no Firebase (em outra conta ou tentativa anterior). Use outro e-mail para o(a) atendente ou remova o usuário antigo em Authentication → Users no Firebase Console.'
          );
        }
        if (cred.user.uid === params.donoUid) {
          throw new Error(
            'Você não pode cadastrar o seu próprio e-mail de Dono como atendente. Use um e-mail diferente para o(a) atendente.'
          );
        }
      } else if (msg.includes('auth/invalid-email')) {
        throw new Error('O e-mail informado é inválido.');
      } else if (msg.includes('auth/weak-password')) {
        throw new Error('A senha provisória é muito fraca. Use pelo menos 6 caracteres.');
      } else if (msg.includes('auth/operation-not-allowed')) {
        throw new Error(
          'Ative o login por E-mail/Senha em Firebase Console → Authentication → Sign-in method para cadastrar atendentes.'
        );
      } else {
        throw authErr;
      }
    }

    const novoUid = cred.user.uid;
    const batch = writeBatch(db);
    batch.set(doc(db, 'usuarios', novoUid), {
      comercioId: params.comercioId,
      perfil: 'atendente',
      nome: nomeLimpo,
      email: emailLimpo,
      ativo: true,
      criadoPor: params.donoUid,
      criadoEm: serverTimestamp(),
    });
    batch.set(doc(db, 'auditoria', makeDocId('aud')), {
      comercioId: params.comercioId,
      quem: params.donoUid,
      acao: 'atendente_criado',
      detalhes: `Atendente "${nomeLimpo}" (${emailLimpo}) criado.`,
      quando: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (fsErr) {
      if (createdNewAuthUser && cred) {
        await cred.user.delete().catch(() => {});
      }
      const fsMsg = fsErr instanceof Error ? fsErr.message : String(fsErr);
      if (!createdNewAuthUser && (fsMsg.includes('permission') || fsMsg.includes('PERMISSION_DENIED') || fsMsg.includes('already-exists'))) {
        throw new Error(
          'Este e-mail já está vinculado a uma conta existente no sistema. Use outro e-mail para o(a) atendente.'
        );
      }
      handleFirestoreError(fsErr, OperationType.CREATE, `usuarios/${novoUid}`);
    }
  } finally {
    await cleanup();
  }
}

export async function alternarAtendenteAtivo(params: {
  uidAlvo: string;
  comercioId: string;
  ativo: boolean;
  donoUid: string;
}): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'usuarios', params.uidAlvo), { ativo: params.ativo });
  batch.set(doc(db, 'auditoria', makeDocId('aud')), {
    comercioId: params.comercioId,
    quem: params.donoUid,
    acao: params.ativo ? 'atendente_ativado' : 'atendente_desativado',
    detalhes: `Status do atendente ${params.uidAlvo} alterado para ${params.ativo ? 'ativo' : 'inativo'}.`,
    quando: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `usuarios/${params.uidAlvo}`);
  }
}

export async function gerarLinkConsulta(params: {
  comercioId: string;
  comercioNome: string;
  cliente: Cliente;
  lancamentos: Lancamento[];
  uid: string;
}): Promise<{ rawToken: string; tokenHash: string; expiraEm: Date }> {
  const rawToken = generateRandomTokenHex(32); // 256 bits >= 128 bits
  const tokenHash = await sha256Hex(rawToken);
  const expiraEm = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const last4 = params.cliente.whatsapp.slice(-4);
  const ultimos4Hash = await sha256Hex(`${tokenHash}:${last4}`);

  const baseCalc: LancamentoCalcInput[] = params.lancamentos.map((l) => ({
    id: l.id,
    tipo: l.tipo,
    valor: l.valor,
    vencimento: l.vencimento,
    estornoDe: l.estornoDe,
    criadoEmMs: l.criadoEm.getTime(),
  }));
  const calc = recalcularCarteiraCliente(baseCalc, getBahiaDateString());
  const primeiroNome = params.cliente.nome.trim().split(/\s+/)[0] || 'Cliente';

  const resumo: ResumoPublicoCliente = {
    comercioNome: params.comercioNome,
    primeiroNome,
    saldoDevedor: calc.saldoDevedor,
    valorVencido: calc.valorVencido,
    valorAVencer: calc.valorAVencer,
    proximoVencimento: calc.proximoVencimento,
    atualizadoEmIso: new Date().toISOString(),
    lancamentos: params.lancamentos
      .slice()
      .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())
      .slice(0, 30)
      .map((l) => ({
        id: l.id,
        tipo: l.tipo,
        valor: l.valor,
        forma: l.forma,
        itens: l.itens,
        vencimento: l.vencimento,
        valorEmAberto: calc.comprasAtualizadas.get(l.id) ?? 0,
        criadoEmIso: l.criadoEm.toISOString(),
        estornado: calc.estornadosIds.has(l.id),
      })),
  };

  const payloadCifrado = await encryptPublicPayload(
    JSON.stringify(resumo),
    tokenHash,
    `${params.comercioId}:${last4}`
  );

  // Revoga links anteriores do cliente e cria o novo
  const prevSnap = await getDocs(
    query(
      collection(db, 'linksConsulta'),
      where('comercioId', '==', params.comercioId)
    )
  );

  const batch = writeBatch(db);
  for (const prev of prevSnap.docs.filter((d) => d.data().clienteId === params.cliente.id)) {
    if (!prev.data().revogado) {
      batch.update(prev.ref, { revogado: true });
      batch.update(doc(db, 'consultasPublicas', prev.id), {
        revogado: true,
        atualizadoEm: serverTimestamp(),
      });
    }
  }

  batch.set(doc(db, 'linksConsulta', tokenHash), {
    comercioId: params.comercioId,
    clienteId: params.cliente.id,
    expiraEm: Timestamp.fromDate(expiraEm),
    revogado: false,
    tentativasErradas: 0,
    bloqueadoAte: Timestamp.fromMillis(0),
    criadoPor: params.uid,
    criadoEm: serverTimestamp(),
  });

  batch.set(doc(db, 'consultasPublicas', tokenHash), {
    comercioId: params.comercioId,
    clienteId: params.cliente.id,
    comercioNome: params.comercioNome,
    ultimos4Hash,
    payloadCifrado,
    expiraEm: Timestamp.fromDate(expiraEm),
    revogado: false,
    tentativasErradas: 0,
    bloqueadoAte: Timestamp.fromMillis(0),
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
  });

  batch.set(doc(db, 'auditoria', makeDocId('aud')), {
    comercioId: params.comercioId,
    quem: params.uid,
    acao: 'link_consulta_gerado',
    detalhes: `Novo link de consulta gerado para ${params.cliente.nome}.`,
    quando: serverTimestamp(),
  });

  try {
    await batch.commit();
    return { rawToken, tokenHash, expiraEm };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `linksConsulta/${tokenHash}`);
  }
}

export async function revogarLinkConsulta(params: {
  comercioId: string;
  tokenHash: string;
  uid: string;
}): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'linksConsulta', params.tokenHash), { revogado: true });
  batch.update(doc(db, 'consultasPublicas', params.tokenHash), {
    revogado: true,
    atualizadoEm: serverTimestamp(),
  });
  batch.set(doc(db, 'auditoria', makeDocId('aud')), {
    comercioId: params.comercioId,
    quem: params.uid,
    acao: 'link_consulta_revogado',
    detalhes: `Link ${params.tokenHash.slice(0, 10)}... revogado.`,
    quando: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `linksConsulta/${params.tokenHash}`);
  }
}

export async function consultarSaldoPublicoPorToken(
  rawToken: string,
  ultimos4Digitos: string
): Promise<
  | { status: 'ok'; resumo: ResumoPublicoCliente }
  | { status: 'invalido_digitos'; tentativasRestantes: number }
  | { status: 'bloqueado' | 'indisponivel' }
> {
  const cleanDigits = ultimos4Digitos.replace(/\D/g, '');
  if (!/^\d{4}$/.test(cleanDigits)) {
    return { status: 'invalido_digitos', tentativasRestantes: 5 };
  }
  if (!/^[a-f0-9]{32,128}$/i.test(rawToken.trim())) {
    return { status: 'indisponivel' };
  }

  const tokenHash = await sha256Hex(rawToken.trim());

  // Passa pelo rate limiter do servidor Express antes de consultar
  try {
    const pre = await fetch('/api/consulta/precheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenHash }),
    });
    if (pre.status === 429) {
      return { status: 'bloqueado' };
    }
  } catch {
    // Se estiver offline/cache, segue verificação segura
  }

  let snap;
  try {
    snap = await getDoc(doc(db, 'consultasPublicas', tokenHash));
  } catch {
    return { status: 'indisponivel' };
  }

  if (!snap.exists()) {
    return { status: 'indisponivel' };
  }

  const d = snap.data();
  const agora = Date.now();
  const expiraMs = toDate(d.expiraEm).getTime();
  const bloqueadoMs = toDate(d.bloqueadoAte).getTime();
  const tentativas = Number(d.tentativasErradas ?? 0);

  if (d.revogado || expiraMs <= agora) {
    return { status: 'indisponivel' };
  }
  if (bloqueadoMs > agora || tentativas >= 5) {
    return { status: 'bloqueado' };
  }

  const hashInformado = await sha256Hex(`${tokenHash}:${cleanDigits}`);
  if (hashInformado !== d.ultimos4Hash) {
    const novas = tentativas + 1;
    const bloqueio = novas >= 5 ? Timestamp.fromMillis(agora + 15 * 60 * 1000) : d.bloqueadoAte;
    const batch = writeBatch(db);
    batch.update(doc(db, 'consultasPublicas', tokenHash), {
      tentativasErradas: novas,
      bloqueadoAte: bloqueio,
      atualizadoEm: serverTimestamp(),
    });
    batch.set(doc(db, 'acessosLink', makeDocId('acc')), {
      comercioId: String(d.comercioId),
      tokenHash,
      quando: serverTimestamp(),
      resultado: novas >= 5 ? 'bloqueado' : 'invalido',
    });
    await batch.commit();

    if (novas >= 5) {
      return { status: 'bloqueado' };
    }
    return { status: 'invalido_digitos', tentativasRestantes: Math.max(0, 5 - novas) };
  }

  try {
    const plainJson = await decryptPublicPayload(
      String(d.payloadCifrado),
      tokenHash,
      `${String(d.comercioId)}:${cleanDigits}`
    );
    const resumo = JSON.parse(plainJson) as ResumoPublicoCliente;

    await writeBatch(db)
      .set(doc(db, 'acessosLink', makeDocId('acc')), {
        comercioId: String(d.comercioId),
        tokenHash,
        quando: serverTimestamp(),
        resultado: 'ok',
      })
      .commit();

    return { status: 'ok', resumo };
  } catch {
    return { status: 'indisponivel' };
  }
}

export async function carregarDadosExemplo(params: {
  comercioId: string;
  uid: string;
}): Promise<void> {
  const existentes = await getDocs(
    query(collection(db, 'clientes'), where('comercioId', '==', params.comercioId))
  );
  if (!existentes.empty) {
    throw new Error('Os dados de exemplo só podem ser carregados quando o comércio ainda não tem clientes.');
  }

  const hoje = new Date();
  const diaMs = 24 * 60 * 60 * 1000;
  const isoFromOffset = (daysOffset: number) =>
    getBahiaDateString(new Date(hoje.getTime() + daysOffset * diaMs));

  const ficticios = [
    {
      nome: 'Dona Raimunda Souza (Exemplo)',
      whatsapp: '+5571900001001',
      limiteCredito: 30000,
      diaVencimento: 5,
      compras: [
        { valor: 14500, itens: 'Arroz, feijão, óleo e café', venc: isoFromOffset(-12), aberto: 14500 },
        { valor: 4200, itens: 'Pão francês e manteiga', venc: isoFromOffset(8), aberto: 4200 },
      ],
      pagamentos: [{ valor: 5000, forma: 'dinheiro' as const }],
    },
    {
      nome: 'Seu Antônio Bispo (Exemplo)',
      whatsapp: '+5571900001002',
      limiteCredito: 25000,
      diaVencimento: 10,
      compras: [{ valor: 18900, itens: 'Carne moída, frango e temperos', venc: isoFromOffset(-5), aberto: 18900 }],
      pagamentos: [],
    },
    {
      nome: 'Carla Mendes (Exemplo)',
      whatsapp: '+5571900001003',
      limiteCredito: 40000,
      diaVencimento: 15,
      compras: [{ valor: 12000, itens: 'Leite, açúcar e biscoitos', venc: isoFromOffset(10), aberto: 12000 }],
      pagamentos: [],
    },
    {
      nome: 'Jorge Santana (Exemplo)',
      whatsapp: '+5571900001004',
      limiteCredito: 20000,
      diaVencimento: 20,
      compras: [{ valor: 9500, itens: 'Água mineral e gás de cozinha', venc: isoFromOffset(14), aberto: 6500 }],
      pagamentos: [{ valor: 3000, forma: 'pix_manual' as const }],
    },
    {
      nome: 'Luciana Ferreira (Exemplo)',
      whatsapp: '+5571900001005',
      limiteCredito: 35000,
      diaVencimento: 10,
      compras: [{ valor: 8000, itens: 'Frutas e verduras da feira', venc: isoFromOffset(-2), aberto: 0 }],
      pagamentos: [{ valor: 8000, forma: 'pix_manual' as const }],
    },
    {
      nome: 'Marcos Vinícius Lima (Exemplo)',
      whatsapp: '+5571900001006',
      limiteCredito: 15000,
      diaVencimento: 25,
      compras: [{ valor: 13200, itens: 'Charque, farinha e ovos', venc: isoFromOffset(-20), aberto: 13200 }],
      pagamentos: [],
    },
    {
      nome: 'Tereza Cristina Santos (Exemplo)',
      whatsapp: '+5571900001007',
      limiteCredito: 50000,
      diaVencimento: 12,
      compras: [{ valor: 21500, itens: 'Compras da semana', venc: isoFromOffset(6), aberto: 21500 }],
      pagamentos: [],
    },
    {
      nome: 'Valter Conceição (Exemplo)',
      whatsapp: '+5571900001008',
      limiteCredito: 20000,
      diaVencimento: 18,
      compras: [{ valor: 5400, itens: 'Refrigerante e pão doce', venc: isoFromOffset(-1), aberto: 0 }],
      pagamentos: [{ valor: 5400, forma: 'debito' as const }],
    },
  ];

  const hojeBahia = getBahiaDateString(hoje);
  const clientesBatch = writeBatch(db);
  const lancamentosBatch = writeBatch(db);

  for (const item of ficticios) {
    const cliId = makeDocId('cli');
    const calcInput: LancamentoCalcInput[] = [];
    const createdCompras: Array<{ id: string; valor: number; itens: string; venc: string }> = [];

    item.compras.forEach((c, idx) => {
      const lId = makeDocId('lnc');
      calcInput.push({
        id: lId,
        tipo: 'compra',
        valor: c.valor,
        vencimento: c.venc,
        estornoDe: '',
        criadoEmMs: hoje.getTime() - (20 - idx) * 1000,
      });
      createdCompras.push({ id: lId, valor: c.valor, itens: c.itens, venc: c.venc });
    });

    item.pagamentos.forEach((p, idx) => {
      const lId = makeDocId('lnc');
      calcInput.push({
        id: lId,
        tipo: 'pagamento',
        valor: p.valor,
        vencimento: '',
        estornoDe: '',
        criadoEmMs: hoje.getTime() - (5 - idx) * 1000,
      });
      lancamentosBatch.set(doc(db, 'lancamentos', lId), {
        comercioId: params.comercioId,
        clienteId: cliId,
        tipo: 'pagamento',
        valor: p.valor,
        forma: p.forma,
        itens: '',
        vencimento: '',
        valorEmAberto: 0,
        autorizadoExcecaoPor: '',
        estornoDe: '',
        justificativa: '',
        idempotencyKey: `demo_pag_${cliId}_${idx}`,
        criadoPor: params.uid,
        criadoEm: serverTimestamp(),
      });
    });

    const calc = recalcularCarteiraCliente(calcInput, hojeBahia);

    clientesBatch.set(doc(db, 'clientes', cliId), {
      comercioId: params.comercioId,
      nome: item.nome,
      whatsapp: item.whatsapp,
      consentimentoWhatsapp: true,
      consentimentoEm: serverTimestamp(),
      limiteCredito: item.limiteCredito,
      diaVencimento: item.diaVencimento,
      ativo: true,
      anonimizado: false,
      saldoDevedor: calc.saldoDevedor,
      valorVencido: calc.valorVencido,
      valorAVencer: calc.valorAVencer,
      proximoVencimento: calc.proximoVencimento,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp(),
    });

    for (const c of createdCompras) {
      lancamentosBatch.set(doc(db, 'lancamentos', c.id), {
        comercioId: params.comercioId,
        clienteId: cliId,
        tipo: 'compra',
        valor: c.valor,
        forma: 'fiado',
        itens: c.itens,
        vencimento: c.venc,
        valorEmAberto: calc.comprasAtualizadas.get(c.id) ?? 0,
        autorizadoExcecaoPor: '',
        estornoDe: '',
        justificativa: '',
        idempotencyKey: `demo_cmp_${c.id}`,
        criadoPor: params.uid,
        criadoEm: serverTimestamp(),
      });
    }
  }

  lancamentosBatch.set(doc(db, 'auditoria', makeDocId('aud')), {
    comercioId: params.comercioId,
    quem: params.uid,
    acao: 'dados_exemplo_carregados',
    detalhes: '8 clientes fictícios e lançamentos de exemplo gerados.',
    quando: serverTimestamp(),
  });

  try {
    await clientesBatch.commit();
    await lancamentosBatch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'clientes');
  }
}

export async function exportarDadosComercio(comercioId: string) {
  const [cliSnap, lncSnap] = await Promise.all([
    getDocs(query(collection(db, 'clientes'), where('comercioId', '==', comercioId))),
    getDocs(query(collection(db, 'lancamentos'), where('comercioId', '==', comercioId))),
  ]);
  return {
    exportadoEm: new Date().toISOString(),
    clientes: cliSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    lancamentos: lncSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}
