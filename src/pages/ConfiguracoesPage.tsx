import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Download, QrCode, ShieldAlert, Sparkles, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { parseBRLToCentavos, type Usuario } from '../lib/businessRules';
import {
  alternarAtendenteAtivo,
  anonimizarClienteLGPD,
  carregarDadosExemplo,
  criarAtendente,
  exportarDadosComercio,
  observarUsuariosComercio,
  salvarConfigComercio,
} from '../lib/firestoreService';
import { PWAInstallButton } from '../components/PWAInstallBanner';

export const ConfiguracoesPage: React.FC = () => {
  const { usuario, comercio, clientes } = useAuth();
  const [nomeComercio, setNomeComercio] = useState('');
  const [limiteStr, setLimiteStr] = useState('');
  const [novoPin, setNovoPin] = useState('');
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [msgConfig, setMsgConfig] = useState<string | null>(null);
  const [erroConfig, setErroConfig] = useState<string | null>(null);

  const [equipe, setEquipe] = useState<Usuario[]>([]);
  const [attNome, setAttNome] = useState('');
  const [attEmail, setAttEmail] = useState('');
  const [attSenha, setAttSenha] = useState('');
  const [criandoAtt, setCriandoAtt] = useState(false);
  const [msgAtt, setMsgAtt] = useState<string | null>(null);
  const [erroAtt, setErroAtt] = useState<string | null>(null);

  const [clienteAnonId, setClienteAnonId] = useState('');
  const [confirmandoAnon, setConfirmandoAnon] = useState(false);
  const [msgLgpd, setMsgLgpd] = useState<string | null>(null);
  const [carregandoDemo, setCarregandoDemo] = useState(false);

  useEffect(() => {
    if (comercio) {
      setNomeComercio(comercio.nome);
      setLimiteStr((comercio.limitePadrao / 100).toFixed(2).replace('.', ','));
    }
  }, [comercio]);

  useEffect(() => {
    if (!comercio || usuario?.perfil !== 'dono') return;
    return observarUsuariosComercio(comercio.id, setEquipe);
  }, [comercio, usuario]);

  // RN06: Somente Dono acessa Configurações
  if (usuario && usuario.perfil !== 'dono') {
    return <Navigate to="/" replace />;
  }

  if (!comercio || !usuario) return null;

  const handleSalvarConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsgConfig(null);
    setErroConfig(null);
    if (novoPin && !/^\d{4}$/.test(novoPin)) {
      setErroConfig('O PIN deve conter exatamente 4 dígitos numéricos.');
      return;
    }
    setSalvandoConfig(true);
    try {
      await salvarConfigComercio({
        comercioId: comercio.id,
        nome: nomeComercio,
        limitePadraoCentavos: parseBRLToCentavos(limiteStr),
        novoPin4: novoPin || undefined,
        uid: usuario.uid,
      });
      setNovoPin('');
      setMsgConfig('Configurações salvas com sucesso.');
    } catch (err) {
      setErroConfig(err instanceof Error ? err.message : 'Erro ao salvar configurações.');
    } finally {
      setSalvandoConfig(false);
    }
  };

  const handleCriarAtendente = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsgAtt(null);
    setErroAtt(null);

    const emailClean = attEmail.trim().toLowerCase();
    if (equipe.some((m) => m.email.toLowerCase() === emailClean)) {
      setErroAtt('Este e-mail já faz parte da equipe deste comércio.');
      return;
    }

    setCriandoAtt(true);
    try {
      await criarAtendente({
        comercioId: comercio.id,
        nome: attNome,
        email: emailClean,
        senhaProvisoria: attSenha,
        donoUid: usuario.uid,
      });
      setAttNome('');
      setAttEmail('');
      setAttSenha('');
      setMsgAtt('Atendente criado! Ele já pode entrar com o e-mail e a senha provisória.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao criar atendente.';
      if (msg.includes('Missing or insufficient permissions') || msg.includes('PERMISSION_DENIED')) {
        setErroAtt('Sem permissão no Firestore para cadastrar atendente. Confira as regras publicadas.');
      } else {
        setErroAtt(msg);
      }
    } finally {
      setCriandoAtt(false);
    }
  };

  const handleExportar = async () => {
    const dados = await exportarDadosComercio(comercio.id);
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `caderneta-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleAnonimizar = async () => {
    if (!clienteAnonId) return;
    setMsgLgpd(null);
    await anonimizarClienteLGPD({
      comercioId: comercio.id,
      clienteId: clienteAnonId,
      uid: usuario.uid,
    });
    setClienteAnonId('');
    setConfirmandoAnon(false);
    setMsgLgpd('Dados pessoais do cliente anonimizados e links de consulta revogados.');
  };

  const clientesNaoAnonimizados = clientes.filter((c) => !c.anonimizado);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#14211E]">Configurações do comércio</h1>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Dados do comércio & PIN */}
        <section className="lg:col-span-6 rounded-2xl border border-[#E4E4DF] bg-white p-5 sm:p-6">
          <h2 className="text-lg font-bold text-[#14211E]">Dados gerais e PIN de exceção</h2>
          <form onSubmit={handleSalvarConfig} className="mt-4 space-y-4">
            <div>
              <label htmlFor="cfg-nome" className="block text-base font-semibold text-[#14211E]">
                Nome do comércio
              </label>
              <input
                id="cfg-nome"
                type="text"
                required
                value={nomeComercio}
                onChange={(e) => setNomeComercio(e.target.value)}
                className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="cfg-limite" className="block text-base font-semibold text-[#14211E]">
                Limite de crédito padrão (R$)
              </label>
              <input
                id="cfg-limite"
                type="text"
                inputMode="decimal"
                value={limiteStr}
                onChange={(e) => setLimiteStr(e.target.value)}
                className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 font-mono-nums text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="cfg-pin" className="block text-base font-semibold text-[#14211E]">
                {comercio.pinHash
                  ? 'Alterar PIN de 4 dígitos (deixe vazio para manter o atual)'
                  : 'Definir PIN de 4 dígitos do Dono'}
              </label>
              <input
                id="cfg-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={novoPin}
                onChange={(e) => setNovoPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 font-mono-nums text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
              />
            </div>

            {erroConfig && (
              <p className="rounded-xl bg-red-50 p-3 text-base text-red-800">{erroConfig}</p>
            )}
            {msgConfig && (
              <p className="rounded-xl bg-teal-50 p-3 text-base text-teal-900">{msgConfig}</p>
            )}

            <button
              type="submit"
              disabled={salvandoConfig}
              className="min-h-[48px] w-full rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {salvandoConfig ? 'Salvando...' : 'Salvar configurações'}
            </button>
          </form>
        </section>

        {/* Gerenciar atendentes */}
        <section className="lg:col-span-6 rounded-2xl border border-[#E4E4DF] bg-white p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="text-lg font-bold text-[#14211E]">Equipe e Atendentes</h2>
            <p className="mt-1 text-sm text-slate-600">
              Atendentes podem cadastrar clientes, anotar compras e receber pagamentos, mas não alteram limites, não estornam e não veem Configurações.
            </p>
          </div>

          <form onSubmit={handleCriarAtendente} className="space-y-3 border-b border-[#ECECE7] pb-5">
            <input
              type="text"
              required
              value={attNome}
              onChange={(e) => setAttNome(e.target.value)}
              placeholder="Nome do atendente"
              className="min-h-[46px] w-full rounded-xl border border-[#D4D4CE] px-4 text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="email"
                required
                value={attEmail}
                onChange={(e) => setAttEmail(e.target.value)}
                placeholder="E-mail de acesso"
                className="min-h-[46px] w-full rounded-xl border border-[#D4D4CE] px-4 text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
              />
              <input
                type="password"
                required
                minLength={6}
                value={attSenha}
                onChange={(e) => setAttSenha(e.target.value)}
                placeholder="Senha provisória (6+)"
                className="min-h-[46px] w-full rounded-xl border border-[#D4D4CE] px-4 text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
              />
            </div>

            {erroAtt && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{erroAtt}</p>}
            {msgAtt && <p className="rounded-xl bg-teal-50 p-3 text-sm text-teal-900">{msgAtt}</p>}

            <button
              type="submit"
              disabled={criandoAtt}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-4 py-2 text-base font-semibold text-[#14211E] hover:bg-slate-50"
            >
              <UserPlus className="h-5 w-5 text-teal-700" />
              <span>{criandoAtt ? 'Cadastrando...' : 'Adicionar atendente'}</span>
            </button>
          </form>

          <ul className="divide-y divide-[#ECECE7]">
            {equipe.map((m) => (
              <li key={m.uid} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-[#14211E]">
                    {m.nome} · <span className="text-slate-600">{m.perfil === 'dono' ? 'Dono' : 'Atendente'}</span>
                  </p>
                  <p className="text-sm text-slate-600">{m.email}</p>
                </div>
                {m.uid !== usuario.uid && (
                  <button
                    type="button"
                    onClick={() =>
                      alternarAtendenteAtivo({
                        uidAlvo: m.uid,
                        comercioId: comercio.id,
                        ativo: !m.ativo,
                        donoUid: usuario.uid,
                      })
                    }
                    className={`min-h-[40px] rounded-xl px-3 text-sm font-semibold ${
                      m.ativo
                        ? 'bg-red-50 text-red-800 hover:bg-red-100'
                        : 'bg-teal-50 text-teal-800 hover:bg-teal-100'
                    }`}
                  >
                    {m.ativo ? 'Desativar' : 'Reativar'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* QR do App, PWA, Exportar & LGPD */}
        <section className="lg:col-span-12 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-[#E4E4DF] bg-white p-5 sm:p-6 space-y-4">
            <h2 className="text-lg font-bold text-[#14211E]">Acesso no celular e Backup</h2>
            <div className="space-y-3">
              <Link
                to="/qr"
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#14211E] px-5 py-3 text-base font-semibold text-white hover:bg-slate-800"
              >
                <QrCode className="h-5 w-5" />
                <span>QR Code do app (Cartaz A4)</span>
              </Link>

              <PWAInstallButton />

              <button
                type="button"
                onClick={handleExportar}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-5 py-3 text-base font-semibold text-[#14211E] hover:bg-slate-50"
              >
                <Download className="h-5 w-5" />
                <span>Exportar dados do comércio (JSON)</span>
              </button>

              {clientes.length === 0 && (
                <button
                  type="button"
                  disabled={carregandoDemo}
                  onClick={async () => {
                    setCarregandoDemo(true);
                    try {
                      await carregarDadosExemplo({ comercioId: comercio.id, uid: usuario.uid });
                    } finally {
                      setCarregandoDemo(false);
                    }
                  }}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-5 py-3 text-base font-semibold text-[#14211E] hover:bg-slate-50"
                >
                  <Sparkles className="h-5 w-5 text-amber-600" />
                  <span>{carregandoDemo ? 'Gerando...' : 'Carregar dados de exemplo'}</span>
                </button>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-[#E4E4DF] bg-white p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 text-red-800">
              <ShieldAlert className="h-5 w-5" />
              <h2 className="text-lg font-bold">LGPD — Excluir / anonimizar cliente</h2>
            </div>
            <p className="text-sm text-slate-600">
              Remove nome e WhatsApp do cliente selecionado, bloqueia novas compras e revoga o link de consulta imediatamente.
            </p>

            <select
              value={clienteAnonId}
              onChange={(e) => {
                setClienteAnonId(e.target.value);
                setConfirmandoAnon(false);
              }}
              aria-label="Selecionar cliente para anonimizar"
              className="min-h-[48px] w-full rounded-xl border border-[#D4D4CE] bg-white px-4 text-base text-[#14211E]"
            >
              <option value="">Selecione um cliente...</option>
              {clientesNaoAnonimizados.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>

            {msgLgpd && <p className="rounded-xl bg-teal-50 p-3 text-sm text-teal-900">{msgLgpd}</p>}

            {clienteAnonId && !confirmandoAnon && (
              <button
                type="button"
                onClick={() => setConfirmandoAnon(true)}
                className="min-h-[48px] w-full rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-base font-semibold text-red-800 hover:bg-red-100"
              >
                Excluir / anonimizar dados do cliente
              </button>
            )}

            {confirmandoAnon && (
              <div className="rounded-xl bg-red-50 p-4 space-y-3">
                <p className="text-sm font-semibold text-red-900">
                  Esta ação é irreversível para o nome e telefone do cliente. Deseja confirmar?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmandoAnon(false)}
                    className="min-h-[44px] flex-1 rounded-xl bg-white border border-[#D4D4CE] text-sm font-semibold text-[#14211E]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleAnonimizar}
                    className="min-h-[44px] flex-1 rounded-xl bg-red-700 text-sm font-semibold text-white hover:bg-red-800"
                  >
                    Sim, anonimizar
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
