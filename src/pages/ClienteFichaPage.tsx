import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowLeft,
  Edit3,
  Link2,
  Plus,
  RotateCcw,
  ShieldOff,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  buildWhatsAppUrl,
  estaPertoDoLimite,
  formatCentavos,
  formatDateBR,
  formatWhatsAppDisplay,
  parseBRLToCentavos,
  type Lancamento,
  type LinkConsulta,
} from '../lib/businessRules';
import {
  ajustarLimiteCliente,
  estornarLancamento,
  gerarLinkConsulta,
  observarLancamentosCliente,
  observarLinksCliente,
  revogarLinkConsulta,
} from '../lib/firestoreService';
import { APP_PUBLIC_URL } from '../lib/qrUrl';
import { QRCodeCard } from '../components/QRCodeCard';

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
  const [erroLink, setErroLink] = useState<string | null>(null);

  // Modal de estorno (só Dono)
  const [estornoAlvo, setEstornoAlvo] = useState<Lancamento | null>(null);
  const [justificativa, setJustificativa] = useState('');
  const [estornando, setEstornando] = useState(false);
  const [erroEstorno, setErroEstorno] = useState<string | null>(null);

  // Modal de ajuste de limite (só Dono)
  const [limiteModalOpen, setLimiteModalOpen] = useState(false);
  const [novoLimiteStr, setNovoLimiteStr] = useState('');
  const [salvandoLimite, setSalvandoLimite] = useState(false);
  const [erroLimite, setErroLimite] = useState<string | null>(null);

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
    return () => {
      unsubL();
      unsubK();
    };
  }, [comercio, id]);

  const linkAtivo = useMemo(() => {
    const agora = Date.now();
    return links.find((l) => !l.revogado && l.expiraEm.getTime() > agora) || null;
  }, [links]);

  useEffect(() => {
    if (linkAtivo && typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(`${LOCAL_TOKEN_PREFIX}${linkAtivo.tokenHash}`);
      setTokenAtual(saved);
    } else {
      setTokenAtual(null);
    }
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao gerar link.';
      setErroLink(
        msg.includes('Missing or insufficient permissions') || msg.includes('PERMISSION_DENIED')
          ? 'Sem permissão no Firestore para gerar link. Confira se as regras de firestore.rules estão publicadas no Firebase Console.'
          : msg
      );
    } finally {
      setGerandoLink(false);
    }
  };

  const handleRevogarLink = async () => {
    if (!comercio || !usuario || !linkAtivo) return;
    setErroLink(null);
    await revogarLinkConsulta({
      comercioId: comercio.id,
      tokenHash: linkAtivo.tokenHash,
      uid: usuario.uid,
    });
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(`${LOCAL_TOKEN_PREFIX}${linkAtivo.tokenHash}`);
    }
    setTokenAtual(null);
  };

  const handleConfirmarEstorno = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comercio || !usuario || !estornoAlvo) return;
    setErroEstorno(null);
    setEstornando(true);
    try {
      await estornarLancamento({
        comercioId: comercio.id,
        comercioNome: comercio.nome,
        clienteId: cliente.id,
        lancamentoAlvo: estornoAlvo,
        justificativa,
        uid: usuario.uid,
      });
      setEstornoAlvo(null);
      setJustificativa('');
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

        {!cliente.anonimizado && (
          <a
            href={buildWhatsAppUrl(cliente.whatsapp, comprovanteMensagem)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[52px] items-center justify-center rounded-xl bg-[#15803D] px-5 py-3 text-base font-semibold text-white hover:bg-[#166534]"
          >
            Enviar comprovante por WhatsApp
          </a>
        )}
      </div>

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

          {linkAtivo && consultaUrl ? (
            <div className="mt-5 space-y-4">
              <QRCodeCard
                url={consultaUrl}
                titulo={`Consulta de ${cliente.nome}`}
                subtitulo={`Validade até ${linkAtivo.expiraEm.toLocaleDateString('pt-BR')}`}
                tamanhoPx={220}
                filenamePng={`consulta-${cliente.nome.toLowerCase().replace(/\s+/g, '-')}.png`}
                extraWhatsAppUrl={buildWhatsAppUrl(
                  cliente.whatsapp,
                  `Olá, ${cliente.nome.split(' ')[0]}! Aqui está o seu link para consultar seu saldo em ${
                    comercio?.nome || 'nosso comércio'
                  }: ${consultaUrl} (digite os 4 últimos dígitos do seu WhatsApp para abrir).`
                )}
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
              {linkAtivo && !consultaUrl && (
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
