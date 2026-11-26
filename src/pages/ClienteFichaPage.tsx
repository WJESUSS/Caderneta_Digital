import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowLeft,
  BellOff,
  CheckCircle2,
  Download,
  Edit3,
  FileText,
  Link2,
  MessageCircle,
  Plus,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  avaliarPrazoSolicitacao,
  buildWhatsAppUrl,
  estaPertoDoLimite,
  formatCentavos,
  formatDateBR,
  formatWhatsAppDisplay,
  motivoBloqueioWhatsApp,
  obterNumeroLancamentoExibicao,
  parseBRLToCentavos,
  podeEnviarWhatsApp,
  type CanalConsentimento,
  type ConsentimentoEvento,
  type Lancamento,
  type LinkConsulta,
  type SolicitacaoTitular,
  type TipoSolicitacaoTitular,
} from '../lib/businessRules';
import {
  ajustarLimiteCliente,
  anonimizarClienteLGPD,
  concluirSolicitacaoTitular,
  criarSolicitacaoTitular,
  estornarLancamento,
  exportarDadosCliente,
  gerarLinkConsulta,
  observarConsentimentosCliente,
  observarLancamentosCliente,
  observarLinksCliente,
  observarSolicitacoesTitularCliente,
  registrarNovoConsentimentoWhatsApp,
  registrarOptOutWhatsApp,
  revogarLinkConsulta,
  verificarConsultaPublicaDisponivel,
} from '../lib/firestoreService';
import { APP_PUBLIC_URL } from '../lib/qrUrl';
import { QRCodeCard } from '../components/QRCodeCard';
import { ComprovanteCard, type ComprovanteDados } from '../components/ComprovanteCard';

const LOCAL_TOKEN_PREFIX = 'caderneta_link_token_';

