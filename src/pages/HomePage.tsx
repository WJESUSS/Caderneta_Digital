import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDownLeft,
  ChevronRight,
  Plus,
  QrCode,
  Search,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  estaPertoDoLimite,
  formatCentavos,
  formatDateBR,
  formatWhatsAppDisplay,
} from '../lib/businessRules';
import { carregarDadosExemplo } from '../lib/firestoreService';

export const HomePage: React.FC = () => {
  const { clientes, usuario, comercio, loadingComercio } = useAuth();
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');
  const [carregandoDemo, setCarregandoDemo] = useState(false);
  const [erroDemo, setErroDemo] = useState<string | null>(null);

  const isDono = usuario?.perfil === 'dono';

  const totais = useMemo(() => {
    let totalReceber = 0;
    let totalVencido = 0;
    let qtdVencidos = 0;
    for (const c of clientes) {
      if (!c.anonimizado) {
        totalReceber += c.saldoDevedor;
        totalVencido += c.valorVencido;
        if (c.valorVencido > 0) qtdVencidos += 1;
      }
    }
    return { totalReceber, totalVencido, qtdVencidos };
  }, [clientes]);

  const clientesFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return clientes
      .filter((c) => !c.anonimizado && c.ativo)
      .filter((c) => {
        if (!q) return true;
        return (
          c.nome.toLowerCase().includes(q) ||
          c.whatsapp.toLowerCase().includes(q) ||
          formatWhatsAppDisplay(c.whatsapp).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (b.valorVencido !== a.valorVencido) return b.valorVencido - a.valorVencido;
        return b.saldoDevedor - a.saldoDevedor;
      });
  }, [clientes, busca]);

  const handleCarregarExemplo = async () => {
    if (!comercio || !usuario) return;
    setErroDemo(null);
    setCarregandoDemo(true);
    try {
      await carregarDadosExemplo({ comercioId: comercio.id, uid: usuario.uid });
    } catch (err) {
      setErroDemo(err instanceof Error ? err.message : 'Não foi possível gerar os dados de exemplo.');
    } finally {
      setCarregandoDemo(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Ações principais em destaque (Mobile & Desktop) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-[#E4E4DF] bg-white p-5">
            <p className="text-sm font-medium text-slate-600">Total a receber</p>
            <p className="mt-1 font-mono-nums text-3xl font-bold text-[#14211E]">
              {formatCentavos(totais.totalReceber)}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {clientes.filter((c) => !c.anonimizado && c.saldoDevedor > 0).length} cliente(s) com saldo em aberto
            </p>
          </div>

          <div className="rounded-2xl border border-[#E4E4DF] bg-white p-5">
            <p className="text-sm font-medium text-slate-600">Total vencido</p>
            <p
              className={`mt-1 font-mono-nums text-3xl font-bold ${
                totais.totalVencido > 0 ? 'text-red-700' : 'text-[#14211E]'
              }`}
            >
              {formatCentavos(totais.totalVencido)}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {totais.qtdVencidos > 0
                ? `${totais.qtdVencidos} cliente(s) em atraso`
                : 'Nenhuma conta vencida hoje'}
            </p>
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => navigate('/nova-compra')}
            className="flex min-h-[64px] w-full items-center justify-center gap-3 rounded-2xl bg-teal-700 px-6 py-4 text-xl font-bold text-white hover:bg-teal-800 active:scale-[0.99] transition-all"
          >
            <Plus className="h-7 w-7" />
            <span>+ Nova compra</span>
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => navigate('/receber-pagamento')}
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-4 py-3 text-base font-semibold text-[#14211E] hover:bg-slate-50 transition-colors"
            >
              <ArrowDownLeft className="h-5 w-5 text-teal-700" />
              <span>Receber pagamento</span>
            </button>

            <Link
              to="/qr"
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-4 py-3 text-base font-semibold text-[#14211E] hover:bg-slate-50 transition-colors"
            >
              <QrCode className="h-5 w-5 text-teal-700" />
              <span>QR Code do app</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Busca e lista de clientes ordenada por maior valor vencido */}
      <section className="rounded-2xl border border-[#E4E4DF] bg-white p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h1 className="text-xl font-bold text-[#14211E]">Clientes por prioridade</h1>
          <Link
            to="/clientes/novo"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-4 py-2 text-base font-semibold text-[#14211E] hover:bg-slate-50"
          >
            <UserPlus className="h-5 w-5 text-teal-700" />
            <span>Novo cliente</span>
          </Link>
        </div>

        <div className="relative mt-4">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente por nome ou WhatsApp..."
            aria-label="Buscar cliente"
            className="min-h-[48px] w-full rounded-xl border border-[#D4D4CE] bg-[#FAFAF8] pl-11 pr-4 text-base text-[#14211E] focus:border-teal-700 focus:bg-white focus:outline-none"
          />
        </div>

        {loadingComercio ? (
          <div className="mt-5 space-y-3" aria-busy="true">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : clientes.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-[#D4D4CE] bg-[#FAFAF8] p-6 text-center">
            <h2 className="text-lg font-bold text-[#14211E]">Sua caderneta ainda está vazia</h2>
            <p className="mt-1 text-base text-slate-600">
              Cadastre seu primeiro cliente ou carregue dados fictícios para testar o aplicativo.
            </p>
            {erroDemo && (
              <p className="mt-3 text-base text-red-700" role="alert">
                {erroDemo}
              </p>
            )}
            <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/clientes/novo"
                className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800"
              >
                <UserPlus className="h-5 w-5" />
                <span>Cadastrar primeiro cliente</span>
              </Link>
              {isDono && (
                <button
                  type="button"
                  onClick={handleCarregarExemplo}
                  disabled={carregandoDemo}
                  className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-5 py-3 text-base font-semibold text-[#14211E] hover:bg-slate-50 disabled:opacity-50"
                >
                  <Sparkles className="h-5 w-5 text-amber-600" />
                  <span>{carregandoDemo ? 'Carregando...' : 'Carregar dados de exemplo'}</span>
                </button>
              )}
            </div>
          </div>
        ) : clientesFiltrados.length === 0 ? (
          <p className="mt-6 text-center text-base text-slate-600 py-6">
            Nenhum cliente encontrado para "{busca}".
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[#ECECE7]">
            {clientesFiltrados.map((cliente) => (
              <li key={cliente.id}>
                <Link
                  to={`/clientes/${cliente.id}`}
                  className="flex min-h-[68px] items-center justify-between gap-4 py-3.5 px-2 hover:bg-[#FAFAF8] rounded-xl transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-bold text-[#14211E] truncate">{cliente.nome}</p>
                      {estaPertoDoLimite(cliente.saldoDevedor, cliente.limiteCredito) && (
                        <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">
                          Perto do limite
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                      <span>{formatWhatsAppDisplay(cliente.whatsapp)}</span>
                      {cliente.valorVencido > 0 ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                            <AlertCircle className="h-4 w-4" aria-hidden="true" />
                            Vencido {formatCentavos(cliente.valorVencido)}
                          </span>
                        </>
                      ) : cliente.saldoDevedor === 0 ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-teal-800">Quitado</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Vence {formatDateBR(cliente.proximoVencimento)}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <p className="font-mono-nums text-lg font-bold text-[#14211E]">
                        {formatCentavos(cliente.saldoDevedor)}
                      </p>
                      <p className="text-xs text-slate-500">
                        Limite {formatCentavos(cliente.limiteCredito)}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-slate-400" aria-hidden="true" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
