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
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  type UserCredential,
} from 'firebase/auth';
import { createSecondaryAuthApp, db, handleFirestoreError, OperationType } from './firebase';
import {
  calcularDataPrazoSolicitacao,
  calcularVencimentoCompra,
  formatarNumeroLancamento,
  formatCentavos,
  getBahiaDateString,
  normalizeWhatsAppBR,
  recalcularCarteiraCliente,
  validarCompra,
  validarPagamento,
  type CanalConsentimento,
  type Cliente,
  type Comercio,
  type ConsentimentoEvento,
  type FormaPagamento,
  type Lancamento,
  type LancamentoCalcInput,
  type LinkConsulta,
  type ResumoPublicoCliente,
  type SolicitacaoTitular,
  type TipoSolicitacaoTitular,
  type Usuario,
} from './businessRules';
import { validarChavePix } from './pix';
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
    pixChave: '',
    pixRecebedor: params.nomeComercio.trim().slice(0, 60),
    whatsappContato: '',
    ultimoNumeroLancamento: 0,
    prazoSolicitacaoTitularDias: 15,
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
        pixChave: String(d.pixChave ?? ''),
        pixRecebedor: String(d.pixRecebedor ?? ''),
        whatsappContato: String(d.whatsappContato ?? ''),
        ultimoNumeroLancamento: Number(d.ultimoNumeroLancamento ?? 0),
        prazoSolicitacaoTitularDias: Number(d.prazoSolicitacaoTitularDias ?? 15),
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
            semContatoWhatsapp: Boolean(d.semContatoWhatsapp ?? false),
            limiteCredito: Number(d.limiteCredito ?? 0),
            diaVencimento: Number(d.diaVencimento ?? 10),
            ativo: Boolean(d.ativo),
            anonimizado: Boolean(d.anonimizado),
            saldoDevedor: Number(d.saldoDevedor ?? 0),
            valorVencido: Number(d.valorVencido ?? 0),
            valorAVencer: Number(d.valorAVencer ?? 0),
            proximoVencimento: String(d.proximoVencimento ?? ''),
            observacaoDono: String(d.observacaoDono ?? ''),
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
            numero: d.numero ? String(d.numero) : undefined,
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
          const expiraDate = toDate(d.expiraEm);
          const criadoDate = d.criadoEm
            ? toDate(d.criadoEm)
            : new Date(Math.max(0, expiraDate.getTime() - 30 * 24 * 60 * 60 * 1000));
          return {
            tokenHash: docSnap.id,
            comercioId: String(d.comercioId),
            clienteId: String(d.clienteId),
            expiraEm: expiraDate,
            revogado: Boolean(d.revogado),
            tentativasErradas: Number(d.tentativasErradas ?? 0),
            bloqueadoAte: toDate(d.bloqueadoAte),
            criadoPor: String(d.criadoPor),
            criadoEm: criadoDate,
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
    semContatoWhatsapp: false,
    limiteCredito: Math.max(0, Math.round(params.limiteCreditoCentavos)),
    diaVencimento: dia,
    ativo: true,
    anonimizado: false,
    saldoDevedor: 0,
    valorVencido: 0,
    valorAVencer: 0,
    proximoVencimento: '',
    observacaoDono: '',
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
  });

  batch.set(doc(db, 'consentimentos', makeDocId('cns')), {
    comercioId: params.comercioId,
    clienteId,
    tipo: 'consentimento',
    dataHora: serverTimestamp(),
    canal: 'cadastro',
    responsavel: params.uid,
    origem: 'Consentimento coletado no cadastro do cliente',
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
  consentimentoWhatsapp?: boolean;
  consentimentoAnterior?: boolean;
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

  // RN06 / RNF06: Atendente só edita nome e whatsapp; diaVencimento e consentimento são exclusivos do Dono
  const payload: Record<string, unknown> = {
    nome: params.nome.trim(),
    whatsapp: e164,
    atualizadoEm: serverTimestamp(),
  };

  if (params.perfil === 'dono') {
    payload.diaVencimento = dia;
    payload.limiteCredito = Math.max(0, Math.round(params.limiteCreditoCentavos));
    if (typeof params.ativo === 'boolean') {
      payload.ativo = params.ativo;
    }
    if (params.consentimentoWhatsapp && !params.consentimentoAnterior) {
      payload.consentimentoWhatsapp = true;
      payload.consentimentoEm = serverTimestamp();
      payload.semContatoWhatsapp = false;
      batch.set(doc(db, 'consentimentos', makeDocId('cns')), {
        comercioId: params.comercioId,
        clienteId: params.clienteId,
        tipo: 'consentimento',
        dataHora: serverTimestamp(),
        canal: 'cadastro',
        responsavel: params.uid,
        origem: 'Consentimento registrado pelo Dono na edição do cliente',
      });
    }
  }

  batch.update(clienteRef, payload);

  // Se Dono inativar cliente, revoga links ativos automaticamente
  const linksParaRevogarConsultas: string[] = [];
  if (params.perfil === 'dono' && params.ativo === false) {
    const linksSnap = await getDocs(
      query(
        collection(db, 'linksConsulta'),
        where('comercioId', '==', params.comercioId)
      )
    );
    for (const lDoc of linksSnap.docs.filter((d) => d.data().clienteId === params.clienteId)) {
      batch.update(lDoc.ref, { revogado: true });
      linksParaRevogarConsultas.push(lDoc.id);
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

  for (const tokenHash of linksParaRevogarConsultas) {
    try {
      await writeBatch(db)
        .update(doc(db, 'consultasPublicas', tokenHash), {
          revogado: true,
          atualizadoEm: serverTimestamp(),
        })
        .commit();
    } catch {
      // Melhor esforço caso documento legado não exista em consultasPublicas
    }
  }
}

export function observarConsentimentosCliente(
  comercioId: string,
  clienteId: string,
  onData: (eventos: ConsentimentoEvento[]) => void
): Unsubscribe {
  const q = query(collection(db, 'consentimentos'), where('comercioId', '==', comercioId));
  return onSnapshot(
    q,
    (snap) => {
      const list: ConsentimentoEvento[] = snap.docs
        .filter((d) => d.data().clienteId === clienteId)
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            comercioId: String(data.comercioId),
            clienteId: String(data.clienteId),
            tipo: (data.tipo === 'opt_out' ? 'opt_out' : 'consentimento') as ConsentimentoEvento['tipo'],
            dataHora: toDate(data.dataHora),
            canal: (data.canal || 'balcao') as CanalConsentimento,
            responsavel: String(data.responsavel ?? ''),
            origem: String(data.origem ?? ''),
          };
        })
        .sort((a, b) => b.dataHora.getTime() - a.dataHora.getTime());
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'consentimentos')
  );
}

