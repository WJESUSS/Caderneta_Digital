import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ChevronRight, Search, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatCentavos, formatDateBR, formatWhatsAppDisplay } from '../lib/businessRules';

type Filtro = 'todos' | 'devedores' | 'vencidos' | 'quitados';

export const ClientesPage: React.FC = () => {
  const { clientes } = useAuth();
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return clientes
      .filter((c) => !c.anonimizado)
      .filter((c) => {
        if (filtro === 'devedores') return c.saldoDevedor > 0;
        if (filtro === 'vencidos') return c.valorVencido > 0;
        if (filtro === 'quitados') return c.saldoDevedor === 0;
        return true;
      })
      .filter((c) => {
        if (!q) return true;
        return (
          c.nome.toLowerCase().includes(q) ||
          c.whatsapp.toLowerCase().includes(q) ||
          formatWhatsAppDisplay(c.whatsapp).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [clientes, busca, filtro]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-[#14211E]">Clientes</h1>
        <Link
          to="/clientes/novo"
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800"
        >
          <UserPlus className="h-5 w-5" />
          <span>Cadastrar cliente</span>
        </Link>
      </div>

      <div className="rounded-2xl border border-[#E4E4DF] bg-white p-4 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center justify-between">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              className="min-h-[48px] w-full rounded-xl border border-[#D4D4CE] bg-[#FAFAF8] pl-11 pr-4 text-base text-[#14211E] focus:border-teal-700 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-xl bg-[#F3F4F1] p-1 overflow-x-auto">
            {(
              [
                { id: 'todos', label: 'Todos' },
                { id: 'devedores', label: 'Com saldo' },
                { id: 'vencidos', label: 'Vencidos' },
                { id: 'quitados', label: 'Quitados' },
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

        {lista.length === 0 ? (
          <p className="py-8 text-center text-base text-slate-600">
            Nenhum cliente encontrado neste filtro.
          </p>
        ) : (
          <ul className="divide-y divide-[#ECECE7]">
            {lista.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/clientes/${c.id}`}
                  className="flex min-h-[68px] items-center justify-between gap-4 py-3.5 px-2 hover:bg-[#FAFAF8] rounded-xl"
                >
                  <div className="min-w-0">
                    <p className="text-base font-bold text-[#14211E] truncate">
                      {c.nome}
                      {!c.ativo && (
                        <span className="ml-2 text-sm font-normal text-slate-500">(Inativo)</span>
                      )}
                    </p>
                    <p className="text-sm text-slate-600 flex flex-wrap items-center gap-2">
                      <span>{formatWhatsAppDisplay(c.whatsapp)}</span>
                      <span aria-hidden="true">·</span>
                      <span>Venc. dia {c.diaVencimento}</span>
                      {c.valorVencido > 0 ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                            <AlertCircle className="h-4 w-4" />
                            Vencido {formatCentavos(c.valorVencido)}
                          </span>
                        </>
                      ) : c.proximoVencimento ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Próx. {formatDateBR(c.proximoVencimento)}</span>
                        </>
                      ) : null}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono-nums text-lg font-bold text-[#14211E]">
                      {formatCentavos(c.saldoDevedor)}
                    </span>
                    <ChevronRight className="h-5 w-5 text-slate-400" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
