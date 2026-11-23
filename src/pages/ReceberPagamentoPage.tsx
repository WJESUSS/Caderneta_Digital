import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  formatCentavos,
  formatWhatsAppDisplay,
  parseBRLToCentavos,
  validarPagamento,
} from '../lib/businessRules';
import { registrarPagamento } from '../lib/firestoreService';
import { enqueueOfflineLancamento, generateIdempotencyKey } from '../lib/offlineQueue';
import { useOnlineStatus } from '../hooks/usePWAInstall';
import { ComprovanteCard, type ComprovanteDados } from '../components/ComprovanteCard';

type FormaRecebimento = 'dinheiro' | 'pix_manual' | 'debito';

export const ReceberPagamentoPage: React.FC = () => {
  const { clientes, comercio, usuario, refreshOfflineQueueCount } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();

  const initialClientId = searchParams.get('clienteId') || '';
  const [clienteId, setClienteId] = useState(initialClientId);
  const [busca, setBusca] = useState('');
  const [valorStr, setValorStr] = useState('');
  const [forma, setForma] = useState<FormaRecebimento>('dinheiro');
  const [pixConfirmadoExtrato, setPixConfirmadoExtrato] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState<ComprovanteDados | null>(null);

  const clientesComSaldo = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return clientes
      .filter((c) => !c.anonimizado && c.ativo && c.saldoDevedor > 0)
      .filter((c) => {
        if (!q) return true;
        return c.nome.toLowerCase().includes(q) || c.whatsapp.includes(q);
      })
      .sort((a, b) => b.saldoDevedor - a.saldoDevedor);
  }, [clientes, busca]);

  const clienteSelecionado = useMemo(
    () => clientes.find((c) => c.id === clienteId) || null,
    [clientes, clienteId]
  );

  const valorCentavos = parseBRLToCentavos(valorStr);

  const labelForma = (f: FormaRecebimento) =>
    f === 'dinheiro' ? 'Dinheiro' : f === 'pix_manual' ? 'Pix manual' : 'Débito';

  const handleQuitarTudo = () => {
    if (!clienteSelecionado) return;
    setErro(null);
    setValorStr((clienteSelecionado.saldoDevedor / 100).toFixed(2).replace('.', ','));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comercio || !usuario || !clienteSelecionado) return;
    setErro(null);

    const check = validarPagamento(clienteSelecionado.saldoDevedor, valorCentavos);
    if (!check.permitido) {
      setErro(check.motivo || 'Valor inválido.');
      return;
    }

    if (forma === 'pix_manual' && !pixConfirmadoExtrato) {
      setErro('Confirme no extrato bancário que o Pix caiu antes de concluir o pagamento.');
      return;
    }

    const idempotencyKey = generateIdempotencyKey('pag');
    const agora = new Date();
    setSalvando(true);
    try {
      if (!isOnline) {
        enqueueOfflineLancamento({
          idempotencyKey,
          comercioId: comercio.id,
          clienteId: clienteSelecionado.id,
          clienteNome: clienteSelecionado.nome,
          tipo: 'pagamento',
          valor: valorCentavos,
          forma,
          itens: '',
          autorizadoExcecaoPor: '',
          enqueuedAt: agora.getTime(),
        });
        refreshOfflineQueueCount();
        setConcluido({
          tipo: 'pagamento',
          comercioNome: comercio.nome,
          clienteNome: clienteSelecionado.nome,
          clienteWhatsapp: clienteSelecionado.whatsapp,
          saldoAnterior: clienteSelecionado.saldoDevedor,
          valor: valorCentavos,
          novoSaldo: check.novoSaldo,
          limiteCredito: clienteSelecionado.limiteCredito,
          formaLabel: labelForma(forma),
          dataHora: agora,
          lancamentoId: idempotencyKey,
          registradoPorNome: usuario.nome,
          offline: true,
        });
        return;
      }

      const res = await registrarPagamento({
        comercioId: comercio.id,
        comercioNome: comercio.nome,
        clienteId: clienteSelecionado.id,
        valorCentavos,
        forma,
        uid: usuario.uid,
        idempotencyKey,
      });

      setConcluido({
        tipo: 'pagamento',
        comercioNome: comercio.nome,
        clienteNome: clienteSelecionado.nome,
        clienteWhatsapp: clienteSelecionado.whatsapp,
        saldoAnterior: res.saldoAnterior,
        valor: valorCentavos,
        novoSaldo: res.novoSaldo,
        limiteCredito: res.limiteCredito,
        formaLabel: labelForma(forma),
        dataHora: agora,
        lancamentoId: res.lancamentoId,
        registradoPorNome: usuario.nome,
        offline: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao registrar pagamento.';
      if (msg.includes('Missing or insufficient permissions') || msg.includes('PERMISSION_DENIED')) {
        setErro(
          'Sem permissão no Firestore para gravar este pagamento. Confira se as regras completas de firestore.rules estão publicadas no Firebase Console.'
        );
      } else if (msg.startsWith('{')) {
        try {
          const parsed = JSON.parse(msg);
          setErro(String(parsed?.error || 'Erro ao registrar pagamento.'));
        } catch {
          setErro(msg);
        }
      } else {
        setErro(msg);
      }
    } finally {
      setSalvando(false);
    }
  };

  if (concluido) {
    return (
      <ComprovanteCard
        dados={concluido}
        acoesExtras={
          <>
            <button
              type="button"
              onClick={() => {
                setConcluido(null);
                setValorStr('');
                setPixConfirmadoExtrato(false);
                setClienteId('');
              }}
              className="flex min-h-[52px] w-full items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800"
            >
              Receber outro pagamento
            </button>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="flex min-h-[48px] w-full items-center justify-center rounded-xl border border-[#D4D4CE] bg-white px-5 py-3 text-base font-semibold text-[#14211E] hover:bg-slate-50"
            >
              Voltar ao início
            </button>
          </>
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (clienteSelecionado && !initialClientId ? setClienteId('') : navigate(-1))}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[#E4E4DF] bg-white text-[#14211E] hover:bg-slate-50"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-[#14211E]">Receber pagamento</h1>
          <p className="text-sm text-slate-600">Abate automaticamente da compra vencida mais antiga</p>
        </div>
      </div>

      {!clienteSelecionado ? (
        <div className="rounded-2xl border border-[#E4E4DF] bg-white p-4 sm:p-6">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente com saldo em aberto..."
              className="min-h-[48px] w-full rounded-xl border border-[#D4D4CE] bg-[#FAFAF8] pl-11 pr-4 text-base text-[#14211E] focus:border-teal-700 focus:bg-white focus:outline-none"
            />
          </div>

          {clientesComSaldo.length === 0 ? (
            <p className="mt-6 text-center text-base text-slate-600 py-6">
              Nenhum cliente com saldo em aberto no momento.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[#ECECE7]">
              {clientesComSaldo.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setClienteId(c.id);
                      setPixConfirmadoExtrato(false);
                    }}
                    className="flex min-h-[64px] w-full items-center justify-between gap-4 py-3 px-2 text-left hover:bg-[#FAFAF8] rounded-xl"
                  >
                    <div>
                      <p className="text-base font-bold text-[#14211E]">{c.nome}</p>
                      <p className="text-sm text-slate-600">{formatWhatsAppDisplay(c.whatsapp)}</p>
                    </div>
                    <span className="font-mono-nums text-lg font-bold text-[#14211E] shrink-0">
                      {formatCentavos(c.saldoDevedor)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-[#E4E4DF] bg-white p-5 sm:p-6 space-y-5"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[#ECECE7] pb-4">
            <div>
              <p className="text-sm text-slate-600">Cliente</p>
              <p className="text-lg font-bold text-[#14211E]">{clienteSelecionado.nome}</p>
              <p className="text-sm text-slate-600">
                Saldo devedor:{' '}
                <strong className="font-mono-nums text-[#14211E]">
                  {formatCentavos(clienteSelecionado.saldoDevedor)}
                </strong>
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setClienteId('');
                setPixConfirmadoExtrato(false);
              }}
              className="min-h-[44px] rounded-xl border border-[#D4D4CE] px-3 text-sm font-semibold text-[#14211E] hover:bg-slate-50"
            >
              Trocar
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="valor-pag" className="block text-base font-semibold text-[#14211E]">
                Valor recebido (R$)
              </label>
              <button
                type="button"
                onClick={handleQuitarTudo}
                className="min-h-[40px] rounded-xl bg-teal-50 px-3 text-sm font-bold text-teal-800 hover:bg-teal-100"
              >
                Quitar tudo ({formatCentavos(clienteSelecionado.saldoDevedor)})
              </button>
            </div>
            <input
              id="valor-pag"
              type="text"
              inputMode="decimal"
              required
              autoFocus
              value={valorStr}
              onChange={(e) => {
                setErro(null);
                setValorStr(e.target.value);
              }}
              placeholder="0,00"
              className="mt-2 min-h-[56px] w-full rounded-xl border border-[#D4D4CE] px-4 font-mono-nums text-2xl font-bold text-[#14211E] focus:border-teal-700 focus:outline-none"
            />
          </div>

          <div>
            <p className="block text-base font-semibold text-[#14211E]">Forma de pagamento</p>
            <div className="mt-2 grid grid-cols-3 gap-2.5">
              {(
                [
                  { id: 'dinheiro', label: 'Dinheiro' },
                  { id: 'pix_manual', label: 'Pix (manual)' },
                  { id: 'debito', label: 'Débito' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setForma(opt.id);
                    setErro(null);
                    if (opt.id !== 'pix_manual') {
                      setPixConfirmadoExtrato(false);
                    }
                  }}
                  className={`min-h-[52px] rounded-xl border px-3 py-2 text-base font-semibold transition-colors ${
                    forma === opt.id
                      ? 'border-teal-700 bg-teal-50 text-teal-900'
                      : 'border-[#D4D4CE] bg-white text-[#14211E] hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {forma === 'pix_manual' && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
                <p className="text-sm text-amber-950">
                  Registro manual (sem baixa automática nem taxas). Confira seu aplicativo do banco antes de confirmar.
                </p>
                <label className="flex items-start gap-3 min-h-[44px] cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={pixConfirmadoExtrato}
                    onChange={(e) => {
                      setPixConfirmadoExtrato(e.target.checked);
                      setErro(null);
                    }}
                    className="mt-1 h-5 w-5 rounded border-amber-400 text-teal-700 focus:ring-teal-700"
                  />
                  <span className="text-base font-semibold text-[#14211E]">
                    Conferi no extrato bancário que o Pix caiu
                  </span>
                </label>
              </div>
            )}
          </div>

          {erro && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-base font-medium text-red-800" role="alert">
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={
              salvando ||
              valorCentavos <= 0 ||
              (forma === 'pix_manual' && !pixConfirmadoExtrato)
            }
            className="min-h-[56px] w-full rounded-2xl bg-teal-700 px-6 py-4 text-lg font-bold text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {salvando ? 'Registrando...' : 'Confirmar pagamento'}
          </button>
        </form>
      )}
    </div>
  );
};