export async function registrarOptOutWhatsApp(params: {
  comercioId: string;
  clienteId: string;
  clienteNome: string;
  canal: CanalConsentimento;
  origem: string;
  uid: string;
  perfil?: 'dono' | 'atendente';
}): Promise<void> {
  const origemLimpa = params.origem.trim().slice(0, 160);
  if (origemLimpa.length < 2) {
    throw new Error('Informe a origem do pedido de opt-out (mínimo 2 caracteres).');
  }

  const cliRef = doc(db, 'clientes', params.clienteId);
  let cliData: Record<string, unknown> | null = null;
  try {
    const cliSnap = await getDoc(cliRef);
    if (!cliSnap.exists()) {
      throw new Error('Cliente não encontrado.');
    }
    cliData = cliSnap.data() as Record<string, unknown>;
  } catch (err) {
    if (err instanceof Error && err.message === 'Cliente não encontrado.') throw err;
    handleFirestoreError(err, OperationType.GET, `clientes/${params.clienteId}`);
  }

  const cliUpdate: Record<string, unknown> = {
    semContatoWhatsapp: true,
    atualizadoEm: serverTimestamp(),
  };

  // Se Dono e documento legado tiver alguma inconsistência de schema, normaliza apenas o necessário
  if (params.perfil === 'dono' && cliData) {
    if (typeof cliData.anonimizado !== 'boolean') {
      cliUpdate.anonimizado = false;
    }
    if (typeof cliData.ativo !== 'boolean') {
      cliUpdate.ativo = true;
    }
    if (typeof cliData.consentimentoWhatsapp !== 'boolean') {
      cliUpdate.consentimentoWhatsapp = true;
    }
    if (!cliData.consentimentoEm) {
      cliUpdate.consentimentoEm = cliData.criadoEm || serverTimestamp();
    }
    if (typeof cliData.proximoVencimento !== 'string') {
      cliUpdate.proximoVencimento = '';
    }
    const diaRaw = Number(cliData.diaVencimento ?? 10);
    if (!Number.isInteger(diaRaw) || diaRaw < 1 || diaRaw > 28) {
      cliUpdate.diaVencimento = Math.max(1, Math.min(28, Math.round(diaRaw || 10)));
    }
    const vVenc = Math.max(0, Math.round(Number(cliData.valorVencido ?? 0)));
    const vAVenc = Math.max(0, Math.round(Number(cliData.valorAVencer ?? 0)));
    const saldoAtual = Math.max(0, Math.round(Number(cliData.saldoDevedor ?? 0)));
    if (
      typeof cliData.valorVencido !== 'number' ||
      typeof cliData.valorAVencer !== 'number' ||
      typeof cliData.saldoDevedor !== 'number' ||
      saldoAtual !== vVenc + vAVenc
    ) {
      cliUpdate.valorVencido = vVenc;
      cliUpdate.valorAVencer = vAVenc;
      cliUpdate.saldoDevedor = vVenc + vAVenc;
    }
  }

  try {
    await writeBatch(db).update(cliRef, cliUpdate).commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `clientes/${params.clienteId}`);
  }

  const cnsId = makeDocId('cns');
  const batch = writeBatch(db);
  batch.set(doc(db, 'consentimentos', cnsId), {
    comercioId: params.comercioId,
    clienteId: params.clienteId,
    tipo: 'opt_out',
    dataHora: serverTimestamp(),
    canal: params.canal,
    responsavel: params.uid,
    origem: origemLimpa,
  });
  batch.set(doc(db, 'auditoria', makeDocId('aud')), {
    comercioId: params.comercioId,
    quem: params.uid,
    acao: 'whatsapp_opt_out',
    detalhes: `Opt-out de WhatsApp registrado para ${params.clienteNome} via ${params.canal} (${origemLimpa}).`.slice(0, 300),
    quando: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `consentimentos/${cnsId}`);
  }
}

export async function registrarNovoConsentimentoWhatsApp(params: {
  comercioId: string;
  clienteId: string;
  clienteNome: string;
  canal: CanalConsentimento;
  origem: string;
  uid: string;
}): Promise<void> {
  const origemLimpa = params.origem.trim().slice(0, 160);
  if (origemLimpa.length < 2) {
    throw new Error('Informe a origem do novo consentimento.');
  }

  const cliRef = doc(db, 'clientes', params.clienteId);
  try {
    await writeBatch(db)
      .update(cliRef, {
        consentimentoWhatsapp: true,
        consentimentoEm: serverTimestamp(),
        semContatoWhatsapp: false,
        atualizadoEm: serverTimestamp(),
      })
      .commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `clientes/${params.clienteId}`);
  }

  const cnsId = makeDocId('cns');
  const batch = writeBatch(db);
  batch.set(doc(db, 'consentimentos', cnsId), {
    comercioId: params.comercioId,
    clienteId: params.clienteId,
    tipo: 'consentimento',
    dataHora: serverTimestamp(),
    canal: params.canal,
    responsavel: params.uid,
    origem: origemLimpa,
  });
  batch.set(doc(db, 'auditoria', makeDocId('aud')), {
    comercioId: params.comercioId,
    quem: params.uid,
    acao: 'whatsapp_consentimento_renovado',
    detalhes: `Novo consentimento de WhatsApp registrado para ${params.clienteNome} via ${params.canal}.`.slice(0, 300),
    quando: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `consentimentos/${cnsId}`);
  }
}

export function observarSolicitacoesTitularCliente(
  comercioId: string,
  clienteId: string,
  onData: (solicitacoes: SolicitacaoTitular[]) => void
): Unsubscribe {
  const q = query(collection(db, 'solicitacoesTitular'), where('comercioId', '==', comercioId));
  return onSnapshot(
    q,
    (snap) => {
      const list: SolicitacaoTitular[] = snap.docs
        .filter((d) => d.data().clienteId === clienteId)
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            comercioId: String(data.comercioId),
            clienteId: String(data.clienteId),
            tipo: data.tipo as TipoSolicitacaoTitular,
            dataAbertura: toDate(data.dataAbertura),
            prazoEm: toDate(data.prazoEm),
            status: (data.status === 'atendida' ? 'atendida' : 'aberta') as SolicitacaoTitular['status'],
            responsavel: String(data.responsavel ?? ''),
            observacao: String(data.observacao ?? ''),
            concluidaPor: data.concluidaPor ? String(data.concluidaPor) : undefined,
            dataConclusao: data.dataConclusao ? toDate(data.dataConclusao) : null,
          };
        })
        .sort((a, b) => b.dataAbertura.getTime() - a.dataAbertura.getTime());
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'solicitacoesTitular')
  );
}

