import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Delete, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  formatCentavos,
  formatWhatsAppDisplay,
  validarCompra,
} from '../lib/businessRules';
import { registrarCompra } from '../lib/firestoreService';
import { enqueueOfflineLancamento, generateIdempotencyKey } from '../lib/offlineQueue';
import { useOnlineStatus } from '../hooks/usePWAInstall';
import { PinModal } from '../components/PinModal';
import { ComprovanteCard, type ComprovanteDados } from '../components/ComprovanteCard';

export const NovaCompraPage: React.FC = () => {
  const { clientes, comercio, usuario, refreshOfflineQueueCount } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();

  const initialClientId = searchParams.get('clienteId') || '';
  const [clienteId, setClienteId] = useState(initialClientId);
  const [busca, setBusca] = useState('');
  const [centavosDigits, setCentavosDigits] = useState('');
  const [itens, setItens] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [concluido, setConcluido] = useState<ComprovanteDados | null>(null);

  const clientesAtivos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return clientes
      .filter((c) => c.ativo && !c.anonimizado)
      .filter((c) => {
        if (!q) return true;
        return c.nome.toLowerCase().includes(q) || c.whatsapp.includes(q);
      });
  }, [clientes, busca]);

  const clienteSelecionado = useMemo(
    () => clientes.find((c) => c.id === clienteId) || null,
    [clientes, clienteId]
  );

  const valorCentavos = Number.parseInt(centavosDigits || '0', 10);

  const validacao = useMemo(() => {
    if (!clienteSelecionado) return null;
    return validarCompra(
      clienteSelecionado.saldoDevedor,
      valorCentavos,
      clienteSelecionado.limiteCredito,
      false
    );
  }, [clienteSelecionado, valorCentavos]);

  const appendDigit = (d: string) => {
    setErro(null);
    setCentavosDigits((prev) => {
      const next = (prev + d).replace(/^0+/, '');
      if (next.length > 8) return prev;
      return next;
    });
  };

  const handleBackspace = () => {
    setErro(null);
    setCentavosDigits((prev) => prev.slice(0, -1));
  };

  const executarCompra = async (autorizadoExcecaoPor?: string) => {
    if (!comercio || !usuario || !clienteSelecionado) return;
    setErro(null);
    setSalvando(true);
    const idempotencyKey = generateIdempotencyKey('cmp');
    const agora = new Date();
    const itensLimpos = itens.trim();

    try {
      if (!isOnline) {
        enqueueOfflineLancamento({
          idempotencyKey,
          comercioId: comercio.id,
          clienteId: clienteSelecionado.id,
          clienteNome: clienteSelecionado.nome,
          tipo: 'compra',
          valor: valorCentavos,
          forma: 'fiado',
          itens: itensLimpos,
          autorizadoExcecaoPor: autorizadoExcecaoPor || '',
          enqueuedAt: agora.getTime(),
        });
        refreshOfflineQueueCount();
        setConcluido({
          tipo: 'compra',
          comercioNome: comercio.nome,
          clienteNome: clienteSelecionado.nome,
          clienteWhatsapp: clienteSelecionado.whatsapp,
          saldoAnterior: clienteSelecionado.saldoDevedor,
          valor: valorCentavos,
          novoSaldo: clienteSelecionado.saldoDevedor + valorCentavos,
          limiteCredito: clienteSelecionado.limiteCredito,
          formaLabel: 'Fiado',
          itens: itensLimpos || undefined,
          dataHora: agora,
          lancamentoId: idempotencyKey,
          registradoPorNome: usuario.nome,
          offline: true,
        });
        return;
      }

      const res = await registrarCompra({
        comercioId: comercio.id,
        comercioNome: comercio.nome,
        clienteId: clienteSelecionado.id,
        valorCentavos,
        itens: itensLimpos,
        autorizadoExcecaoPor,
        uid: usuario.uid,
        idempotencyKey,
      });

      setConcluido({
        tipo: 'compra',
        comercioNome: comercio.nome,
        clienteNome: clienteSelecionado.nome,
        clienteWhatsapp: clienteSelecionado.whatsapp,
        saldoAnterior: res.saldoAnterior,
        valor: valorCentavos,
        novoSaldo: res.novoSaldo,
        limiteCredito: res.limiteCredito,
        formaLabel: 'Fiado',
        itens: itensLimpos || undefined,
        dataHora: agora,
        lancamentoId: res.lancamentoId,
        registradoPorNome: usuario.nome,
        offline: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao registrar compra.';
      if (msg.includes('offline') || msg.includes('network')) {
        enqueueOfflineLancamento({
          idempotencyKey,
          comercioId: comercio.id,
          clienteId: clienteSelecionado.id,
          clienteNome: clienteSelecionado.nome,
          tipo: 'compra',
          valor: valorCentavos,
          forma: 'fiado',
          itens: itensLimpos,
          autorizadoExcecaoPor: autorizadoExcecaoPor || '',
          enqueuedAt: agora.getTime(),
        });
        refreshOfflineQueueCount();
        setConcluido({
          tipo: 'compra',
          comercioNome: comercio.nome,
          clienteNome: clienteSelecionado.nome,
          clienteWhatsapp: clienteSelecionado.whatsapp,
          saldoAnterior: clienteSelecionado.saldoDevedor,
          valor: valorCentavos,
          novoSaldo: clienteSelecionado.saldoDevedor + valorCentavos,
          limiteCredito: clienteSelecionado.limiteCredito,
          formaLabel: 'Fiado',
          itens: itensLimpos || undefined,
          dataHora: agora,
          lancamentoId: idempotencyKey,
          registradoPorNome: usuario.nome,
          offline: true,
        });
      } else {
        if (msg.includes('Missing or insufficient permissions') || msg.includes('PERMISSION_DENIED')) {
          setErro(
            'Sem permissão no Firestore para gravar este lançamento. Confira se as regras completas de firestore.rules estão publicadas no Firebase Console.'
          );
        } else if (msg.startsWith('{')) {
          try {
            const parsed = JSON.parse(msg);
            setErro(String(parsed?.error || 'Erro ao registrar compra.'));
          } catch {
            setErro(msg);
          }
        } else {
          setErro(msg);
        }
      }
    } finally {
      setSalvando(false);
    }
  };

  const handleConfirmar = async () => {
    if (!clienteSelecionado || valorCentavos <= 0) {
      setErro('Informe um valor maior que R$ 0,00.');
      return;
    }
    const check = validarCompra(
      clienteSelecionado.saldoDevedor,
      valorCentavos,
      clienteSelecionado.limiteCredito,
      false
    );
    if (!check.permitida && check.exigePinDono) {
      setPinModalOpen(true);
      return;
    }
    await executarCompra();
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
                setCentavosDigits('');
                setItens('');
                setClienteId('');
              }}
              className="flex min-h-[52px] w-full items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800"
            >
              Anotar outra compra
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
          <h1 className="text-2xl font-bold text-[#14211E]">Nova compra fiado</h1>
          <p className="text-sm text-slate-600">
            {!clienteSelecionado ? 'Toque 1: escolha o cliente' : 'Toque 2 e 3: valor e confirmar'}
          </p>
        </div>
      </div>

      {/* Passo 1: Escolher cliente */}
      {!clienteSelecionado ? (
        <div className="rounded-2xl border border-[#E4E4DF] bg-white p-4 sm:p-6">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente..."
              className="min-h-[48px] w-full rounded-xl border border-[#D4D4CE] bg-[#FAFAF8] pl-11 pr-4 text-base text-[#14211E] focus:border-teal-700 focus:bg-white focus:outline-none"
            />
          </div>

          {clientesAtivos.length === 0 ? (
            <div className="mt-6 text-center py-6">
              <p className="text-base text-slate-600">Nenhum cliente ativo encontrado.</p>
              <Link
                to="/clientes/novo"
                className="mt-3 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white"
              >
                Cadastrar cliente
              </Link>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-[#ECECE7]">
              {clientesAtivos.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setClienteId(c.id)}
                    className="flex min-h-[64px] w-full items-center justify-between gap-4 py-3 px-2 text-left hover:bg-[#FAFAF8] rounded-xl transition-colors"
                  >
                    <div>
                      <p className="text-base font-bold text-[#14211E]">{c.nome}</p>
                      <p className="text-sm text-slate-600">
                        {formatWhatsAppDisplay(c.whatsapp)} · Disponível{' '}
                        <span className="font-mono-nums">
                          {formatCentavos(Math.max(0, c.limiteCredito - c.saldoDevedor))}
                        </span>
                      </p>
                    </div>
                    <span className="font-mono-nums text-base font-bold text-[#14211E] shrink-0">
                      {formatCentavos(c.saldoDevedor)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        /* Passo 2 e 3: Valor no teclado numérico + Confirmar */
        <div className="rounded-2xl border border-[#E4E4DF] bg-white p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-3 border-b border-[#ECECE7] pb-4">
            <div>
              <p className="text-sm text-slate-600">Cliente selecionado</p>
              <p className="text-lg font-bold text-[#14211E]">{clienteSelecionado.nome}</p>
            </div>
            <button
              type="button"
              onClick={() => setClienteId('')}
              className="min-h-[44px] rounded-xl border border-[#D4D4CE] px-3 text-sm font-semibold text-[#14211E] hover:bg-slate-50"
            >
              Trocar
            </button>
          </div>

          {/* Visor de valor grande */}
          <div className="rounded-2xl bg-[#F3F4F1] p-5 text-center">
            <p className="text-sm font-medium text-slate-600">Valor da compra</p>
            <p className="mt-1 font-mono-nums text-4xl font-extrabold text-[#14211E]">
              {formatCentavos(valorCentavos)}
            </p>
            {validacao && valorCentavos > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm">
                <span>
                  Novo saldo:{' '}
                  <strong className="font-mono-nums">{formatCentavos(validacao.novoSaldo)}</strong>
                </span>
                <span aria-hidden="true">·</span>
                {validacao.exigePinDono ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
                    <AlertTriangle className="h-4 w-4" />
                    Acima do limite (pede PIN do Dono)
                  </span>
                ) : (
                  <span className="font-semibold text-teal-800">Dentro do limite</span>
                )}
              </div>
            )}
          </div>

          {/* Atalhos rápidos + Teclado numérico tátil */}
          <div className="grid grid-cols-4 gap-2">
            {[500, 1000, 2000, 5000].map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => setCentavosDigits(String(valorCentavos + val))}
                className="min-h-[44px] rounded-xl border border-[#D4D4CE] bg-white font-mono-nums text-sm font-bold text-[#14211E] hover:bg-slate-50"
              >
                +{formatCentavos(val)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0'].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => appendDigit(key)}
                className="min-h-[56px] rounded-xl border border-[#E4E4DF] bg-[#FAFAF8] font-mono-nums text-2xl font-bold text-[#14211E] hover:bg-slate-100 active:scale-[0.98] transition-transform"
              >
                {key}
              </button>
            ))}
            <button
              type="button"
              onClick={handleBackspace}
              aria-label="Apagar último dígito"
              className="min-h-[56px] flex items-center justify-center rounded-xl border border-[#E4E4DF] bg-[#FAFAF8] text-[#14211E] hover:bg-slate-100 active:scale-[0.98]"
            >
              <Delete className="h-6 w-6" />
            </button>
          </div>

          <div>
            <label htmlFor="itens-compra" className="block text-sm font-semibold text-slate-700">
              O que comprou? (opcional)
            </label>
            <input
              id="itens-compra"
              type="text"
              maxLength={240}
              value={itens}
              onChange={(e) => setItens(e.target.value)}
              placeholder="Ex: Pão, café e leite"
              className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
            />
          </div>

          {erro && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-base font-medium text-red-800" role="alert">
              {erro}
            </p>
          )}

          <button
            type="button"
            disabled={salvando || valorCentavos <= 0}
            onClick={handleConfirmar}
            className="min-h-[56px] w-full rounded-2xl bg-teal-700 px-6 py-4 text-lg font-bold text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {salvando
              ? 'Registrando...'
              : validacao?.exigePinDono
              ? 'Liberar com PIN do Dono'
              : 'Confirmar compra'}
          </button>
        </div>
      )}

      {comercio && clienteSelecionado && (
        <PinModal
          open={pinModalOpen}
          comercio={comercio}
          clienteNome={clienteSelecionado.nome}
          valorCompraCentavos={valorCentavos}
          novoSaldoCentavos={clienteSelecionado.saldoDevedor + valorCentavos}
          limiteCreditoCentavos={clienteSelecionado.limiteCredito}
          onAuthorized={(donoUid) => {
            setPinModalOpen(false);
            void executarCompra(donoUid);
          }}
          onClose={() => setPinModalOpen(false)}
        />
      )}
    </div>
  );
};
