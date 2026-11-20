import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { BookOpen, Lock, ShieldCheck } from 'lucide-react';
import {
  formatCentavos,
  formatDateBR,
  type ResumoPublicoCliente,
} from '../lib/businessRules';
import { consultarSaldoPublicoPorToken } from '../lib/firestoreService';

export const PublicConsultaPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const [digitos, setDigitos] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const [resumo, setResumo] = useState<ResumoPublicoCliente | null>(null);

  const handleConsultar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (!/^\d{4}$/.test(digitos)) {
      setErro('Digite os 4 últimos dígitos do seu WhatsApp.');
      return;
    }
    setCarregando(true);
    try {
      const resp = await consultarSaldoPublicoPorToken(token, digitos);
      if (resp.status === 'ok') {
        setResumo(resp.resumo);
      } else if (resp.status === 'invalido_digitos') {
        setErro(
          `Dígitos não conferem. Você ainda tem ${resp.tentativasRestantes} tentativa(s).`
        );
      } else if (resp.status === 'bloqueado') {
        setIndisponivel(true);
        setErro('Muitas tentativas incorretas. Este link foi bloqueado temporariamente por segurança.');
      } else {
        setIndisponivel(true);
        setErro('Este link de consulta não está mais disponível ou expirou. Peça um novo link ao comércio.');
      }
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAF8] px-4 py-8">
      <div className="mx-auto w-full max-w-lg">
        <div className="flex items-center justify-center gap-2.5 text-teal-800 mb-6">
          <BookOpen className="h-6 w-6" />
          <span className="text-lg font-bold text-[#14211E]">Caderneta Digital</span>
        </div>

        {!resumo ? (
          <div className="rounded-2xl border border-[#E4E4DF] bg-white p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-800">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#14211E]">Consulta de saldo</h1>
                <p className="text-sm text-slate-600">Acesso exclusivo somente leitura</p>
              </div>
            </div>

            {indisponivel ? (
              <div className="mt-6 rounded-xl bg-slate-100 p-5 text-base text-slate-700" role="alert">
                {erro}
              </div>
            ) : (
              <form onSubmit={handleConsultar} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="digitos-wpp" className="block text-base font-semibold text-[#14211E]">
                    Digite os 4 últimos dígitos do seu WhatsApp
                  </label>
                  <p className="mt-1 text-sm text-slate-600">
                    Confirmação simples para proteger seus dados.
                  </p>
                  <input
                    id="digitos-wpp"
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    autoFocus
                    value={digitos}
                    onChange={(e) => setDigitos(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="0000"
                    className="mt-3 min-h-[54px] w-full rounded-xl border border-[#D4D4CE] px-4 text-center font-mono-nums text-2xl tracking-[0.5em] text-[#14211E] focus:border-teal-700 focus:outline-none"
                  />
                </div>

                {erro && (
                  <p className="rounded-xl bg-red-50 px-4 py-3 text-base text-red-800" role="alert">
                    {erro}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={carregando || digitos.length !== 4}
                  className="min-h-[52px] w-full rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {carregando ? 'Verificando...' : 'Ver meu saldo'}
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-2xl border border-[#E4E4DF] bg-white p-6">
              <div className="flex items-center gap-2 text-sm text-teal-800 font-semibold">
                <ShieldCheck className="h-4 w-4" />
                <span>{resumo.comercioNome}</span>
              </div>
              <h1 className="mt-1 text-2xl font-bold text-[#14211E]">
                Olá, {resumo.primeiroNome}
              </h1>

              <div className="mt-5 grid grid-cols-1 gap-4 border-t border-[#ECECE7] pt-5">
                <div>
                  <p className="text-sm text-slate-600">Saldo total em aberto</p>
                  <p className="font-mono-nums text-3xl font-bold text-[#14211E]">
                    {formatCentavos(resumo.saldoDevedor)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-slate-600">Valor vencido</p>
                    <p
                      className={`font-mono-nums text-xl font-bold ${
                        resumo.valorVencido > 0 ? 'text-red-700' : 'text-[#14211E]'
                      }`}
                    >
                      {formatCentavos(resumo.valorVencido)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">A vencer</p>
                    <p className="font-mono-nums text-xl font-bold text-[#14211E]">
                      {formatCentavos(resumo.valorAVencer)}
                    </p>
                  </div>
                </div>

                {resumo.proximoVencimento && (
                  <p className="text-base text-slate-700">
                    Próximo vencimento:{' '}
                    <strong className="font-mono-nums">
                      {formatDateBR(resumo.proximoVencimento)}
                    </strong>
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[#E4E4DF] bg-white p-6">
              <h2 className="text-lg font-bold text-[#14211E]">Últimos lançamentos</h2>

              {resumo.lancamentos.length === 0 ? (
                <p className="mt-3 text-base text-slate-600">Nenhum lançamento registrado ainda.</p>
              ) : (
                <ul className="mt-4 divide-y divide-[#ECECE7]">
                  {resumo.lancamentos.map((l) => (
                    <li key={l.id} className="py-3.5 flex items-start justify-between gap-4">
                      <div>
                        <p
                          className={`text-base font-semibold ${
                            l.estornado ? 'line-through text-slate-400' : 'text-[#14211E]'
                          }`}
                        >
                          {l.tipo === 'compra'
                            ? 'Compra fiado'
                            : l.tipo === 'pagamento'
                            ? 'Pagamento'
                            : 'Estorno'}
                        </p>
                        <p className="text-sm text-slate-600">
                          {new Date(l.criadoEmIso).toLocaleDateString('pt-BR')}
                          {l.itens ? ` · ${l.itens}` : ''}
                          {l.vencimento ? ` · Venc. ${formatDateBR(l.vencimento)}` : ''}
                          {l.estornado ? ' · Estornado' : ''}
                        </p>
                      </div>
                      <p
                        className={`font-mono-nums text-base font-bold shrink-0 ${
                          l.estornado
                            ? 'line-through text-slate-400'
                            : l.tipo === 'pagamento'
                            ? 'text-teal-700'
                            : 'text-[#14211E]'
                        }`}
                      >
                        {l.tipo === 'pagamento' ? '− ' : ''}
                        {formatCentavos(l.valor)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