export async function criarSolicitacaoTitular(params: {
  comercioId: string;
  clienteId: string;
  clienteNome: string;
  tipo: TipoSolicitacaoTitular;
  observacao: string;
  diasPrazo?: number;
  uid: string;
}): Promise<string> {
  const solicitacaoId = makeDocId('lgpd');
  const agora = new Date();
  const prazoDate = calcularDataPrazoSolicitacao(agora, params.diasPrazo ?? 15);
  const obs = params.observacao.trim().slice(0, 300);

  const batch = writeBatch(db);
  batch.set(doc(db, 'solicitacoesTitular', solicitacaoId), {
    comercioId: params.comercioId,
    clienteId: params.clienteId,
    tipo: params.tipo,
    dataAbertura: serverTimestamp(),
    prazoEm: Timestamp.fromDate(prazoDate),
    status: 'aberta',
    responsavel: params.uid,
    observacao: obs,
    concluidaPor: '',
  });
  batch.set(doc(db, 'auditoria', makeDocId('aud')), {
    comercioId: params.comercioId,
    quem: params.uid,
    acao: 'solicitacao_titular_aberta',
    detalhes: `Solicitação LGPD (${params.tipo}) aberta para ${params.clienteNome}.`.slice(0, 300),
    quando: serverTimestamp(),
  });

  try {
    await batch.commit();
    return solicitacaoId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `solicitacoesTitular/${solicitacaoId}`);
  }
}

export async function concluirSolicitacaoTitular(params: {
  comercioId: string;
  solicitacaoId: string;
  clienteNome: string;
  observacao: string;
  uid: string;
}): Promise<void> {
  const obs = params.observacao.trim().slice(0, 300);
  const batch = writeBatch(db);
  batch.update(doc(db, 'solicitacoesTitular', params.solicitacaoId), {
    status: 'atendida',
    observacao: obs,
    concluidaPor: params.uid,
    dataConclusao: serverTimestamp(),
  });
  batch.set(doc(db, 'auditoria', makeDocId('aud')), {
    comercioId: params.comercioId,
    quem: params.uid,
    acao: 'solicitacao_titular_atendida',
    detalhes: `Solicitação LGPD ${params.solicitacaoId} de ${params.clienteNome} concluída.`.slice(0, 300),
    quando: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `solicitacoesTitular/${params.solicitacaoId}`);
  }
}

