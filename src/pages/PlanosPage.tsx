import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Copy, MessageCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  buildWhatsAppSuporteAssinaturaUrl,
  formatValidadePlanoBR,
  PLANOS_LISTA,
} from '../lib/planos';

export const PlanosPage: React.FC = () => {
  const { comercio, usuario, planoResolvido, usoPlano } = useAuth();
  const isDono = usuario?.perfil === 'dono';

  const whatsappSuporte = (import.meta.env.VITE_SUPORTE_WHATSAPP || '').trim();
  const pixSuporte = (import.meta.env.VITE_SUPORTE_PIX || '').trim();

  const [pixCopiado, setPixCopiado] = useState(false);
  const [idCopiado, setIdCopiado] = useState(false);

  const copiarTexto = async (texto: string, onDone: () => void) => {
    try {
      await navigator.clipboard.writeText(texto);
      onDone();
    } catch {
      // Silencioso caso navegador bloqueie clipboard sem foco
    }
  };

  const barraProgresso =
    usoPlano.limite !== null && usoPlano.limite > 0
      ? Math.min(100, Math.round((usoPlano.clientesAtivos / usoPlano.limite) * 100))
      : 0;

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/clientes"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[#E4E4DF] bg-white text-[#14211E] hover:bg-slate-50"
            aria-label="Voltar para clientes"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[#14211E]">Planos da Caderneta Digital</h1>
            <p className="text-sm text-slate-600">
              Acompanhe o uso de clientes ativos e escolha o plano ideal para o seu comércio.
            </p>
          </div>
        </div>
      </div>

      {/* Aviso exclusivo para Atendente */}
      {!isDono && (
        <div
          role="status"
          className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-base font-semibold text-amber-950"
        >
          Fale com o Dono para mudar de plano
        </div>
      )}

      {/* Resumo de uso atual */}
      <section className="rounded-2xl border border-[#E4E4DF] bg-white p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-600">Plano vigente</p>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h2 className="text-xl font-bold text-[#14211E]">{planoResolvido.plano.nome}</h2>
              <span className="font-mono-nums text-base font-semibold text-teal-800">
                {planoResolvido.plano.precoFormatado}
              </span>
            </div>
          </div>

          <div className="sm:text-right space-y-1">
            <p className="text-sm font-medium text-slate-600">Clientes ativos</p>
            <p className="font-mono-nums text-xl font-bold text-[#14211E]">{usoPlano.textoUso}</p>
          </div>
        </div>

        {usoPlano.limite !== null && (
          <div className="space-y-1.5">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#ECECE7]">
              <div
                className={`h-full transition-all ${
                  usoPlano.noLimite
                    ? 'bg-red-600'
                    : usoPlano.pertoDoLimite
                    ? 'bg-amber-600'
                    : 'bg-teal-700'
                }`}
                style={{ width: `${barraProgresso}%` }}
              />
            </div>
            <p className="text-xs text-slate-600">
              Conta apenas clientes ativos e não anonimizados.
            </p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-[#ECECE7] pt-3 text-sm text-slate-700">
          {planoResolvido.assinaturaAtiva && planoResolvido.validoAte ? (
            <p>
              Validade da assinatura:{' '}
              <strong className="font-mono-nums text-[#14211E]">
                {formatValidadePlanoBR(planoResolvido.validoAte)}
              </strong>
            </p>
          ) : planoResolvido.expirada && planoResolvido.validoAte ? (
            <p className="font-medium text-amber-900">
              Sua assinatura venceu em{' '}
              <span className="font-mono-nums">{formatValidadePlanoBR(planoResolvido.validoAte)}</span>.
              O comércio voltou automaticamente para o plano Grátis.
            </p>
          ) : (
            <p>Validade: plano gratuito sem prazo de vencimento.</p>
          )}

          {comercio && (
            <p className="font-mono-nums text-xs text-slate-500">ID: {comercio.id}</p>
          )}
        </div>

        {usoPlano.noLimite && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Você atingiu o limite para novos cadastros e reativações. Todos os clientes já cadastrados continuam operando normalmente (compras, pagamentos, cobrança, QR Code e consulta pública).
          </p>
        )}
      </section>

      {/* Cards dos 3 planos */}
      <section aria-label="Planos disponíveis" className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {PLANOS_LISTA.map((plano) => {
          const ehAtual = planoResolvido.planoId === plano.id;
          const waUrl =
            isDono && comercio && whatsappSuporte && plano.id !== 'gratis'
              ? buildWhatsAppSuporteAssinaturaUrl({
                  whatsappSuporte,
                  comercioNome: comercio.nome,
                  comercioId: comercio.id,
                  plano,
                })
              : null;

          return (
            <div
              key={plano.id}
              className={`flex flex-col justify-between rounded-2xl bg-white p-5 sm:p-6 ${
                ehAtual
                  ? 'border-2 border-teal-700'
                  : 'border border-[#E4E4DF]'
              }`}
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-xl font-bold text-[#14211E]">{plano.nome}</h3>
                    <p className="mt-0.5 text-sm text-slate-600">{plano.subtitulo}</p>
                  </div>
                  {ehAtual && (
                    <span className="rounded-lg border border-teal-700 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-900 whitespace-nowrap shrink-0">
                      Plano atual
                    </span>
                  )}
                </div>

                <div className="border-y border-[#ECECE7] py-3">
                  <p className="font-mono-nums text-2xl font-bold text-[#14211E]">
                    {plano.precoFormatado}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-teal-800">
                    {plano.descricaoLimite}
                  </p>
                </div>

                <ul className="space-y-2.5 text-sm text-slate-700">
                  {plano.recursos.map((rec) => (
                    <li key={rec} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-6 pt-2">
                {plano.id === 'gratis' ? (
                  <p className="min-h-[44px] flex items-center justify-center rounded-xl border border-[#ECECE7] bg-[#FAFAF8] px-4 text-sm font-medium text-slate-600">
                    {ehAtual ? 'Plano ativo atualmente' : 'Plano inicial gratuito'}
                  </p>
                ) : isDono ? (
                  waUrl ? (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-semibold transition-colors ${
                        ehAtual
                          ? 'border border-teal-700 bg-white text-teal-800 hover:bg-teal-50'
                          : 'bg-teal-700 text-white hover:bg-teal-800'
                      }`}
                    >
                      <MessageCircle className="h-5 w-5 shrink-0" />
                      <span>{ehAtual ? 'Renovar via WhatsApp' : 'Assinar'}</span>
                    </a>
                  ) : (
                    <div className="space-y-1.5">
                      <button
                        type="button"
                        disabled
                        className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-slate-100 px-4 py-3 text-base font-semibold text-slate-500 cursor-not-allowed"
                      >
                        <MessageCircle className="h-5 w-5 shrink-0" />
                        <span>Assinar</span>
                      </button>
                      <p className="text-xs text-slate-500 text-center">
                        Configure VITE_SUPORTE_WHATSAPP para habilitar o envio direto.
                      </p>
                    </div>
                  )
                ) : (
                  <p className="min-h-[44px] flex items-center justify-center rounded-xl border border-[#ECECE7] bg-[#FAFAF8] px-3 text-center text-xs font-medium text-slate-600">
                    Fale com o Dono para mudar de plano
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {/* Pix de assinatura da plataforma (visível apenas para o Dono, separado do Pix do comércio) */}
      {isDono && (
        <section className="rounded-2xl border border-[#E4E4DF] bg-white p-5 sm:p-6 space-y-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
            <div>
              <h2 className="text-lg font-bold text-[#14211E]">
                Chave Pix da assinatura (suporte da plataforma)
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Use esta chave apenas para pagar a mensalidade do seu plano do Caderneta Digital. Ela não altera nem substitui a chave Pix do seu comércio configurada para seus clientes.
              </p>
            </div>
          </div>

          {pixSuporte ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[#E4E4DF] bg-[#FAFAF8] p-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">Chave Pix do suporte</p>
                <p className="mt-0.5 font-mono-nums text-base font-bold text-[#14211E] break-all">
                  {pixSuporte}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  copiarTexto(pixSuporte, () => {
                    setPixCopiado(true);
                    setTimeout(() => setPixCopiado(false), 2500);
                  })
                }
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-4 py-2 text-sm font-semibold text-[#14211E] hover:bg-slate-50 shrink-0"
              >
                {pixCopiado ? (
                  <>
                    <Check className="h-4 w-4 text-teal-700" />
                    <span>Chave copiada</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 text-teal-700" />
                    <span>Copiar chave Pix</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <p className="rounded-xl border border-[#ECECE7] bg-[#FAFAF8] p-4 text-sm text-slate-600">
              Chave Pix do suporte ainda não configurada (variável VITE_SUPORTE_PIX). Clique em &ldquo;Assinar&rdquo; no plano desejado para solicitar os dados pelo WhatsApp.
            </p>
          )}

          {comercio && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-[#ECECE7] pt-3 text-sm text-slate-600">
              <p>
                Após realizar o pagamento, envie o comprovante no WhatsApp informando o ID do seu comércio:{' '}
                <strong className="font-mono-nums text-[#14211E]">{comercio.id}</strong>
              </p>
              <button
                type="button"
                onClick={() =>
                  copiarTexto(comercio.id, () => {
                    setIdCopiado(true);
                    setTimeout(() => setIdCopiado(false), 2500);
                  })
                }
                className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-[#D4D4CE] bg-white px-3 py-1.5 text-xs font-semibold text-[#14211E] hover:bg-slate-50 shrink-0"
              >
                {idCopiado ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-teal-700" />
                    <span>ID copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-teal-700" />
                    <span>Copiar ID</span>
                  </>
                )}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