export const ClienteFichaPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const { clientes, comercio, usuario } = useAuth();
  const navigate = useNavigate();

  const cliente = clientes.find((c) => c.id === id);
  const isDono = usuario?.perfil === 'dono';

  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [links, setLinks] = useState<LinkConsulta[]>([]);
  const [carregandoExtrato, setCarregandoExtrato] = useState(true);
  const [gerandoLink, setGerandoLink] = useState(false);
  const [tokenAtual, setTokenAtual] = useState<string | null>(null);
  const [linkPublicoInvalido, setLinkPublicoInvalido] = useState(false);
  const [erroLink, setErroLink] = useState<string | null>(null);

  // Modal de estorno (só Dono)
  const [estornoAlvo, setEstornoAlvo] = useState<Lancamento | null>(null);
  const [justificativa, setJustificativa] = useState('');
  const [estornando, setEstornando] = useState(false);
  const [erroEstorno, setErroEstorno] = useState<string | null>(null);
  const [estornoComprovante, setEstornoComprovante] = useState<ComprovanteDados | null>(null);

  // Modal de ajuste de limite (só Dono)
  const [limiteModalOpen, setLimiteModalOpen] = useState(false);
  const [novoLimiteStr, setNovoLimiteStr] = useState('');
  const [salvandoLimite, setSalvandoLimite] = useState(false);
  const [erroLimite, setErroLimite] = useState<string | null>(null);

  // RF17 / RN12: Histórico de consentimento e opt-out
  const [consentimentos, setConsentimentos] = useState<ConsentimentoEvento[]>([]);
  const [optOutAberto, setOptOutAberto] = useState(false);
  const [optOutCanal, setOptOutCanal] = useState<CanalConsentimento>('whatsapp');
  const [optOutPedidoProprio, setOptOutPedidoProprio] = useState(true);
  const [optOutOrigem, setOptOutOrigem] = useState('Pedido feito pelo próprio cliente via WhatsApp');
  const [salvandoOptOut, setSalvandoOptOut] = useState(false);
  const [erroConsentimento, setErroConsentimento] = useState<string | null>(null);
  const [msgConsentimento, setMsgConsentimento] = useState<string | null>(null);
  const [novoConsentAberto, setNovoConsentAberto] = useState(false);
  const [novoConsentCanal, setNovoConsentCanal] = useState<CanalConsentimento>('balcao');
  const [novoConsentOrigem, setNovoConsentOrigem] = useState(
    'Cliente solicitou reativar mensagens presencialmente'
  );
  const [salvandoNovoConsent, setSalvandoNovoConsent] = useState(false);

  // RF19: Direitos do titular (exportação por cliente e solicitações)
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoTitular[]>([]);
  const [solTipo, setSolTipo] = useState<TipoSolicitacaoTitular>('acesso');
  const [solObs, setSolObs] = useState('');
  const [abrindoSol, setAbrindoSol] = useState(false);
  const [concluindoSolId, setConcluindoSolId] = useState<string | null>(null);
  const [confirmExclusaoSolId, setConfirmExclusaoSolId] = useState<string | null>(null);
  const [exportandoCliente, setExportandoCliente] = useState(false);
  const [erroTitular, setErroTitular] = useState<string | null>(null);
  const [msgTitular, setMsgTitular] = useState<string | null>(null);

  useEffect(() => {
    if (!comercio || !id) return;
    setCarregandoExtrato(true);
    const unsubL = observarLancamentosCliente(comercio.id, id, (list) => {
      setLancamentos(list);
      setCarregandoExtrato(false);
    });
    const unsubK = observarLinksCliente(comercio.id, id, (list) => {
      setLinks(list);
    });
    const unsubC = observarConsentimentosCliente(comercio.id, id, setConsentimentos);
    const unsubS = observarSolicitacoesTitularCliente(comercio.id, id, setSolicitacoes);
    return () => {
      unsubL();
      unsubK();
      unsubC();
      unsubS();
    };
  }, [comercio, id]);

  const linkAtivo = useMemo(() => {
    const agora = Date.now();
    return links.find((l) => !l.revogado && l.expiraEm.getTime() > agora) || null;
  }, [links]);

  useEffect(() => {
    let active = true;
    if (linkAtivo && typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(`${LOCAL_TOKEN_PREFIX}${linkAtivo.tokenHash}`);
      setTokenAtual(saved);
      setLinkPublicoInvalido(false);
      void verificarConsultaPublicaDisponivel(linkAtivo.tokenHash).then((disponivel) => {
        if (active && !disponivel) {
          setLinkPublicoInvalido(true);
        }
      });
    } else {
      setTokenAtual(null);
      setLinkPublicoInvalido(false);
    }
    return () => {
      active = false;
    };
  }, [linkAtivo]);

  const estornadosIds = useMemo(() => {
    const set = new Set<string>();
    for (const l of lancamentos) {
      if (l.tipo === 'estorno' && l.estornoDe) {
        set.add(l.estornoDe);
      }
    }
    return set;
  }, [lancamentos]);

  if (!cliente) {
    return (
      <div className="rounded-2xl border border-[#E4E4DF] bg-white p-8 text-center">
        <p className="text-lg font-bold text-[#14211E]">Cliente não encontrado</p>
        <Link to="/clientes" className="mt-4 inline-block text-base font-semibold text-teal-800 hover:underline">
          Voltar para clientes
        </Link>
      </div>
    );
  }

  const limiteDisponivel = Math.max(0, cliente.limiteCredito - cliente.saldoDevedor);
  const consultaUrl = tokenAtual ? `${APP_PUBLIC_URL}/s/${tokenAtual}` : '';
  const whatsappPermitido = podeEnviarWhatsApp(cliente);
  const motivoBloqueioWpp = motivoBloqueioWhatsApp(cliente);

  const comprovanteMensagem = `Olá, ${cliente.nome.split(' ')[0]}! Resumo da sua caderneta em ${
    comercio?.nome || 'nosso comércio'
  }:\nSaldo atual: ${formatCentavos(cliente.saldoDevedor)}${
    cliente.valorVencido > 0 ? `\nValor vencido: ${formatCentavos(cliente.valorVencido)}` : ''
  }${
    cliente.proximoVencimento
      ? `\nPróximo vencimento: ${formatDateBR(cliente.proximoVencimento)}`
      : ''
  }${consultaUrl ? `\nConsulte seu extrato: ${consultaUrl}` : ''}`;

  const handleGerarLink = async () => {
    if (!comercio || !usuario) return;
    setErroLink(null);
    setGerandoLink(true);
    try {
      const { rawToken, tokenHash } = await gerarLinkConsulta({
        comercioId: comercio.id,
        comercioNome: comercio.nome,
        pixChave: comercio.pixChave,
        pixRecebedor: comercio.pixRecebedor,
        comercioWhatsapp: comercio.whatsappContato,
        cliente,
        lancamentos,
        uid: usuario.uid,
      });
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(`${LOCAL_TOKEN_PREFIX}${tokenHash}`, rawToken);
      }
      setTokenAtual(rawToken);
      setLinkPublicoInvalido(false);
    } catch (err) {
      console.error('Erro ao gerar link de consulta:', err);
      const msg = err instanceof Error ? err.message : 'Erro ao gerar link.';
      if (msg.includes('Missing or insufficient permissions') || msg.includes('PERMISSION_DENIED')) {
        let detalhe = '';
        if (msg.startsWith('{')) {
          try {
            const parsed = JSON.parse(msg);
            if (parsed?.operationType || parsed?.path) {
              detalhe = ` (${parsed.operationType || 'write'} em ${parsed.path || 'linksConsulta'})`;
            }
          } catch {
            // ignora parse
          }
        }
        setErroLink(
          `Sem permissão no Firestore para gerar link${detalhe}. Confira se as regras de firestore.rules estão publicadas no Firebase Console.`
        );
      } else {
        setErroLink(msg);
      }
    } finally {
      setGerandoLink(false);
    }
  };

  const handleRevogarLink = async () => {
    if (!comercio || !usuario || !linkAtivo) return;
    setErroLink(null);
    try {
      await revogarLinkConsulta({
        comercioId: comercio.id,
        tokenHash: linkAtivo.tokenHash,
        uid: usuario.uid,
      });
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(`${LOCAL_TOKEN_PREFIX}${linkAtivo.tokenHash}`);
      }
      setTokenAtual(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao revogar link.';
      setErroLink(
        msg.includes('Missing or insufficient permissions') || msg.includes('PERMISSION_DENIED')
          ? 'Sem permissão no Firestore para revogar o link.'
          : msg
      );
    }
  };

  const handleConfirmarEstorno = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comercio || !usuario || !estornoAlvo) return;
    setErroEstorno(null);
    setEstornando(true);
    const alvo = estornoAlvo;
    const motivoLimpo = justificativa.trim();
    try {
      const res = await estornarLancamento({
        comercioId: comercio.id,
        comercioNome: comercio.nome.trim(),
        clienteId: cliente.id,
        lancamentoAlvo: alvo,
        justificativa: motivoLimpo,
        uid: usuario.uid,
      });
      const formaLabel =
        alvo.forma === 'pix_manual'
          ? 'Pix manual'
          : alvo.forma === 'debito'
          ? 'Débito'
          : alvo.forma === 'dinheiro'
          ? 'Dinheiro'
          : 'Fiado';
      setEstornoAlvo(null);
      setJustificativa('');
      setEstornoComprovante({
        tipo: 'estorno',
        comercioNome: comercio.nome.trim(),
        clienteNome: cliente.nome,
        clienteWhatsapp: cliente.whatsapp,
        saldoAnterior: res.saldoAnterior,
        valor: alvo.valor,
        novoSaldo: res.novoSaldo,
        limiteCredito: res.limiteCredito,
        forma: alvo.forma,
        formaLabel,
        justificativa: motivoLimpo,
        dataHora: new Date(),
        lancamentoId: res.lancamentoId,
        numero: res.numero,
        registradoPorNome: usuario.nome,
        offline: false,
        podeEnviarWhatsApp: whatsappPermitido,
        motivoBloqueioWhatsApp: motivoBloqueioWpp,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao estornar lançamento.';
      setErroEstorno(
        msg.includes('Missing or insufficient permissions') || msg.includes('PERMISSION_DENIED')
          ? 'Sem permissão no Firestore para estornar. Confira se as regras de firestore.rules estão publicadas no Firebase Console.'
          : msg
      );
    } finally {
      setEstornando(false);
    }
  };

  const abrirModalLimite = () => {
    setErroLimite(null);
    setNovoLimiteStr((cliente.limiteCredito / 100).toFixed(2).replace('.', ','));
    setLimiteModalOpen(true);
  };

  const handleConfirmarAjusteLimite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comercio || !usuario || !isDono) return;
    setErroLimite(null);
    const novoCentavos = parseBRLToCentavos(novoLimiteStr);
    if (novoCentavos < 0) {
      setErroLimite('Informe um valor válido maior ou igual a R$ 0,00.');
      return;
    }
    setSalvandoLimite(true);
    try {
      await ajustarLimiteCliente({
        comercioId: comercio.id,
        clienteId: cliente.id,
        clienteNome: cliente.nome,
        limiteAnteriorCentavos: cliente.limiteCredito,
        novoLimiteCentavos: novoCentavos,
        uid: usuario.uid,
        responsavelNome: usuario.nome,
      });
      setLimiteModalOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao ajustar limite.';
      setErroLimite(
        msg.includes('Missing or insufficient permissions') || msg.includes('PERMISSION_DENIED')
          ? 'Sem permissão no Firestore para alterar limite. Apenas o Dono pode ajustar o limite de crédito.'
          : msg
      );
    } finally {
      setSalvandoLimite(false);
    }
  };

  const CANAL_LABEL: Record<CanalConsentimento, string> = {
    cadastro: 'Cadastro',
    whatsapp: 'WhatsApp',
    balcao: 'Balcão',
    link_consulta: 'Link de consulta',
  };

  const TIPO_SOLICITACAO_LABEL: Record<TipoSolicitacaoTitular, string> = {
    acesso: 'Acesso aos dados',
    correcao: 'Correção de dados',
    portabilidade: 'Portabilidade (JSON)',
    exclusao: 'Exclusão / anonimização',
  };

  const formatarErroFirestore = (err: unknown, fallback: string) => {
    const msg = err instanceof Error ? err.message : fallback;
    if (msg.includes('Missing or insufficient permissions') || msg.includes('PERMISSION_DENIED')) {
      let detalhe = '';
      if (msg.startsWith('{')) {
        try {
          const parsed = JSON.parse(msg);
          if (parsed?.operationType || parsed?.path) {
            detalhe = ` (${parsed.operationType || 'write'} em ${parsed.path || 'consentimentos'})`;
          }
        } catch {
          // ignora parse
        }
      }
      return `Sem permissão no Firestore${detalhe}. Confira se as regras de firestore.rules estão publicadas no Firebase Console.`;
    }
    return msg;
  };

  const handleRegistrarOptOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comercio || !usuario) return;
    setErroConsentimento(null);
    setMsgConsentimento(null);
    setSalvandoOptOut(true);
    try {
      await registrarOptOutWhatsApp({
        comercioId: comercio.id,
        clienteId: cliente.id,
        clienteNome: cliente.nome,
        canal: optOutCanal,
        origem: optOutOrigem,
        uid: usuario.uid,
        perfil: usuario.perfil,
      });
      setOptOutAberto(false);
      setMsgConsentimento(
        'Opt-out registrado. Envios pelo WhatsApp foram bloqueados mantendo o histórico intacto.'
      );
    } catch (err) {
      console.error('Erro ao registrar opt-out:', err);
      setErroConsentimento(formatarErroFirestore(err, 'Erro ao registrar opt-out.'));
    } finally {
      setSalvandoOptOut(false);
    }
  };

  const handleRegistrarNovoConsentimento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comercio || !usuario || !isDono) return;
    setErroConsentimento(null);
    setMsgConsentimento(null);
    setSalvandoNovoConsent(true);
    try {
      await registrarNovoConsentimentoWhatsApp({
        comercioId: comercio.id,
        clienteId: cliente.id,
        clienteNome: cliente.nome,
        canal: novoConsentCanal,
        origem: novoConsentOrigem,
        uid: usuario.uid,
      });
      setNovoConsentAberto(false);
      setMsgConsentimento('Novo consentimento registrado no histórico do cliente.');
    } catch (err) {
      console.error('Erro ao registrar novo consentimento:', err);
      setErroConsentimento(formatarErroFirestore(err, 'Erro ao registrar novo consentimento.'));
    } finally {
      setSalvandoNovoConsent(false);
    }
  };

  const handleExportarCliente = async () => {
    if (!comercio || !isDono) return;
    setErroTitular(null);
    setMsgTitular(null);
    setExportandoCliente(true);
    try {
      const dados = await exportarDadosCliente(comercio.id, cliente.id);
      const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = cliente.nome
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/(^-|-$)/g, '');
      a.href = url;
      a.download = `caderneta-cliente-${slug || cliente.id}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsgTitular('Arquivo JSON com os dados do cliente exportado com sucesso.');
    } catch (err) {
      setErroTitular(err instanceof Error ? err.message : 'Erro ao exportar dados do cliente.');
    } finally {
      setExportandoCliente(false);
    }
  };

  const handleCriarSolicitacao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comercio || !usuario) return;
    setErroTitular(null);
    setMsgTitular(null);
    setAbrindoSol(true);
    try {
      await criarSolicitacaoTitular({
        comercioId: comercio.id,
        clienteId: cliente.id,
        clienteNome: cliente.nome,
        tipo: solTipo,
        observacao: solObs,
        diasPrazo: comercio.prazoSolicitacaoTitularDias ?? 15,
        uid: usuario.uid,
      });
      setSolObs('');
      setMsgTitular('Solicitação do titular registrada com prazo de atendimento acompanhado.');
    } catch (err) {
      setErroTitular(err instanceof Error ? err.message : 'Erro ao registrar solicitação.');
    } finally {
      setAbrindoSol(false);
    }
  };

  const handleConcluirSolicitacao = async (sol: SolicitacaoTitular) => {
    if (!comercio || !usuario || !isDono) return;
    setErroTitular(null);
    setMsgTitular(null);
    setConcluindoSolId(sol.id);
    try {
      if (sol.tipo === 'exclusao' && !cliente.anonimizado) {
        await anonimizarClienteLGPD({
          comercioId: comercio.id,
          clienteId: cliente.id,
          uid: usuario.uid,
        });
      }
      await concluirSolicitacaoTitular({
        comercioId: comercio.id,
        solicitacaoId: sol.id,
        clienteNome: cliente.nome,
        observacao:
          sol.tipo === 'exclusao'
            ? sol.observacao
              ? `${sol.observacao} · Cliente anonimizado pela LGPD.`
              : 'Cliente anonimizado pela LGPD.'
            : sol.observacao,
        uid: usuario.uid,
      });
      setConfirmExclusaoSolId(null);
      setMsgTitular(
        sol.tipo === 'exclusao'
          ? 'Cliente anonimizado pela LGPD e solicitação de exclusão concluída.'
          : 'Solicitação do titular marcada como atendida.'
      );
    } catch (err) {
      setErroTitular(err instanceof Error ? err.message : 'Erro ao concluir solicitação.');
    } finally {
      setConcluindoSolId(null);
    }
  };

  if (estornoComprovante) {
    return (
      <ComprovanteCard
        dados={estornoComprovante}
        acoesExtras={
          <button
            type="button"
            onClick={() => setEstornoComprovante(null)}
            className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800"
          >
            Voltar à ficha do cliente
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Topo */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/clientes')}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[#E4E4DF] bg-white text-[#14211E] hover:bg-slate-50"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-[#14211E]">{cliente.nome}</h1>
              {estaPertoDoLimite(cliente.saldoDevedor, cliente.limiteCredito) && (
                <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                  Perto do limite
                </span>
              )}
            </div>
            <p className="text-sm text-slate-600">
              {formatWhatsAppDisplay(cliente.whatsapp)} · Vencimento todo dia {cliente.diaVencimento}
              {!cliente.ativo ? ' · Inativo' : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isDono && !cliente.anonimizado && (
            <button
              type="button"
              onClick={abrirModalLimite}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-teal-700 bg-teal-50 px-4 py-2 text-base font-semibold text-teal-900 hover:bg-teal-100"
            >
              <Edit3 className="h-4 w-4" />
              <span>Ajustar limite de crédito</span>
            </button>
          )}
          <Link
            to={`/clientes/${cliente.id}/editar`}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-4 py-2 text-base font-semibold text-[#14211E] hover:bg-slate-50"
          >
            <Edit3 className="h-4 w-4" />
            <span>Editar</span>
          </Link>
        </div>
      </div>

      {/* Resumo financeiro */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-[#E4E4DF] bg-white p-4 sm:p-5">
          <p className="text-sm text-slate-600">Saldo devedor</p>
          <p className="mt-1 font-mono-nums text-2xl font-bold text-[#14211E]">
            {formatCentavos(cliente.saldoDevedor)}
          </p>
        </div>
        <div className="rounded-2xl border border-[#E4E4DF] bg-white p-4 sm:p-5">
          <p className="text-sm text-slate-600">Valor vencido</p>
          <p
            className={`mt-1 font-mono-nums text-2xl font-bold ${
              cliente.valorVencido > 0 ? 'text-red-700' : 'text-[#14211E]'
            }`}
          >
            {formatCentavos(cliente.valorVencido)}
          </p>
        </div>
        <div className="rounded-2xl border border-[#E4E4DF] bg-white p-4 sm:p-5">
          <p className="text-sm text-slate-600">A vencer</p>
          <p className="mt-1 font-mono-nums text-2xl font-bold text-[#14211E]">
            {formatCentavos(cliente.valorAVencer)}
          </p>
        </div>
        <div className="rounded-2xl border border-[#E4E4DF] bg-white p-4 sm:p-5">
          <p className="text-sm text-slate-600">Limite disponível</p>
          <p className="mt-1 font-mono-nums text-2xl font-bold text-teal-800">
            {formatCentavos(limiteDisponivel)}
          </p>
          <p className="text-xs text-slate-500 font-mono-nums">
            de {formatCentavos(cliente.limiteCredito)}
          </p>
        </div>
      </div>

      {/* Botões de ação */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link
          to={`/nova-compra?clienteId=${cliente.id}`}
          className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800"
        >
          <Plus className="h-5 w-5" />
          <span>+ Nova compra</span>
        </Link>

        <Link
          to={`/receber-pagamento?clienteId=${cliente.id}`}
          className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-5 py-3 text-base font-semibold text-[#14211E] hover:bg-slate-50"
        >
          <ArrowDownLeft className="h-5 w-5 text-teal-700" />
          <span>Receber pagamento</span>
        </Link>

        {!cliente.anonimizado &&
          (whatsappPermitido ? (
            <a
              href={buildWhatsAppUrl(cliente.whatsapp, comprovanteMensagem)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-[#15803D] px-5 py-3 text-base font-semibold text-white hover:bg-[#166534]"
            >
              <MessageCircle className="h-5 w-5" />
              <span>Enviar comprovante por WhatsApp</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              title={motivoBloqueioWpp}
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-slate-100 px-5 py-3 text-base font-semibold text-slate-500 cursor-not-allowed"
            >
              <MessageCircle className="h-5 w-5" />
              <span>WhatsApp bloqueado</span>
            </button>
          ))}
      </div>

      {!cliente.anonimizado && !whatsappPermitido && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
          {motivoBloqueioWpp}
        </p>
      )}

      {/* Consulta de saldo pelo cliente (RF15) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-5 rounded-2xl border border-[#E4E4DF] bg-white p-5 sm:p-6">
          <div className="flex items-center gap-2 text-[#14211E]">
            <Link2 className="h-5 w-5 text-teal-700" />
            <h2 className="text-lg font-bold">Consulta de saldo do cliente</h2>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Link exclusivo válido por 30 dias. O cliente confirma os 4 últimos dígitos do WhatsApp para ver o saldo.
          </p>

          {erroLink && (
            <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{erroLink}</p>
          )}

          {linkAtivo && consultaUrl && !linkPublicoInvalido ? (
            <div className="mt-5 space-y-4">
              <QRCodeCard
                url={consultaUrl}
                titulo={`Consulta de ${cliente.nome}`}
                subtitulo={`Validade até ${linkAtivo.expiraEm.toLocaleDateString('pt-BR')}`}
                tamanhoPx={220}
                filenamePng={`consulta-${cliente.nome.toLowerCase().replace(/\s+/g, '-')}.png`}
                extraWhatsAppUrl={
                  whatsappPermitido
                    ? buildWhatsAppUrl(
                        cliente.whatsapp,
                        `Olá, ${cliente.nome.split(' ')[0]}! Aqui está o seu link para consultar seu saldo em ${
                          comercio?.nome || 'nosso comércio'
                        }: ${consultaUrl} (digite os 4 últimos dígitos do seu WhatsApp para abrir).`
                      )
                    : undefined
                }
                whatsAppBloqueadoMotivo={whatsappPermitido ? undefined : motivoBloqueioWpp}
              />

              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleGerarLink}
                  disabled={gerandoLink}
                  className="min-h-[44px] rounded-xl border border-[#D4D4CE] bg-white px-3 text-sm font-semibold text-[#14211E] hover:bg-slate-50"
                >
                  Renovar link
                </button>
                <button
                  type="button"
                  onClick={handleRevogarLink}
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-800 hover:bg-red-100"
                >
                  <ShieldOff className="h-4 w-4" />
                  <span>Revogar</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {linkAtivo && linkPublicoInvalido && (
                <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                  Este link anterior não está mais disponível para consulta pública. Gere um novo link abaixo para compartilhar com o cliente.
                </p>
              )}
              {linkAtivo && !linkPublicoInvalido && !consultaUrl && (
                <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                  Existe um link ativo gerado em outro aparelho. Por segurança o token não fica salvo no servidor — gere um novo link para visualizar e compartilhar aqui.
                </p>
              )}
              <button
                type="button"
                onClick={handleGerarLink}
                disabled={gerandoLink || cliente.anonimizado || !cliente.ativo}
                className="min-h-[48px] w-full rounded-xl bg-teal-700 px-4 py-3 text-base font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {gerandoLink ? 'Gerando link...' : 'Gerar link e QR de consulta'}
              </button>
            </div>
          )}
        </section>

        {/* Extrato completo */}
        <section className="lg:col-span-7 rounded-2xl border border-[#E4E4DF] bg-white p-5 sm:p-6">
          <h2 className="text-lg font-bold text-[#14211E]">Extrato de lançamentos</h2>

          {carregandoExtrato ? (
            <div className="mt-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : lancamentos.length === 0 ? (
            <p className="mt-4 text-base text-slate-600 py-4">
              Nenhum lançamento registrado para este cliente.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[#ECECE7]">
              {lancamentos.map((l) => {
                const foiEstornado = estornadosIds.has(l.id);
                return (
                  <li key={l.id} className="py-4 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p
                        className={`text-base font-bold ${
                          foiEstornado ? 'line-through text-slate-400' : 'text-[#14211E]'
                        }`}
                      >
                        <span className="font-mono-nums text-xs font-semibold text-slate-500 mr-2">
                          {obterNumeroLancamentoExibicao(l.numero, l.id)}
                        </span>
                        {l.tipo === 'compra'
                          ? 'Compra fiado'
                          : l.tipo === 'pagamento'
                          ? `Pagamento (${
                              l.forma === 'pix_manual'
                                ? 'Pix manual'
                                : l.forma === 'debito'
                                ? 'Débito'
                                : 'Dinheiro'
                            })`
                          : 'Estorno'}
                      </p>

                      <p className="mt-0.5 text-sm text-slate-600">
                        {l.criadoEm.toLocaleDateString('pt-BR')}
                        {l.itens ? ` · ${l.itens}` : ''}
                        {l.vencimento ? ` · Venc. ${formatDateBR(l.vencimento)}` : ''}
                        {l.tipo === 'compra' && !foiEstornado
                          ? ` · Em aberto ${formatCentavos(l.valorEmAberto)}`
                          : ''}
                        {l.autorizadoExcecaoPor ? ' · Liberado com PIN do Dono' : ''}
                        {l.justificativa ? ` · Motivo: ${l.justificativa}` : ''}
                        {foiEstornado ? ' · Estornado' : ''}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span
                        className={`font-mono-nums text-base font-bold ${
                          foiEstornado
                            ? 'line-through text-slate-400'
                            : l.tipo === 'pagamento'
                            ? 'text-teal-700'
                            : l.tipo === 'estorno'
                            ? 'text-amber-800'
                            : 'text-[#14211E]'
                        }`}
                      >
                        {l.tipo === 'pagamento' ? '− ' : ''}
                        {formatCentavos(l.valor)}
                      </span>

                      {isDono && l.tipo !== 'estorno' && !foiEstornado && (
                        <button
                          type="button"
                          onClick={() => {
                            setErroEstorno(null);
                            setJustificativa('');
                            setEstornoAlvo(l);
                          }}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>Estornar</span>
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Privacidade, Opt-out (RF17 / RN12) e Direitos do Titular (RF19) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Card Opt-out & Histórico de Consentimentos */}
        <section className="rounded-2xl border border-[#E4E4DF] bg-white p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[#14211E]">
              <ShieldCheck className="h-5 w-5 text-teal-700" />
              <h2 className="text-lg font-bold">Consentimento e Opt-out WhatsApp</h2>
            </div>
            <span
              className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${
                cliente.anonimizado
                  ? 'border-slate-300 bg-slate-100 text-slate-700'
                  : cliente.semContatoWhatsapp
                  ? 'border-red-300 bg-red-50 text-red-900'
                  : cliente.consentimentoWhatsapp
                  ? 'border-teal-300 bg-teal-50 text-teal-900'
                  : 'border-amber-300 bg-amber-50 text-amber-900'
              }`}
            >
              {cliente.anonimizado
                ? 'Anonimizado'
                : cliente.semContatoWhatsapp
                ? 'Opt-out ativo'
                : cliente.consentimentoWhatsapp
                ? 'Autorizado'
                : 'Sem consentimento'}
            </span>
          </div>

          <p className="text-sm text-slate-600">
            {cliente.semContatoWhatsapp
              ? 'Este cliente pediu para não receber mensagens. O consentimento anterior foi preservado no histórico, mas qualquer envio pelo WhatsApp está bloqueado.'
              : cliente.consentimentoWhatsapp
              ? 'Cliente autorizou receber comprovantes e lembretes pelo WhatsApp. Se pedir para parar, registre o opt-out abaixo.'
              : 'Cliente ainda não possui consentimento ativo para contato via WhatsApp.'}
          </p>

          {erroConsentimento && (
            <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">
              {erroConsentimento}
            </p>
          )}
          {msgConsentimento && (
            <p className="rounded-xl bg-teal-50 p-3 text-sm text-teal-900">{msgConsentimento}</p>
          )}

          {!cliente.anonimizado && (
            <div className="flex flex-wrap gap-2">
              {!cliente.semContatoWhatsapp && (
                <button
                  type="button"
                  onClick={() => {
                    setErroConsentimento(null);
                    setOptOutAberto((v) => !v);
                    setNovoConsentAberto(false);
                  }}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100"
                >
                  <BellOff className="h-4 w-4" />
                  <span>Registrar opt-out de mensagens</span>
                </button>
              )}

              {isDono && (cliente.semContatoWhatsapp || !cliente.consentimentoWhatsapp) && (
                <button
                  type="button"
                  onClick={() => {
                    setErroConsentimento(null);
                    setNovoConsentAberto((v) => !v);
                    setOptOutAberto(false);
                  }}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-teal-700 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-900 hover:bg-teal-100"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Registrar novo consentimento</span>
                </button>
              )}
            </div>
          )}

          {optOutAberto && !cliente.semContatoWhatsapp && !cliente.anonimizado && (
            <form
              onSubmit={handleRegistrarOptOut}
              className="rounded-xl border border-red-200 bg-[#FAFAF8] p-4 space-y-3"
            >
              <p className="text-sm font-bold text-[#14211E]">Registrar pedido de opt-out (RN12)</p>

              <div>
                <label htmlFor="optout-canal" className="block text-sm font-semibold text-[#14211E]">
                  Canal do pedido
                </label>
                <select
                  id="optout-canal"
                  value={optOutCanal}
                  onChange={(e) => {
                    const novoCanal = e.target.value as CanalConsentimento;
                    setOptOutCanal(novoCanal);
                    if (optOutPedidoProprio) {
                      setOptOutOrigem(
                        `Pedido feito pelo próprio cliente via ${CANAL_LABEL[novoCanal]}`
                      );
                    }
                  }}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D4D4CE] bg-white px-3 text-sm text-[#14211E]"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="balcao">Balcão (presencial)</option>
                  <option value="link_consulta">Link de consulta</option>
                  <option value="cadastro">Cadastro</option>
                </select>
              </div>

              <label className="flex items-center gap-2.5 text-sm text-[#14211E] cursor-pointer">
                <input
                  type="checkbox"
                  checked={optOutPedidoProprio}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setOptOutPedidoProprio(checked);
                    setOptOutOrigem(
                      checked
                        ? `Pedido feito pelo próprio cliente via ${CANAL_LABEL[optOutCanal]}`
                        : `Solicitado para o atendimento via ${CANAL_LABEL[optOutCanal]}`
                    );
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-teal-700"
                />
                <span>Pedido feito pelo próprio cliente</span>
              </label>

              <div>
                <label htmlFor="optout-origem" className="block text-sm font-semibold text-[#14211E]">
                  Origem / observação
                </label>
                <input
                  id="optout-origem"
                  type="text"
                  required
                  minLength={2}
                  maxLength={160}
                  value={optOutOrigem}
                  onChange={(e) => setOptOutOrigem(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D4D4CE] bg-white px-3 text-sm text-[#14211E]"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Responsável pelo registro: {usuario?.nome || usuario?.uid}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOptOutAberto(false)}
                  className="min-h-[44px] flex-1 rounded-xl border border-[#D4D4CE] bg-white text-sm font-semibold text-[#14211E]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoOptOut}
                  className="min-h-[44px] flex-1 rounded-xl bg-red-700 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                >
                  {salvandoOptOut ? 'Salvando...' : 'Confirmar opt-out'}
                </button>
              </div>
            </form>
          )}

          {novoConsentAberto && isDono && !cliente.anonimizado && (
            <form
              onSubmit={handleRegistrarNovoConsentimento}
              className="rounded-xl border border-teal-200 bg-[#FAFAF8] p-4 space-y-3"
            >
              <p className="text-sm font-bold text-[#14211E]">Registrar novo consentimento (Dono)</p>

              <div>
                <label htmlFor="novoconsent-canal" className="block text-sm font-semibold text-[#14211E]">
                  Canal
                </label>
                <select
                  id="novoconsent-canal"
                  value={novoConsentCanal}
                  onChange={(e) => setNovoConsentCanal(e.target.value as CanalConsentimento)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D4D4CE] bg-white px-3 text-sm text-[#14211E]"
                >
                  <option value="balcao">Balcão (presencial)</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="cadastro">Cadastro</option>
                  <option value="link_consulta">Link de consulta</option>
                </select>
              </div>

              <div>
                <label htmlFor="novoconsent-origem" className="block text-sm font-semibold text-[#14211E]">
                  Origem
                </label>
                <input
                  id="novoconsent-origem"
                  type="text"
                  required
                  minLength={2}
                  maxLength={160}
                  value={novoConsentOrigem}
                  onChange={(e) => setNovoConsentOrigem(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D4D4CE] bg-white px-3 text-sm text-[#14211E]"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setNovoConsentAberto(false)}
                  className="min-h-[44px] flex-1 rounded-xl border border-[#D4D4CE] bg-white text-sm font-semibold text-[#14211E]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoNovoConsent}
                  className="min-h-[44px] flex-1 rounded-xl bg-teal-700 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {salvandoNovoConsent ? 'Salvando...' : 'Salvar consentimento'}
                </button>
              </div>
            </form>
          )}

          <div className="border-t border-[#ECECE7] pt-3">
            <h3 className="text-sm font-bold text-[#14211E]">Histórico imutável de consentimentos</h3>
            {consentimentos.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                {cliente.consentimentoWhatsapp
                  ? `Consentimento inicial registrado em ${cliente.consentimentoEm.toLocaleDateString('pt-BR')}.`
                  : 'Nenhum evento registrado.'}
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-[#ECECE7]">
                {consentimentos.map((ev) => (
                  <li key={ev.id} className="py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-semibold ${
                          ev.tipo === 'opt_out' ? 'text-red-800' : 'text-teal-800'
                        }`}
                      >
                        {ev.tipo === 'opt_out' ? 'Opt-out registrado' : 'Consentimento registrado'}
                      </span>
                      <span className="font-mono-nums text-xs text-slate-500">
                        {ev.dataHora.getTime() > 0
                          ? ev.dataHora.toLocaleString('pt-BR', {
                              timeZone: 'America/Bahia',
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                          : 'Agora'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-600">
                      Canal: {CANAL_LABEL[ev.canal] || ev.canal} · {ev.origem}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Card Direitos do Titular (RF19) */}
        <section className="rounded-2xl border border-[#E4E4DF] bg-white p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[#14211E]">
              <FileText className="h-5 w-5 text-teal-700" />
              <h2 className="text-lg font-bold">Direitos do titular (LGPD · RF19)</h2>
            </div>

            {isDono && (
              <button
                type="button"
                onClick={handleExportarCliente}
                disabled={exportandoCliente}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-3.5 py-2 text-sm font-semibold text-[#14211E] hover:bg-slate-50 disabled:opacity-50"
              >
                <Download className="h-4 w-4 text-teal-700" />
                <span>
                  {exportandoCliente ? 'Exportando...' : 'Exportar dados do cliente (JSON)'}
                </span>
              </button>
            )}
          </div>

          <p className="text-sm text-slate-600">
            Registre pedidos de acesso, correção, portabilidade ou exclusão feitos pelo cliente. Prazo configurado: {comercio?.prazoSolicitacaoTitularDias ?? 15} dias.
          </p>

          {erroTitular && (
            <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">
              {erroTitular}
            </p>
          )}
          {msgTitular && (
            <p className="rounded-xl bg-teal-50 p-3 text-sm text-teal-900">{msgTitular}</p>
          )}

          <form
            onSubmit={handleCriarSolicitacao}
            className="rounded-xl border border-[#E4E4DF] bg-[#FAFAF8] p-4 space-y-3"
          >
            <p className="text-sm font-bold text-[#14211E]">Nova solicitação do titular</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="sol-tipo" className="block text-xs font-semibold text-slate-700">
                  Tipo de direito
                </label>
                <select
                  id="sol-tipo"
                  value={solTipo}
                  onChange={(e) => setSolTipo(e.target.value as TipoSolicitacaoTitular)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D4D4CE] bg-white px-3 text-sm text-[#14211E]"
                >
                  <option value="acesso">Acesso aos dados</option>
                  <option value="correcao">Correção de dados</option>
                  <option value="portabilidade">Portabilidade (JSON)</option>
                  <option value="exclusao">Exclusão / anonimização</option>
                </select>
              </div>
              <div>
                <label htmlFor="sol-obs" className="block text-xs font-semibold text-slate-700">
                  Observação (opcional)
                </label>
                <input
                  id="sol-obs"
                  type="text"
                  maxLength={300}
                  value={solObs}
                  onChange={(e) => setSolObs(e.target.value)}
                  placeholder="Ex: Pedido feito no balcão"
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D4D4CE] bg-white px-3 text-sm text-[#14211E]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={abrindoSol}
              className="min-h-[44px] w-full rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {abrindoSol ? 'Registrando...' : 'Abrir solicitação'}
            </button>
          </form>

          <div className="border-t border-[#ECECE7] pt-3">
            <h3 className="text-sm font-bold text-[#14211E]">Solicitações registradas</h3>
            {solicitacoes.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                Nenhuma solicitação de titular registrada para este cliente.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {solicitacoes.map((s) => {
                  const prazoEval = avaliarPrazoSolicitacao(s.prazoEm, s.status);
                  const cardTone =
                    prazoEval.situacao === 'vencida'
                      ? 'border-red-300 bg-red-50/60'
                      : prazoEval.situacao === 'perto_prazo'
                      ? 'border-amber-300 bg-amber-50/70'
                      : 'border-[#E4E4DF] bg-white';
                  const badgeTone =
                    prazoEval.situacao === 'atendida'
                      ? 'border-teal-300 bg-teal-50 text-teal-900'
                      : prazoEval.situacao === 'vencida'
                      ? 'border-red-300 bg-red-100 text-red-900'
                      : prazoEval.situacao === 'perto_prazo'
                      ? 'border-amber-300 bg-amber-100 text-amber-900'
                      : 'border-slate-300 bg-slate-100 text-slate-700';
                  const badgeTexto =
                    prazoEval.situacao === 'atendida'
                      ? 'Atendida'
                      : prazoEval.situacao === 'vencida'
                      ? `Prazo vencido (${Math.abs(prazoEval.diasRestantes)}d)`
                      : prazoEval.situacao === 'perto_prazo'
                      ? `Perto do prazo (${prazoEval.diasRestantes}d)`
                      : `No prazo (${prazoEval.diasRestantes}d)`;

                  return (
                    <li key={s.id} className={`rounded-xl border p-3.5 space-y-2 ${cardTone}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-bold text-[#14211E]">
                          {TIPO_SOLICITACAO_LABEL[s.tipo] || s.tipo}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${badgeTone}`}
                        >
                          {badgeTexto}
                        </span>
                      </div>

                      <p className="text-xs text-slate-600">
                        Aberta em{' '}
                        {s.dataAbertura.getTime() > 0
                          ? s.dataAbertura.toLocaleDateString('pt-BR')
                          : 'agora'}{' '}
                        · Prazo até {s.prazoEm.toLocaleDateString('pt-BR')}
                        {s.status === 'atendida' && s.dataConclusao
                          ? ` · Concluída em ${s.dataConclusao.toLocaleDateString('pt-BR')}`
                          : ''}
                      </p>

                      {s.observacao && <p className="text-xs text-slate-700">{s.observacao}</p>}

                      {isDono && s.status === 'aberta' && (
                        <div className="pt-1">
                          {s.tipo === 'exclusao' ? (
                            confirmExclusaoSolId === s.id ? (
                              <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                                <p className="text-xs font-semibold text-red-900">
                                  {cliente.anonimizado
                                    ? 'Cliente já está anonimizado. Deseja concluir esta solicitação de exclusão?'
                                    : `Esta ação anonimiza permanentemente nome e WhatsApp de ${cliente.nome}, revoga links de consulta e conclui a solicitação. Confirmar?`}
                                </p>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setConfirmExclusaoSolId(null)}
                                    className="min-h-[38px] flex-1 rounded-lg border border-[#D4D4CE] bg-white text-xs font-semibold text-[#14211E]"
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    type="button"
                                    disabled={concluindoSolId === s.id}
                                    onClick={() => void handleConcluirSolicitacao(s)}
                                    className="min-h-[38px] flex-1 rounded-lg bg-red-700 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                                  >
                                    {concluindoSolId === s.id
                                      ? 'Processando...'
                                      : 'Confirmar exclusão e concluir'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmExclusaoSolId(s.id)}
                                className="min-h-[40px] rounded-xl border border-red-300 bg-red-50 px-3 text-xs font-semibold text-red-800 hover:bg-red-100"
                              >
                                Anonimizar cliente e concluir
                              </button>
                            )
                          ) : (
                            <button
                              type="button"
                              disabled={concluindoSolId === s.id}
                              onClick={() => void handleConcluirSolicitacao(s)}
                              className="min-h-[40px] rounded-xl border border-teal-700 bg-teal-50 px-3 text-xs font-semibold text-teal-900 hover:bg-teal-100 disabled:opacity-50"
                            >
                              {concluindoSolId === s.id
                                ? 'Concluindo...'
                                : 'Marcar como atendida'}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Modal de Estorno (Somente Dono) */}
      {estornoAlvo && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="estorno-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E4E4DF] bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <h2 id="estorno-title" className="text-xl font-bold text-[#14211E]">
                Estornar lançamento
              </h2>
              <button
                type="button"
                onClick={() => setEstornoAlvo(null)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-2 text-base text-slate-600">
              Valor: <strong className="font-mono-nums">{formatCentavos(estornoAlvo.valor)}</strong>. O histórico original permanece registrado e o saldo será recalculado.
            </p>

            <form onSubmit={handleConfirmarEstorno} className="mt-4 space-y-4">
              <div>
                <label htmlFor="just-estorno" className="block text-base font-semibold text-[#14211E]">
                  Justificativa obrigatória
                </label>
                <textarea
                  id="just-estorno"
                  required
                  minLength={3}
                  maxLength={300}
                  rows={3}
                  value={justificativa}
                  onChange={(e) => setJustificativa(e.target.value)}
                  placeholder="Ex: Lançado no cliente errado / valor digitado errado"
                  className="mt-1.5 w-full rounded-xl border border-[#D4D4CE] p-3 text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
                />
              </div>

              {erroEstorno && (
                <p className="rounded-xl bg-red-50 p-3 text-base text-red-800">{erroEstorno}</p>
              )}

              <div className="flex flex-col-reverse sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => setEstornoAlvo(null)}
                  className="min-h-[48px] flex-1 rounded-xl border border-[#D4D4CE] px-4 text-base font-semibold text-[#14211E]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={estornando || justificativa.trim().length < 3}
                  className="min-h-[48px] flex-1 rounded-xl bg-red-700 px-4 text-base font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                >
                  {estornando ? 'Estornando...' : 'Confirmar estorno'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Ajuste de Limite (Somente Dono) */}
      {isDono && limiteModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="limite-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E4E4DF] bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <h2 id="limite-title" className="text-xl font-bold text-[#14211E]">
                Ajustar limite de crédito
              </h2>
              <button
                type="button"
                onClick={() => setLimiteModalOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-2 text-sm text-slate-600">
              Cliente: <strong className="text-[#14211E]">{cliente.nome}</strong> · Limite atual:{' '}
              <strong className="font-mono-nums">{formatCentavos(cliente.limiteCredito)}</strong>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              A alteração será registrada na auditoria com data e responsável ({usuario?.nome}).
            </p>

            <form onSubmit={handleConfirmarAjusteLimite} className="mt-4 space-y-4">
              <div>
                <label htmlFor="novo-limite-input" className="block text-base font-semibold text-[#14211E]">
                  Novo limite de crédito (R$)
                </label>
                <input
                  id="novo-limite-input"
                  type="text"
                  inputMode="decimal"
                  required
                  autoFocus
                  value={novoLimiteStr}
                  onChange={(e) => {
                    setErroLimite(null);
                    setNovoLimiteStr(e.target.value);
                  }}
                  placeholder="200,00"
                  className="mt-1.5 min-h-[52px] w-full rounded-xl border border-[#D4D4CE] px-4 font-mono-nums text-xl font-bold text-[#14211E] focus:border-teal-700 focus:outline-none"
                />
              </div>

              {erroLimite && (
                <p className="rounded-xl bg-red-50 p-3 text-base text-red-800">{erroLimite}</p>
              )}

              <div className="flex flex-col-reverse sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => setLimiteModalOpen(false)}
                  className="min-h-[48px] flex-1 rounded-xl border border-[#D4D4CE] px-4 text-base font-semibold text-[#14211E]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoLimite}
                  className="min-h-[48px] flex-1 rounded-xl bg-teal-700 px-4 text-base font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {salvandoLimite ? 'Salvando...' : 'Salvar novo limite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