export async function exportarDadosCliente(comercioId: string, clienteId: string) {
  const [cliSnap, lncSnap, consSnap, solSnap] = await Promise.all([
    getDoc(doc(db, 'clientes', clienteId)),
    getDocs(query(collection(db, 'lancamentos'), where('comercioId', '==', comercioId))),
    getDocs(query(collection(db, 'consentimentos'), where('comercioId', '==', comercioId))),
    getDocs(query(collection(db, 'solicitacoesTitular'), where('comercioId', '==', comercioId))),
  ]);

  if (!cliSnap.exists() || cliSnap.data().comercioId !== comercioId) {
    throw new Error('Cliente não encontrado neste comércio.');
  }

  return {
    exportadoEm: new Date().toISOString(),
    cliente: { id: cliSnap.id, ...cliSnap.data() },
    lancamentos: lncSnap.docs
      .filter((d) => d.data().clienteId === clienteId)
      .map((d) => ({ id: d.id, ...d.data() })),
    consentimentos: consSnap.docs
      .filter((d) => d.data().clienteId === clienteId)
      .map((d) => ({ id: d.id, ...d.data() })),
    solicitacoesTitular: solSnap.docs
      .filter((d) => d.data().clienteId === clienteId)
      .map((d) => ({ id: d.id, ...d.data() })),
  };
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
  const linksParaRevogarConsultas: string[] = [];
  for (const lDoc of linksSnap.docs.filter((d) => d.data().clienteId === params.clienteId)) {
    batch.update(lDoc.ref, { revogado: true });
    linksParaRevogarConsultas.push(lDoc.id);
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

  for (const tokenHash of linksParaRevogarConsultas) {
    try {
      await writeBatch(db)
        .update(doc(db, 'consultasPublicas', tokenHash), {
          revogado: true,
          atualizadoEm: serverTimestamp(),
        })
        .commit();
    } catch {
      // Melhor esforço caso documento legado não exista em consultasPublicas
    }
  }
}

async function sincronizarConsultasPublicasCliente(params: {
  comercioId: string;
  comercioNome: string;
  pixChave?: string;
  pixRecebedor?: string;
  comercioWhatsapp?: string;
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
    numero?: string;
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

  let pixChave = params.pixChave;
  let pixRecebedor = params.pixRecebedor;
  let comercioWhatsapp = params.comercioWhatsapp;
  if (pixChave === undefined || pixRecebedor === undefined || comercioWhatsapp === undefined) {
    const comSnap = await getDoc(doc(db, 'comercios', params.comercioId));
    if (comSnap.exists()) {
      const cd = comSnap.data();
      pixChave = String(cd.pixChave ?? '');
      pixRecebedor = String(cd.pixRecebedor ?? '');
      comercioWhatsapp = String(cd.whatsappContato ?? '');
    }
  }

  const last4 = params.clienteWhatsapp.slice(-4);
  const primeiroNome = params.clienteNome.trim().split(/\s+/)[0] || 'Cliente';
  const comercioNomeRaw = params.comercioNome.trim().slice(0, 80);
  const comercioNomeSeguro = comercioNomeRaw.length >= 2 ? comercioNomeRaw : 'Comércio';
  const ordenados = params.rawLancamentosDocs
    .slice()
    .sort((a, b) => b.criadoEmMs - a.criadoEmMs);

  const buildSummaryJson = (limiteItens: number) => {
    const resumo: ResumoPublicoCliente = {
      comercioNome: comercioNomeSeguro,
      primeiroNome,
      saldoDevedor: params.saldoDevedor,
      valorVencido: params.valorVencido,
      valorAVencer: params.valorAVencer,
      proximoVencimento: params.proximoVencimento,
      atualizadoEmIso: new Date().toISOString(),
      pixChave: pixChave || '',
      pixRecebedor: pixRecebedor || comercioNomeSeguro,
      comercioWhatsapp: comercioWhatsapp || '',
      lancamentos: ordenados.slice(0, limiteItens).map((l) => ({
        id: l.id,
        numero: l.numero,
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
    return JSON.stringify(resumo);
  };

  for (const linkDoc of activeLinks) {
    const tokenHash = linkDoc.id;
    let enc = '';
    for (const limiteItens of [30, 15, 5, 0]) {
      enc = await encryptPublicPayload(
        buildSummaryJson(limiteItens),
        tokenHash,
        `${params.comercioId}:${last4}`
      );
      if (enc.length <= 30000) break;
    }
    try {
      await writeBatch(db)
        .update(doc(db, 'consultasPublicas', tokenHash), {
          comercioNome: comercioNomeSeguro,
          payloadCifrado: enc,
          atualizadoEm: serverTimestamp(),
        })
        .commit();
    } catch {
      // Melhor esforço individual caso exista link legado sem projeção pública
    }
  }
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
        numero: data.numero ? String(data.numero) : undefined,
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
}): Promise<{
  lancamentoId: string;
  numero?: string;
  saldoAnterior: number;
  novoSaldo: number;
  limiteCredito: number;
}> {
  const idem = params.idempotencyKey || generateIdempotencyKey('cmp');

  const existingLancamentos = await fetchClientLancamentos(params.comercioId, params.clienteId);
  const existingIdem = existingLancamentos.find((l) => l.idempotencyKey === idem);
  if (existingIdem) {
    const cliSnap = await getDoc(doc(db, 'clientes', params.clienteId));
    const novoSaldoExist = Number(cliSnap.data()?.saldoDevedor ?? 0);
    return {
      lancamentoId: existingIdem.id,
      numero: existingIdem.numero,
      saldoAnterior: Math.max(0, novoSaldoExist - existingIdem.valor),
      novoSaldo: novoSaldoExist,
      limiteCredito: Number(cliSnap.data()?.limiteCredito ?? 0),
    };
  }

  const lancamentoId = makeDocId('lnc');
  const agora = new Date();
  const hojeBahia = getBahiaDateString(agora);

  let resultadoCarteiraFinal!: ReturnType<typeof recalcularCarteiraCliente>;
  let saldoAnterior = 0;
  let limiteCreditoCliente = 0;
  let clienteNome = '';
  let clienteWhatsapp = '';
  let novoLancamentoCalc: LancamentoCalcInput | null = null;
  let vencimentoStr = '';
  let numeroLancamento = '';

  try {
    await runTransaction(db, async (tx) => {
      const comRef = doc(db, 'comercios', params.comercioId);
      const cliRef = doc(db, 'clientes', params.clienteId);
      const [comSnap, cliSnap] = await Promise.all([tx.get(comRef), tx.get(cliRef)]);
      if (!comSnap.exists()) throw new Error('Comércio não encontrado.');
      if (!cliSnap.exists()) throw new Error('Cliente não encontrado.');
      const cli = cliSnap.data();
      if (!cli.ativo || cli.anonimizado) {
        throw new Error('Cliente inativo ou anonimizado.');
      }

      const proximoNumero = Number(comSnap.data()?.ultimoNumeroLancamento ?? 0) + 1;
      numeroLancamento = formatarNumeroLancamento('compra', proximoNumero);

      clienteNome = String(cli.nome);
      clienteWhatsapp = String(cli.whatsapp);
      const limiteCredito = Number(cli.limiteCredito ?? 0);
      limiteCreditoCliente = limiteCredito;
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
      saldoAnterior = atual.saldoDevedor;

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
        numero: numeroLancamento,
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

      const comRefUpdate = doc(db, 'comercios', params.comercioId);
      const numeroSeq = Number.parseInt(numeroLancamento.split('-')[1] || '1', 10);
      tx.update(comRefUpdate, {
        ultimoNumeroLancamento: numeroSeq,
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
        detalhes: `Compra ${numeroLancamento} de ${params.valorCentavos} centavos para ${clienteNome}.`,
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
            numero: numeroLancamento,
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

  return {
    lancamentoId,
    numero: numeroLancamento,
    saldoAnterior,
    novoSaldo: resultadoCarteiraFinal.saldoDevedor,
    limiteCredito: limiteCreditoCliente,
  };
}

export async function registrarPagamento(params: {
  comercioId: string;
  comercioNome: string;
  clienteId: string;
  valorCentavos: number;
  forma: 'dinheiro' | 'pix_manual' | 'debito';
  uid: string;
  idempotencyKey?: string;
}): Promise<{
  lancamentoId: string;
  numero?: string;
  saldoAnterior: number;
  novoSaldo: number;
  limiteCredito: number;
}> {
  const idem = params.idempotencyKey || generateIdempotencyKey('pag');

  const existingLancamentos = await fetchClientLancamentos(params.comercioId, params.clienteId);
  const existingIdem = existingLancamentos.find((l) => l.idempotencyKey === idem);
  if (existingIdem) {
    const cliSnap = await getDoc(doc(db, 'clientes', params.clienteId));
    const novoSaldoExist = Number(cliSnap.data()?.saldoDevedor ?? 0);
    return {
      lancamentoId: existingIdem.id,
      numero: existingIdem.numero,
      saldoAnterior: novoSaldoExist + existingIdem.valor,
      novoSaldo: novoSaldoExist,
      limiteCredito: Number(cliSnap.data()?.limiteCredito ?? 0),
    };
  }
  const lancamentoId = makeDocId('lnc');
  const agora = new Date();
  const hojeBahia = getBahiaDateString(agora);

  let resultadoCarteiraFinal!: ReturnType<typeof recalcularCarteiraCliente>;
  let saldoAnterior = 0;
  let limiteCreditoCliente = 0;
  let clienteNome = '';
  let clienteWhatsapp = '';
  let novoLancamentoCalc: LancamentoCalcInput | null = null;
  let numeroLancamento = '';

  try {
    await runTransaction(db, async (tx) => {
      const comRef = doc(db, 'comercios', params.comercioId);
      const cliRef = doc(db, 'clientes', params.clienteId);
      const [comSnap, cliSnap] = await Promise.all([tx.get(comRef), tx.get(cliRef)]);
      if (!comSnap.exists()) throw new Error('Comércio não encontrado.');
      if (!cliSnap.exists()) throw new Error('Cliente não encontrado.');
      const cli = cliSnap.data();
      if (!cli.ativo || cli.anonimizado) {
        throw new Error('Cliente inativo ou anonimizado.');
      }

      const proximoNumero = Number(comSnap.data()?.ultimoNumeroLancamento ?? 0) + 1;
      numeroLancamento = formatarNumeroLancamento('pagamento', proximoNumero);

      clienteNome = String(cli.nome);
      clienteWhatsapp = String(cli.whatsapp);
      limiteCreditoCliente = Number(cli.limiteCredito ?? 0);

      const baseCalc: LancamentoCalcInput[] = existingLancamentos.map((l) => ({
        id: l.id,
        tipo: l.tipo,
        valor: l.valor,
        vencimento: l.vencimento,
        estornoDe: l.estornoDe,
        criadoEmMs: l.criadoEmMs,
      }));
      const atual = recalcularCarteiraCliente(baseCalc, hojeBahia);
      saldoAnterior = atual.saldoDevedor;

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
        numero: numeroLancamento,
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

      const comRefUpdate = doc(db, 'comercios', params.comercioId);
      const numeroSeq = Number.parseInt(numeroLancamento.split('-')[1] || '1', 10);
      tx.update(comRefUpdate, {
        ultimoNumeroLancamento: numeroSeq,
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
        detalhes: `Pagamento ${numeroLancamento} (${params.forma}) de ${params.valorCentavos} centavos de ${clienteNome}.`,
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
            numero: numeroLancamento,
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

  return {
    lancamentoId,
    numero: numeroLancamento,
    saldoAnterior,
    novoSaldo: resultadoCarteiraFinal.saldoDevedor,
    limiteCredito: limiteCreditoCliente,
  };
}

export async function estornarLancamento(params: {
  comercioId: string;
  comercioNome: string;
  clienteId: string;
  lancamentoAlvo: Lancamento;
  justificativa: string;
  uid: string;
}): Promise<{
  lancamentoId: string;
  numero: string;
  saldoAnterior: number;
  novoSaldo: number;
  limiteCredito: number;
}> {
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
  let saldoAnterior = 0;
  let limiteCreditoCliente = 0;
  let clienteNome = '';
  let clienteWhatsapp = '';
  let numeroEstorno = '';

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
      const comRef = doc(db, 'comercios', params.comercioId);
      const cliRef = doc(db, 'clientes', params.clienteId);
      const [comSnap, cliSnap] = await Promise.all([tx.get(comRef), tx.get(cliRef)]);
      if (!comSnap.exists()) throw new Error('Comércio não encontrado.');
      if (!cliSnap.exists()) throw new Error('Cliente não encontrado.');
      const cli = cliSnap.data();
      clienteNome = String(cli.nome);
      clienteWhatsapp = String(cli.whatsapp);
      limiteCreditoCliente = Number(cli.limiteCredito ?? 0);

      const proximoNumero = Number(comSnap.data()?.ultimoNumeroLancamento ?? 0) + 1;
      numeroEstorno = formatarNumeroLancamento('estorno', proximoNumero);

      const baseCalc: LancamentoCalcInput[] = existingLancamentos.map((l) => ({
        id: l.id,
        tipo: l.tipo,
        valor: l.valor,
        vencimento: l.vencimento,
        estornoDe: l.estornoDe,
        criadoEmMs: l.criadoEmMs,
      }));
      saldoAnterior = recalcularCarteiraCliente(baseCalc, hojeBahia).saldoDevedor;

      const novoCalc = recalcularCarteiraCliente([...baseCalc, estornoCalc], hojeBahia);
      resultadoCarteiraFinal = novoCalc;

      tx.set(doc(db, 'lancamentos', estornoId), {
        comercioId: params.comercioId,
        clienteId: params.clienteId,
        numero: numeroEstorno,
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

      tx.update(comRef, {
        ultimoNumeroLancamento: proximoNumero,
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
        detalhes: `Estorno ${numeroEstorno} de ${params.lancamentoAlvo.tipo} (${params.lancamentoAlvo.valor}c) — Motivo: ${just.slice(0, 120)}`,
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
          numero: numeroEstorno,
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

  return {
    lancamentoId: estornoId,
    numero: numeroEstorno,
    saldoAnterior,
    novoSaldo: resultadoCarteiraFinal.saldoDevedor,
    limiteCredito: limiteCreditoCliente,
  };
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
  pixChave?: string;
  pixRecebedor?: string;
  whatsappContato?: string;
  prazoSolicitacaoTitularDias?: number;
  uid: string;
}): Promise<void> {
  const nomeLimpo = params.nome.trim();
  if (nomeLimpo.length < 3 || nomeLimpo.length > 80) {
    throw new Error('O nome do comércio deve ter entre 3 e 80 caracteres.');
  }

  let pixChaveNorm = '';
  const pixChaveRaw = (params.pixChave ?? '').trim();
  if (pixChaveRaw) {
    const valid = validarChavePix(pixChaveRaw);
    if (!valid.valida || !valid.chaveNormalizada) {
      throw new Error(valid.erro || 'Chave Pix inválida.');
    }
    pixChaveNorm = valid.chaveNormalizada;
  }

  const pixRecebedorLimpo = (params.pixRecebedor ?? '').trim().slice(0, 60);
  if (pixChaveNorm && pixRecebedorLimpo.length < 2) {
    throw new Error('Informe o nome do recebedor para exibir no Pix.');
  }

  let whatsappNorm = '';
  const whatsappRaw = (params.whatsappContato ?? '').trim();
  if (whatsappRaw) {
    const e164 = normalizeWhatsAppBR(whatsappRaw);
    if (!e164) {
      throw new Error('WhatsApp do comércio inválido. Informe DDD + número com 10 ou 11 dígitos.');
    }
    whatsappNorm = e164;
  }

  const prazoDias = Math.max(1, Math.min(90, Math.round(params.prazoSolicitacaoTitularDias ?? 15)));

  const payload: Record<string, unknown> = {
    nome: nomeLimpo,
    limitePadrao: Math.max(0, Math.round(params.limitePadraoCentavos)),
    pixChave: pixChaveNorm,
    pixRecebedor: pixRecebedorLimpo || nomeLimpo.slice(0, 60),
    whatsappContato: whatsappNorm,
    prazoSolicitacaoTitularDias: prazoDias,
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
    detalhes: 'Configurações do comércio e Pix atualizadas pelo Dono.',
    quando: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `comercios/${params.comercioId}`);
  }

  // Re-sincroniza melhor-esforço dos links públicos ativos para refletir a nova chave Pix
  try {
    const [linksSnap, cliSnap, lncSnap] = await Promise.all([
      getDocs(query(collection(db, 'linksConsulta'), where('comercioId', '==', params.comercioId))),
      getDocs(query(collection(db, 'clientes'), where('comercioId', '==', params.comercioId))),
      getDocs(query(collection(db, 'lancamentos'), where('comercioId', '==', params.comercioId))),
    ]);
    const activeClientIds = new Set<string>(
      linksSnap.docs
        .filter((d) => !d.data().revogado && toDate(d.data().expiraEm).getTime() > Date.now())
        .map((d) => String(d.data().clienteId))
    );
    const hojeBahia = getBahiaDateString();
    for (const cDoc of cliSnap.docs) {
      if (!activeClientIds.has(cDoc.id)) continue;
      const cd = cDoc.data();
      const cliLancs = lncSnap.docs
        .filter((ld) => ld.data().clienteId === cDoc.id)
        .map((ld) => {
          const d = ld.data();
          return {
            id: ld.id,
            tipo: d.tipo as Lancamento['tipo'],
            valor: Number(d.valor ?? 0),
            forma: d.forma as FormaPagamento,
            itens: String(d.itens ?? ''),
            vencimento: String(d.vencimento ?? ''),
            estornoDe: String(d.estornoDe ?? ''),
            criadoEmMs: toDate(d.criadoEm).getTime() || Date.now(),
          };
        });
      const calc = recalcularCarteiraCliente(cliLancs, hojeBahia);
      await sincronizarConsultasPublicasCliente({
        comercioId: params.comercioId,
        comercioNome: nomeLimpo,
        pixChave: pixChaveNorm,
        pixRecebedor: pixRecebedorLimpo || nomeLimpo.slice(0, 60),
        comercioWhatsapp: whatsappNorm,
        clienteId: cDoc.id,
        clienteNome: String(cd.nome),
        clienteWhatsapp: String(cd.whatsapp),
        saldoDevedor: calc.saldoDevedor,
        valorVencido: calc.valorVencido,
        valorAVencer: calc.valorAVencer,
        proximoVencimento: calc.proximoVencimento,
        lancamentos: cliLancs,
        estornadosIds: calc.estornadosIds,
        comprasAtualizadas: calc.comprasAtualizadas,
        rawLancamentosDocs: cliLancs,
      });
    }
  } catch (syncErr) {
    console.warn('Aviso ao sincronizar links públicos após salvar configurações:', syncErr);
  }
}

export async function ajustarLimiteCliente(params: {
  comercioId: string;
  clienteId: string;
  clienteNome: string;
  limiteAnteriorCentavos: number;
  novoLimiteCentavos: number;
  uid: string;
  responsavelNome: string;
}): Promise<void> {
  const novoLimite = Math.max(0, Math.round(params.novoLimiteCentavos));
  if (novoLimite > 100_000_000) {
    throw new Error('O limite máximo permitido é de R$ 1.000.000,00.');
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'clientes', params.clienteId), {
    limiteCredito: novoLimite,
    atualizadoEm: serverTimestamp(),
  });
  batch.set(doc(db, 'auditoria', makeDocId('aud')), {
    comercioId: params.comercioId,
    quem: params.uid,
    acao: 'limite_ajustado',
    detalhes: `Limite de ${params.clienteNome} ajustado de ${formatCentavos(
      params.limiteAnteriorCentavos
    )} para ${formatCentavos(novoLimite)} por ${params.responsavelNome}.`.slice(0, 300),
    quando: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `clientes/${params.clienteId}`);
  }
}

export async function salvarObservacaoDonoCliente(params: {
  comercioId: string;
  clienteId: string;
  clienteNome: string;
  observacao: string;
  uid: string;
}): Promise<void> {
  const obs = params.observacao.trim().slice(0, 300);
  const batch = writeBatch(db);
  batch.update(doc(db, 'clientes', params.clienteId), {
    observacaoDono: obs,
    atualizadoEm: serverTimestamp(),
  });
  batch.set(doc(db, 'auditoria', makeDocId('aud')), {
    comercioId: params.comercioId,
    quem: params.uid,
    acao: 'observacao_cobranca_atualizada',
    detalhes: `Observação de cobrança de ${params.clienteNome} atualizada pelo Dono.`.slice(0, 300),
    quando: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `clientes/${params.clienteId}`);
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
  pixChave?: string;
  pixRecebedor?: string;
  comercioWhatsapp?: string;
  cliente: Cliente;
  lancamentos: Lancamento[];
  uid: string;
}): Promise<{ rawToken: string; tokenHash: string; expiraEm: Date }> {
  const rawToken = generateRandomTokenHex(32); // 256 bits >= 128 bits
  const tokenHash = await sha256Hex(rawToken);
  const expiraEm = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const last4 = params.cliente.whatsapp.slice(-4);
  const ultimos4Hash = await sha256Hex(`${tokenHash}:${last4}`);

  let pixChave = params.pixChave;
  let pixRecebedor = params.pixRecebedor;
  let comercioWhatsapp = params.comercioWhatsapp;
  let comercioNomeBase = params.comercioNome;
  if (pixChave === undefined || pixRecebedor === undefined || comercioWhatsapp === undefined || !comercioNomeBase.trim()) {
    try {
      const comSnap = await getDoc(doc(db, 'comercios', params.comercioId));
      if (comSnap.exists()) {
        const cd = comSnap.data();
        if (!comercioNomeBase.trim()) comercioNomeBase = String(cd.nome ?? '');
        if (pixChave === undefined) pixChave = String(cd.pixChave ?? '');
        if (pixRecebedor === undefined) pixRecebedor = String(cd.pixRecebedor ?? '');
        if (comercioWhatsapp === undefined) comercioWhatsapp = String(cd.whatsappContato ?? '');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `comercios/${params.comercioId}`);
    }
  }

  const comercioNomeLimpo = comercioNomeBase.trim().slice(0, 80);
  const comercioNomeSeguro = comercioNomeLimpo.length >= 2 ? comercioNomeLimpo : 'Comércio';

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

  const lancamentosOrdenados = params.lancamentos
    .slice()
    .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());

  let payloadCifrado = '';
  for (const limiteItens of [30, 15, 5, 0]) {
    const resumo: ResumoPublicoCliente = {
      comercioNome: comercioNomeSeguro,
      primeiroNome,
      saldoDevedor: calc.saldoDevedor,
      valorVencido: calc.valorVencido,
      valorAVencer: calc.valorAVencer,
      proximoVencimento: calc.proximoVencimento,
      atualizadoEmIso: new Date().toISOString(),
      pixChave: pixChave || '',
      pixRecebedor: pixRecebedor || comercioNomeSeguro,
      comercioWhatsapp: comercioWhatsapp || '',
      lancamentos: lancamentosOrdenados.slice(0, limiteItens).map((l) => ({
        id: l.id,
        numero: l.numero,
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

    payloadCifrado = await encryptPublicPayload(
      JSON.stringify(resumo),
      tokenHash,
      `${params.comercioId}:${last4}`
    );
    if (payloadCifrado.length <= 30000) {
      break;
    }
  }

  // Busca links anteriores para revogação após criar o novo link
  let prevDocsParaRevogar: QueryDocumentSnapshot<DocumentData>[] = [];
  try {
    const prevSnap = await getDocs(
      query(
        collection(db, 'linksConsulta'),
        where('comercioId', '==', params.comercioId)
      )
    );
    prevDocsParaRevogar = prevSnap.docs.filter(
      (d) => d.data().clienteId === params.cliente.id && !d.data().revogado
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'linksConsulta');
  }

  // Grava consultasPublicas antes de linksConsulta para não deixar link ativo órfão em caso de erro
  try {
    await writeBatch(db)
      .set(doc(db, 'consultasPublicas', tokenHash), {
        comercioId: params.comercioId,
        clienteId: params.cliente.id,
        comercioNome: comercioNomeSeguro,
        ultimos4Hash,
        payloadCifrado,
        expiraEm: Timestamp.fromDate(expiraEm),
        revogado: false,
        tentativasErradas: 0,
        bloqueadoAte: Timestamp.fromMillis(0),
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp(),
      })
      .commit();
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.CREATE,
      `consultasPublicas/${tokenHash}?nomeLen=${comercioNomeSeguro.length}&hashLen=${ultimos4Hash.length}&payloadLen=${payloadCifrado.length}`
    );
  }

  try {
    await writeBatch(db)
      .set(doc(db, 'linksConsulta', tokenHash), {
        comercioId: params.comercioId,
        clienteId: params.cliente.id,
        expiraEm: Timestamp.fromDate(expiraEm),
        revogado: false,
        tentativasErradas: 0,
        bloqueadoAte: Timestamp.fromMillis(0),
        criadoPor: params.uid,
        criadoEm: serverTimestamp(),
      })
      .commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `linksConsulta/${tokenHash}`);
  }

  const audId = makeDocId('aud');
  try {
    await writeBatch(db)
      .set(doc(db, 'auditoria', audId), {
        comercioId: params.comercioId,
        quem: params.uid,
        acao: 'link_consulta_gerado',
        detalhes: `Novo link de consulta gerado para ${params.cliente.nome}.`.slice(0, 300),
        quando: serverTimestamp(),
      })
      .commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `auditoria/${audId}`);
  }

  // Revoga links anteriores em melhor esforço para que um registro legado não impeça gerar novo link
  for (const prev of prevDocsParaRevogar) {
    try {
      await writeBatch(db).update(prev.ref, { revogado: true }).commit();
    } catch {
      // Ignora caso documento antigo tenha formato incompatível
    }
    try {
      await writeBatch(db)
        .update(doc(db, 'consultasPublicas', prev.id), {
          comercioNome: comercioNomeSeguro,
          revogado: true,
          atualizadoEm: serverTimestamp(),
        })
        .commit();
    } catch {
      // Ignora caso projeção antiga não exista em consultasPublicas
    }
  }

  return { rawToken, tokenHash, expiraEm };
}

export async function revogarLinkConsulta(params: {
  comercioId: string;
  tokenHash: string;
  uid: string;
}): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'linksConsulta', params.tokenHash), { revogado: true });
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

  try {
    await writeBatch(db)
      .update(doc(db, 'consultasPublicas', params.tokenHash), {
        revogado: true,
        atualizadoEm: serverTimestamp(),
      })
      .commit();
  } catch {
    // Melhor esforço caso projeção pública não exista
  }
}

export async function verificarConsultaPublicaDisponivel(
  tokenHash: string
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(tokenHash)) return false;
  try {
    const snap = await getDoc(doc(db, 'consultasPublicas', tokenHash));
    if (!snap.exists()) return false;
    const d = snap.data();
    if (d.revogado) return false;
    if (toDate(d.expiraEm).getTime() <= Date.now()) return false;
    return true;
  } catch {
    return false;
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
  const cleanToken = rawToken.trim().toLowerCase();
  if (!/^[a-f0-9]{32,128}$/.test(cleanToken)) {
    return { status: 'indisponivel' };
  }

  const tokenHash = await sha256Hex(cleanToken);

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
  } catch (err) {
    console.warn('Consulta pública indisponível ao ler projeção:', err);
    return { status: 'indisponivel' };
  }

  if (!snap.exists()) {
    console.warn('Consulta pública indisponível: projeção não encontrada.');
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
    try {
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
    } catch (err) {
      console.warn('Aviso ao registrar tentativa inválida do link público:', err);
    }

    if (novas >= 5) {
      return { status: 'bloqueado' };
    }
    return { status: 'invalido_digitos', tentativasRestantes: Math.max(0, 5 - novas) };
  }

  let resumo: ResumoPublicoCliente;
  try {
    const plainJson = await decryptPublicPayload(
      String(d.payloadCifrado),
      tokenHash,
      `${String(d.comercioId)}:${cleanDigits}`
    );
    resumo = JSON.parse(plainJson) as ResumoPublicoCliente;
  } catch (err) {
    console.warn('Erro ao decifrar resumo público:', err);
    return { status: 'indisponivel' };
  }

  // Registro de acesso é melhor-esforço para não bloquear a visualização do cliente
  try {
    await writeBatch(db)
      .set(doc(db, 'acessosLink', makeDocId('acc')), {
        comercioId: String(d.comercioId),
        tokenHash,
        quando: serverTimestamp(),
        resultado: 'ok',
      })
      .commit();
  } catch (err) {
    console.warn('Aviso ao gravar log de acesso ao link:', err);
  }

  return { status: 'ok', resumo };
}

export async function carregarDadosExemplo(params: {
  comercioId: string;
  uid: string;
}): Promise<{ adicionados: number; ignorados: number }> {
  const existentes = await getDocs(
    query(collection(db, 'clientes'), where('comercioId', '==', params.comercioId))
  );
  const existingWhatsApps = new Set(
    existentes.docs.map((d) => String(d.data().whatsapp || '').trim())
  );

  const hoje = new Date();
  const diaMs = 24 * 60 * 60 * 1000;
  const isoFromOffset = (daysOffset: number) =>
    getBahiaDateString(new Date(hoje.getTime() + daysOffset * diaMs));

  const ficticios = [
    {
      nome: 'Raimunda de Souza Ferreira',
      whatsapp: '+5571900012301',
      limiteCredito: 30000,
      diaVencimento: 5,
      observacaoDono: 'Combinou de acertar o restante na sexta-feira.',
      compras: [
        { valor: 14500, itens: 'Arroz, feijão, óleo e café', venc: isoFromOffset(-12), aberto: 14500 },
        { valor: 4200, itens: 'Pão francês e manteiga', venc: isoFromOffset(8), aberto: 4200 },
      ],
      pagamentos: [{ valor: 5000, forma: 'dinheiro' as const }],
    },
    {
      nome: 'Antônio Carlos Bispo',
      whatsapp: '+5571900012302',
      limiteCredito: 25000,
      diaVencimento: 10,
      observacaoDono: 'Avisou que recebe quinzena dia 25.',
      compras: [{ valor: 18900, itens: 'Carne moída, frango e temperos', venc: isoFromOffset(-5), aberto: 18900 }],
      pagamentos: [],
    },
    {
      nome: 'Sônia Maria Oliveira',
      whatsapp: '+5571900012309',
      limiteCredito: 20000,
      diaVencimento: 12,
      observacaoDono: 'Pediu lembrete por WhatsApp com chave Pix.',
      compras: [{ valor: 16400, itens: 'Feijão, carne seca, queijo e café', venc: isoFromOffset(-9), aberto: 16400 }],
      pagamentos: [],
    },
    {
      nome: 'Marcos Vinícius Lima',
      whatsapp: '+5571900012306',
      limiteCredito: 15000,
      diaVencimento: 25,
      observacaoDono: 'Atraso acima de 15 dias e perto do limite.',
      compras: [{ valor: 13200, itens: 'Charque, farinha e ovos', venc: isoFromOffset(-20), aberto: 13200 }],
      pagamentos: [],
    },
    {
      nome: 'Carla Regina Mendes',
      whatsapp: '+5571900012303',
      limiteCredito: 40000,
      diaVencimento: 15,
      observacaoDono: '',
      compras: [{ valor: 12000, itens: 'Leite, açúcar e biscoitos', venc: isoFromOffset(10), aberto: 12000 }],
      pagamentos: [],
    },
    {
      nome: 'Jorge Luiz Santana',
      whatsapp: '+5571900012304',
      limiteCredito: 20000,
      diaVencimento: 20,
      observacaoDono: '',
      compras: [{ valor: 9500, itens: 'Água mineral e gás de cozinha', venc: isoFromOffset(14), aberto: 6500 }],
      pagamentos: [{ valor: 3000, forma: 'pix_manual' as const }],
    },
    {
      nome: 'Luciana Ferreira Alves',
      whatsapp: '+5571900012305',
      limiteCredito: 35000,
      diaVencimento: 10,
      observacaoDono: '',
      compras: [{ valor: 8000, itens: 'Frutas e verduras da feira', venc: isoFromOffset(-2), aberto: 0 }],
      pagamentos: [{ valor: 8000, forma: 'pix_manual' as const }],
    },
    {
      nome: 'Tereza Cristina Santos',
      whatsapp: '+5571900012307',
      limiteCredito: 50000,
      diaVencimento: 12,
      observacaoDono: '',
      compras: [{ valor: 21500, itens: 'Compras da semana', venc: isoFromOffset(6), aberto: 21500 }],
      pagamentos: [],
    },
    {
      nome: 'Valter José da Conceição',
      whatsapp: '+5571900012308',
      limiteCredito: 20000,
      diaVencimento: 18,
      observacaoDono: '',
      compras: [{ valor: 5400, itens: 'Refrigerante e pão doce', venc: isoFromOffset(-1), aberto: 0 }],
      pagamentos: [{ valor: 5400, forma: 'debito' as const }],
    },
  ];

  const pendentes = ficticios.filter((item) => !existingWhatsApps.has(item.whatsapp));
  if (pendentes.length === 0) {
    return { adicionados: 0, ignorados: ficticios.length };
  }

  const comRef = doc(db, 'comercios', params.comercioId);
  const comSnap = await getDoc(comRef);
  const seqInicial = Number(comSnap.data()?.ultimoNumeroLancamento ?? 0);
  let seqAtual = seqInicial;

  const hojeBahia = getBahiaDateString(hoje);
  const clientesBatch = writeBatch(db);
  const lancamentosBatch = writeBatch(db);

  for (const item of pendentes) {
    const cliId = makeDocId('cli');
    const calcInput: LancamentoCalcInput[] = [];
    const createdCompras: Array<{ id: string; numero: string; valor: number; itens: string; venc: string }> = [];

    item.compras.forEach((c, idx) => {
      const lId = makeDocId('lnc');
      seqAtual += 1;
      const numero = formatarNumeroLancamento('compra', seqAtual);
      calcInput.push({
        id: lId,
        tipo: 'compra',
        valor: c.valor,
        vencimento: c.venc,
        estornoDe: '',
        criadoEmMs: hoje.getTime() - (20 - idx) * 1000,
      });
      createdCompras.push({ id: lId, numero, valor: c.valor, itens: c.itens, venc: c.venc });
    });

    item.pagamentos.forEach((p, idx) => {
      const lId = makeDocId('lnc');
      seqAtual += 1;
      const numero = formatarNumeroLancamento('pagamento', seqAtual);
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
        numero,
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

    // Regras do Firestore exigem criação do cliente com saldo zerado antes de lançar compras
    clientesBatch.set(doc(db, 'clientes', cliId), {
      comercioId: params.comercioId,
      nome: item.nome,
      whatsapp: item.whatsapp,
      consentimentoWhatsapp: true,
      consentimentoEm: serverTimestamp(),
      semContatoWhatsapp: false,
      limiteCredito: item.limiteCredito,
      diaVencimento: item.diaVencimento,
      ativo: true,
      anonimizado: false,
      saldoDevedor: 0,
      valorVencido: 0,
      valorAVencer: 0,
      proximoVencimento: '',
      observacaoDono: item.observacaoDono,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp(),
    });

    clientesBatch.set(doc(db, 'consentimentos', makeDocId('cns')), {
      comercioId: params.comercioId,
      clienteId: cliId,
      tipo: 'consentimento',
      dataHora: serverTimestamp(),
      canal: 'cadastro',
      responsavel: params.uid,
      origem: 'Consentimento inicial registrado no cadastro',
    });

    for (const c of createdCompras) {
      lancamentosBatch.set(doc(db, 'lancamentos', c.id), {
        comercioId: params.comercioId,
        clienteId: cliId,
        numero: c.numero,
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

    lancamentosBatch.update(doc(db, 'clientes', cliId), {
      saldoDevedor: calc.saldoDevedor,
      valorVencido: calc.valorVencido,
      valorAVencer: calc.valorAVencer,
      proximoVencimento: calc.proximoVencimento,
      atualizadoEm: serverTimestamp(),
    });
  }

  if (seqAtual > seqInicial) {
    lancamentosBatch.update(comRef, { ultimoNumeroLancamento: seqAtual });
  }

  lancamentosBatch.set(doc(db, 'auditoria', makeDocId('aud')), {
    comercioId: params.comercioId,
    quem: params.uid,
    acao: 'dados_exemplo_carregados',
    detalhes: `${pendentes.length} cliente(s) fictício(s) e lançamentos de exemplo gerados.`,
    quando: serverTimestamp(),
  });

  try {
    await clientesBatch.commit();
    await lancamentosBatch.commit();
    return {
      adicionados: pendentes.length,
      ignorados: ficticios.length - pendentes.length,
    };
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
