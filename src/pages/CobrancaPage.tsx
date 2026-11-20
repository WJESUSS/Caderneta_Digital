import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, MessageCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  buildWhatsAppUrl,
  formatCentavos,
  formatDateBR,
  formatWhatsAppDisplay,
} from '../lib/businessRules';

export const CobrancaPage: React.FC = () => {
  const { clientes, comercio } = useAuth();

  const vencidos = useMemo(
    () =>
      clientes
        .filter((c) => !c.anonimizado && c.ativo && c.valorVencido > 0)
        .sort((a, b) => b.valorVencido - a.valorVencido),
    [clientes]
  );

  const totalVencido = useMemo(
    () => vencidos.reduce((acc, c) => acc + c.valorVencido, 0),
    [vencidos]
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#E4E4DF] bg-white p-5 sm:p-6">
        <h1 className="text-2xl font-bold text-[#14211E]">Cobrança manual</h1>
        <p className="mt-1 text-base text-slate-600">
          Clientes com compras vencidas. O envio pelo WhatsApp abre a conversa direta com o cliente, com mensagem cordial e sem expor dados a terceiros.
        </p>

        <div className="mt-4 flex flex-wrap items-baseline gap-4 border-t border-[#ECECE7] pt-4">
          <div>
            <span className="text-sm text-slate-600">Total vencido a cobrar: </span>
            <strong className="font-mono-nums text-2xl font-bold text-red-700">
              {formatCentavos(totalVencido)}
            </strong>
          </div>
          <span className="text-sm text-slate-600">
            {vencidos.length} cliente(s) em atraso
          </span>
        </div>
      </div>

      {vencidos.length === 0 ? (
        <div className="rounded-2xl border border-[#E4E4DF] bg-white p-8 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-teal-700" />
          <h2 className="mt-3 text-lg font-bold text-[#14211E]">Nenhuma conta vencida</h2>
          <p className="mt-1 text-base text-slate-600">
            Todos os clientes estão em dia com seus vencimentos.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {vencidos.map((c) => {
            const primeiroNome = c.nome.trim().split(/\s+/)[0] || c.nome;
            const mensagem = `Olá, ${primeiroNome}! Tudo bem? Aqui é de ${
              comercio?.nome || 'nosso comércio'
            }. Passando apenas para lembrar com carinho da sua caderneta, que tem um valor vencido de ${formatCentavos(
              c.valorVencido
            )} (saldo total ${formatCentavos(
              c.saldoDevedor
            )}). Quando puder passar por aqui ou fazer um Pix, nos avise. Obrigado!`;

            return (
              <li
                key={c.id}
                className="rounded-2xl border border-[#E4E4DF] bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div>
                  <Link
                    to={`/clientes/${c.id}`}
                    className="text-lg font-bold text-[#14211E] hover:text-teal-800 hover:underline"
                  >
                    {c.nome}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <span>{formatWhatsAppDisplay(c.whatsapp)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                      <AlertCircle className="h-4 w-4" />
                      Vencido: {formatCentavos(c.valorVencido)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Saldo total: {formatCentavos(c.saldoDevedor)}</span>
                    {c.proximoVencimento && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Desde {formatDateBR(c.proximoVencimento)}</span>
                      </>
                    )}
                  </div>
                </div>

                <a
                  href={buildWhatsAppUrl(c.whatsapp, mensagem)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#15803D] px-5 py-3 text-base font-semibold text-white hover:bg-[#166534] shrink-0"
                >
                  <MessageCircle className="h-5 w-5" />
                  <span>Cobrar por WhatsApp</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
