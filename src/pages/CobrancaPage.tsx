import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Check, CheckCircle2, MessageCircle, Save, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  buildWhatsAppUrl,
  calcularDiasAtraso,
  formatCentavos,
  formatDateBR,
  formatWhatsAppDisplay,
  getBahiaDateString,
  motivoBloqueioWhatsApp,
  podeEnviarWhatsApp,
} from '../lib/businessRules';
import { carregarDadosExemplo, salvarObservacaoDonoCliente } from '../lib/firestoreService';
import { isErroLimitePlano, verificarPermissaoAdicaoClientes } from '../lib/planos';

type FiltroCobranca = 'todos' | 'mais_15' | 'ate_7';

export const CobrancaPage: React.FC = () => {
  const { clientes, comercio, usuario, usoPlano } = useAuth();
  const isDono = usuario?.perfil === 'dono';
  const [filtro, setFiltro] = useState<FiltroCobranca>('todos');
  const [obsRascunhos, setObsRascunhos] = useState<Record<string, string>>({});
  const [salvandoObsId, setSalvandoObsId] = useState<string | null>(null);
  const [salvoObsId, setSalvoObsId] = useState<string | null>(null);
  const [erroObs, setErroObs] = useState<string | null>(null);
  const [carregandoDemo, setCarregandoDemo] = useState(false);
  const [msgDemo, setMsgDemo] = useState<string | null>(null);
  const [erroDemo, setErroDemo] = useState<string | null>(null);
  const [erroDemoLimite, setErroDemoLimite] = useState(false);

  const hojeBahia = getBahiaDateString();

  const vencidosComAtraso = useMemo(() => {
    return clientes
      .filter((c) => !c.anonimizado && c.ativo && c.valorVencido > 0)
      .map((c) => ({
        cliente: c,
        diasAtraso: c.proximoVencimento ? calcularDiasAtraso(c.proximoVencimento, hojeBahia) : 0,
      }))
      .sort((a, b) => {
        if (b.diasAtraso !== a.diasAtraso) return b.diasAtraso - a.diasAtraso;
        return b.cliente.valorVencido - a.cliente.valorVencido;
      });
  }, [clientes, hojeBahia]);

  const listaFiltrada = useMemo(() => {
    return vencidosComAtraso.filter(({ diasAtraso }) => {
      if (filtro === 'mais_15') return diasAtraso > 15;
      if (filtro === 'ate_7') return diasAtraso <= 7;
      return true;
    });
  }, [vencidosComAtraso, filtro]);

  const totalVencidoFiltrado = useMemo(
    () => listaFiltrada.reduce((acc, item) => acc + item.cliente.valorVencido, 0),
    [listaFiltrada]
  );

  const handleSalvarObservacao = async (clienteId: string, clienteNome: string, valor: string) => {
    if (!comercio || !usuario || !isDono) return;
    setErroObs(null);
    setSalvandoObsId(clienteId);
    try {
      await salvarObservacaoDonoCliente({
        comercioId: comercio.id,
        clienteId,
        clienteNome,
        observacao: valor,
        uid: usuario.uid,
      });
      setSalvoObsId(clienteId);
      setTimeout(() => setSalvoObsId((prev) => (prev === clienteId ? null : prev)), 2500);
    } catch (err) {
      setErroObs(err instanceof Error ? err.message : 'Erro ao salvar observação.');
    } finally {
      setSalvandoObsId(null);
    }
  };

  const handleCarregarExemplo = async () => {
    if (!comercio || !usuario || !isDono) return;
    setMsgDemo(null);
    setErroDemo(null);
    setErroDemoLimite(false);
    const check = verificarPermissaoAdicaoClientes(usoPlano, 1);
    if (!check.permitido) {
      setErroDemo(check.mensagem);
      setErroDemoLimite(true);
      return;
    }
    setCarregandoDemo(true);
    try {
      const res = await carregarDadosExemplo({ comercioId: comercio.id, uid: usuario.uid });
      if (res.adicionados > 0) {
        setMsgDemo(
          `${res.adicionados} cliente(s) adicionado(s) na aplicação, incluindo 4 com pagamentos vencidos (5, 9, 12 e 20 dias de atraso).`
        );
      } else {
        setMsgDemo('Todos os clientes de teste já estão cadastrados neste comércio.');
      }
    } catch (err) {
      setErroDemoLimite(isErroLimitePlano(err));
      setErroDemo(
        err instanceof Error ? err.message : 'Não foi possível adicionar os clientes.'
      );
    } finally {
      setCarregandoDemo(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#E4E4DF] bg-white p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#14211E]">Cobrança manual</h1>
            <p className="mt-1 text-base text-slate-600">
              Clientes com compras vencidas. O envio pelo WhatsApp abre a conversa direta com o cliente, com mensagem cordial e sem expor dados a terceiros.
            </p>
          </div>
          {isDono && vencidosComAtraso.length > 0 && (
            <button
              type="button"
              onClick={handleCarregarExemplo}
              disabled={carregandoDemo}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-[#FAFAF8] px-4 py-2 text-sm font-semibold text-[#14211E] hover:bg-slate-100 disabled:opacity-50 shrink-0"
            >
              <Sparkles className="h-4 w-4 text-amber-600" />
              <span>{carregandoDemo ? 'Adicionando...' : 'Inserir clientes com vencidos'}</span>
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-[#ECECE7] pt-4">
          <div className="flex flex-wrap items-baseline gap-4">
            <div>
              <span className="text-sm text-slate-600">Total vencido no filtro: </span>
              <strong className="font-mono-nums text-2xl font-bold text-red-700">
                {formatCentavos(totalVencidoFiltrado)}
              </strong>
            </div>
            <span className="text-sm text-slate-600">
              {listaFiltrada.length} cliente(s)
            </span>
          </div>

          <div className="flex items-center gap-1 rounded-xl bg-[#F3F4F1] p-1 overflow-x-auto">
            {(
              [
                { id: 'todos', label: 'Todos vencidos' },
                { id: 'mais_15', label: 'Mais de 15 dias' },
                { id: 'ate_7', label: 'Até 7 dias' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFiltro(tab.id)}
                className={`min-h-[40px] rounded-lg px-3.5 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  filtro === tab.id
                    ? 'bg-white text-[#14211E] shadow-xs'
                    : 'text-slate-600 hover:text-[#14211E]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {erroObs && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {erroObs}
          </p>
        )}

        {msgDemo && (
          <p className="rounded-xl bg-teal-50 px-4 py-3 text-sm font-medium text-teal-900">
            {msgDemo}
          </p>
        )}

        {erroDemo && (
          <div
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            <span>{erroDemo}</span>
            {erroDemoLimite && (
              <Link
                to="/planos"
                className="inline-flex min-h-[38px] items-center justify-center rounded-lg bg-red-800 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-900 whitespace-nowrap shrink-0"
              >
                Ver planos
              </Link>
            )}
          </div>
        )}
      </div>

      {vencidosComAtraso.length === 0 ? (
        <div className="rounded-2xl border border-[#E4E4DF] bg-white p-8 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-teal-700" />
          <h2 className="mt-3 text-lg font-bold text-[#14211E]">Nenhuma conta vencida</h2>
          <p className="mt-1 text-base text-slate-600">
            Todos os clientes estão em dia com seus vencimentos.
          </p>
          {isDono && (
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={handleCarregarExemplo}
                disabled={carregandoDemo}
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-[#FAFAF8] px-5 py-3 text-base font-semibold text-[#14211E] hover:bg-slate-100 disabled:opacity-50"
              >
                <Sparkles className="h-5 w-5 text-amber-600" />
                <span>
                  {carregandoDemo
                    ? 'Adicionando clientes...'
                    : 'Adicionar clientes de exemplo com compras vencidas'}
                </span>
              </button>
            </div>
          )}
        </div>
      ) : listaFiltrada.length === 0 ? (
        <div className="rounded-2xl border border-[#E4E4DF] bg-white p-8 text-center">
          <p className="text-base text-slate-600">
            Nenhum cliente vencido nesta faixa de dias de atraso.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {listaFiltrada.map(({ cliente: c, diasAtraso }) => {
            const primeiroNome = c.nome.trim().split(/\s+/)[0] || c.nome;
            const mensagem = `Olá, ${primeiroNome}! Tudo bem? Aqui é de ${
              comercio?.nome || 'nosso comércio'
            }. Passando com atenção para lembrar da sua caderneta, que tem um valor vencido de ${formatCentavos(
              c.valorVencido
            )} (saldo total ${formatCentavos(
              c.saldoDevedor
            )}). Quando puder passar por aqui ou combinar o pagamento, nos avise. Obrigado!`;

            const obsValor =
              obsRascunhos[c.id] !== undefined ? obsRascunhos[c.id] : c.observacaoDono || '';
            const obsAlterada = obsValor.trim() !== (c.observacaoDono || '').trim();

            return (
              <li
                key={c.id}
                className="rounded-2xl border border-[#E4E4DF] bg-white p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/clientes/${c.id}`}
                        className="text-lg font-bold text-[#14211E] hover:text-teal-800 hover:underline"
                      >
                        {c.nome}
                      </Link>
                      <span
                        className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${
                          diasAtraso > 15
                            ? 'border-red-300 bg-red-50 text-red-900'
                            : 'border-amber-300 bg-amber-50 text-amber-900'
                        }`}
                      >
                        {diasAtraso} {diasAtraso === 1 ? 'dia de atraso' : 'dias de atraso'}
                      </span>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
                      <span>{formatWhatsAppDisplay(c.whatsapp)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                        <AlertCircle className="h-4 w-4" />
                        Vencido: {formatCentavos(c.valorVencido)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Dia de vencimento: todo dia {c.diaVencimento}</span>
                      {c.proximoVencimento && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Desde {formatDateBR(c.proximoVencimento)}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>Saldo total: {formatCentavos(c.saldoDevedor)}</span>
                    </div>
                  </div>

                  {podeEnviarWhatsApp(c) ? (
                    <a
                      href={buildWhatsAppUrl(c.whatsapp, mensagem)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#15803D] px-5 py-3 text-base font-semibold text-white hover:bg-[#166534] shrink-0"
                    >
                      <MessageCircle className="h-5 w-5" />
                      <span>Conversar no WhatsApp</span>
                    </a>
                  ) : (
                    <div className="flex flex-col sm:items-end gap-1.5 shrink-0 max-w-xs">
                      <button
                        type="button"
                        disabled
                        className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-slate-100 px-5 py-3 text-base font-semibold text-slate-500 cursor-not-allowed"
                      >
                        <MessageCircle className="h-5 w-5" />
                        <span>WhatsApp bloqueado</span>
                      </button>
                      <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                        {motivoBloqueioWhatsApp(c)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Observação do dono (somente Dono edita; Atendente apenas visualiza se houver) */}
                {isDono ? (
                  <div className="border-t border-[#ECECE7] pt-3">
                    <label
                      htmlFor={`obs-${c.id}`}
                      className="block text-sm font-semibold text-[#14211E]"
                    >
                      Observação do dono (opcional)
                    </label>
                    <div className="mt-1.5 flex flex-col sm:flex-row gap-2">
                      <input
                        id={`obs-${c.id}`}
                        type="text"
                        maxLength={300}
                        value={obsValor}
                        onChange={(e) =>
                          setObsRascunhos((prev) => ({ ...prev, [c.id]: e.target.value }))
                        }
                        placeholder="Ex: Combinou de passar sexta após as 18h"
                        className="min-h-[44px] flex-1 rounded-xl border border-[#D4D4CE] bg-[#FAFAF8] px-3.5 text-sm text-[#14211E] focus:border-teal-700 focus:bg-white focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={salvandoObsId === c.id || (!obsAlterada && salvoObsId !== c.id)}
                        onClick={() => handleSalvarObservacao(c.id, c.nome, obsValor)}
                        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#D4D4CE] bg-white px-4 text-sm font-semibold text-[#14211E] hover:bg-slate-50 disabled:opacity-50 shrink-0"
                      >
                        {salvoObsId === c.id ? (
                          <>
                            <Check className="h-4 w-4 text-teal-700" />
                            <span>Salvo</span>
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4 text-teal-700" />
                            <span>{salvandoObsId === c.id ? 'Salvando...' : 'Salvar nota'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  c.observacaoDono && (
                    <p className="border-t border-[#ECECE7] pt-3 text-sm text-slate-700">
                      <strong>Observação do dono:</strong> {c.observacaoDono}
                    </p>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
