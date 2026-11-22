import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { BookOpen, QrCode } from 'lucide-react';
import { auth } from '../lib/firebase';
import { criarComercioEDono } from '../lib/firestoreService';
import { parseBRLToCentavos } from '../lib/businessRules';
import { useAuth } from '../context/AuthContext';
import { PWAInstallButton } from '../components/PWAInstallBanner';

export const LoginPage: React.FC = () => {
  const { firebaseUser, needsOnboarding, authError, refreshProfile } = useAuth();
  const [modo, setModo] = useState<'entrar' | 'criar'>('entrar');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [nomeDono, setNomeDono] = useState('');

  const prefilledUidRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (
      needsOnboarding &&
      firebaseUser?.displayName &&
      prefilledUidRef.current !== firebaseUser.uid
    ) {
      prefilledUidRef.current = firebaseUser.uid;
      setNomeDono((prev) => prev || firebaseUser.displayName || '');
    }
  }, [needsOnboarding, firebaseUser]);
  const [nomeComercio, setNomeComercio] = useState('');
  const [limitePadraoStr, setLimitePadraoStr] = useState('200,00');
  const [pin4, setPin4] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const traduzirErroAuth = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password') || msg.includes('auth/user-not-found')) {
      return 'E-mail ou senha incorretos.';
    }
    if (msg.includes('auth/email-already-in-use')) {
      return 'Este e-mail já está cadastrado. Use a aba Entrar.';
    }
    if (msg.includes('auth/weak-password')) {
      return 'A senha precisa ter pelo menos 6 caracteres.';
    }
    if (msg.includes('auth/operation-not-allowed')) {
      return 'Login por E-mail/Senha ainda não foi ativado no Firebase Console. Você pode entrar com Google abaixo ou ativar E-mail/Senha no Console.';
    }
    if (msg.includes('auth/unauthorized-domain')) {
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      return `Domínio não autorizado no Firebase (${host}). Adicione "${host}" em Firebase Console → Authentication → Settings → Authorized domains (ou entre com E-mail e senha).`;
    }
    if (msg.includes('auth/popup-closed-by-user')) {
      return 'Janela de login do Google foi fechada antes de concluir.';
    }
    if (msg.includes('Missing or insufficient permissions') || msg.includes('PERMISSION_DENIED')) {
      return 'Sem permissão para gravar no Firestore. Publique as regras do arquivo firestore.rules no Firebase Console.';
    }
    return msg || 'Não foi possível autenticar. Tente novamente.';
  };

  const handleEntrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), senha);
    } catch (err) {
      setErro(traduzirErroAuth(err));
    } finally {
      setCarregando(false);
    }
  };

  const handleCriarConta = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (nomeComercio.trim().length < 2 || nomeDono.trim().length < 2) {
      setErro('Informe seu nome e o nome do comércio.');
      return;
    }
    if (pin4 && !/^\d{4}$/.test(pin4)) {
      setErro('O PIN de autorização deve ter 4 números.');
      return;
    }
    setCarregando(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), senha);
      await criarComercioEDono({
        uid: cred.user.uid,
        email: email.trim(),
        nomeDono: nomeDono.trim(),
        nomeComercio: nomeComercio.trim(),
        limitePadraoCentavos: parseBRLToCentavos(limitePadraoStr) || 20000,
        pin4,
      });
      await refreshProfile();
    } catch (err) {
      setErro(traduzirErroAuth(err));
    } finally {
      setCarregando(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErro(null);
    setCarregando(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      setErro(traduzirErroAuth(err));
    } finally {
      setCarregando(false);
    }
  };

  const handleCompletarOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setErro(null);
    if (nomeComercio.trim().length < 2 || nomeDono.trim().length < 2) {
      setErro('Informe seu nome e o nome do comércio.');
      return;
    }
    if (pin4 && !/^\d{4}$/.test(pin4)) {
      setErro('O PIN de autorização deve ter 4 números.');
      return;
    }
    setCarregando(true);
    try {
      await criarComercioEDono({
        uid: firebaseUser.uid,
        email: firebaseUser.email || `${firebaseUser.uid}@caderneta.local`,
        nomeDono: nomeDono.trim(),
        nomeComercio: nomeComercio.trim(),
        limitePadraoCentavos: parseBRLToCentavos(limitePadraoStr) || 20000,
        pin4,
      });
      await refreshProfile();
    } catch (err) {
      setErro(traduzirErroAuth(err));
    } finally {
      setCarregando(false);
    }
  };

  if (authError && firebaseUser) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex flex-col justify-center px-4 py-8">
        <div className="mx-auto w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-3">
            <BookOpen className="h-7 w-7 text-red-700" />
            <h1 className="text-2xl font-bold text-[#14211E]">Configuração pendente no Firestore</h1>
          </div>
          <p className="text-base text-slate-700 leading-relaxed">{authError}</p>
          <p className="text-sm text-slate-600">
            Conta conectada: <span className="font-medium text-[#14211E]">{firebaseUser.email}</span>
          </p>
          <div className="pt-2 space-y-3">
            <button
              type="button"
              onClick={() => void refreshProfile()}
              className="min-h-[48px] w-full rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800"
            >
              Tentar novamente
            </button>
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="min-h-[44px] w-full text-center text-base font-medium text-slate-600 hover:text-[#14211E]"
            >
              Sair da conta
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (needsOnboarding && firebaseUser) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex flex-col justify-center px-4 py-8">
        <div className="mx-auto w-full max-w-md rounded-2xl border border-[#E4E4DF] bg-white p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <BookOpen className="h-7 w-7 text-teal-700" />
            <h1 className="text-2xl font-bold text-[#14211E]">Configurar seu comércio</h1>
          </div>
          <p className="mt-2 text-base text-slate-600">
            Conta conectada ({firebaseUser.email}). Preencha os dados do seu estabelecimento para começar.
          </p>

          <form onSubmit={handleCompletarOnboarding} className="mt-6 space-y-4">
            <div>
              <label htmlFor="onb-dono" className="block text-base font-semibold text-[#14211E]">
                Seu nome (Dono)
              </label>
              <input
                id="onb-dono"
                type="text"
                required
                value={nomeDono}
                onChange={(e) => setNomeDono(e.target.value)}
                placeholder="Ex: Maria da Silva"
                className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="onb-comercio" className="block text-base font-semibold text-[#14211E]">
                Nome do comércio
              </label>
              <input
                id="onb-comercio"
                type="text"
                required
                value={nomeComercio}
                onChange={(e) => setNomeComercio(e.target.value)}
                placeholder="Ex: Mercadinho São Jorge"
                className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="onb-limite" className="block text-base font-semibold text-[#14211E]">
                  Limite padrão (R$)
                </label>
                <input
                  id="onb-limite"
                  type="text"
                  inputMode="decimal"
                  value={limitePadraoStr}
                  onChange={(e) => setLimitePadraoStr(e.target.value)}
                  className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 font-mono-nums text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="onb-pin" className="block text-base font-semibold text-[#14211E]">
                  PIN de 4 dígitos (exceções)
                </label>
                <input
                  id="onb-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin4}
                  onChange={(e) => setPin4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="Ex: 1234"
                  className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 font-mono-nums text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
                />
              </div>
            </div>

            {erro && (
              <p className="rounded-xl bg-red-50 px-4 py-3 text-base text-red-800" role="alert">
                {erro}
              </p>
            )}

            <button
              type="submit"
              disabled={carregando}
              className="min-h-[52px] w-full rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {carregando ? 'Criando comércio...' : 'Começar a usar'}
            </button>

            <button
              type="button"
              onClick={() => signOut(auth)}
              className="min-h-[44px] w-full text-center text-base font-medium text-slate-600 hover:text-[#14211E]"
            >
              Usar outra conta
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex flex-col justify-center px-4 py-8">
      <div className="mx-auto w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left column: Value prop */}
        <div className="lg:col-span-6 space-y-5">
          <div className="inline-flex items-center gap-2.5 text-teal-800 font-bold text-lg">
            <BookOpen className="h-6 w-6" />
            <span>Caderneta Digital</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#14211E] text-balance">
            Controle o fiado do seu comércio sem perder nenhuma venda.
          </h1>
          <p className="text-base sm:text-lg text-slate-600 leading-relaxed">
            Anote compras em menos de 10 segundos, controle limites com PIN do dono, receba pagamentos parciais ou totais e cobre pelo WhatsApp com educação.
          </p>

          <div className="pt-2 space-y-3 max-w-xs">
            <PWAInstallButton />
          </div>
        </div>

        {/* Right column: Auth Card */}
        <div className="lg:col-span-6">
          <div className="rounded-2xl border border-[#E4E4DF] bg-white p-6 sm:p-8">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#F3F4F1] p-1">
              <button
                type="button"
                onClick={() => {
                  setModo('entrar');
                  setErro(null);
                }}
                className={`min-h-[44px] rounded-lg text-base font-semibold transition-colors ${
                  modo === 'entrar'
                    ? 'bg-white text-[#14211E] shadow-xs'
                    : 'text-slate-600 hover:text-[#14211E]'
                }`}
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => {
                  setModo('criar');
                  setErro(null);
                }}
                className={`min-h-[44px] rounded-lg text-base font-semibold transition-colors ${
                  modo === 'criar'
                    ? 'bg-white text-[#14211E] shadow-xs'
                    : 'text-slate-600 hover:text-[#14211E]'
                }`}
              >
                Criar conta
              </button>
            </div>

            {modo === 'entrar' ? (
              <form onSubmit={handleEntrar} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="login-email" className="block text-base font-semibold text-[#14211E]">
                    E-mail
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="login-senha" className="block text-base font-semibold text-[#14211E]">
                    Senha
                  </label>
                  <input
                    id="login-senha"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    placeholder="Sua senha"
                    className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
                  />
                </div>

                {erro && (
                  <p className="rounded-xl bg-red-50 px-4 py-3 text-base text-red-800" role="alert">
                    {erro}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={carregando}
                  className="min-h-[52px] w-full rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {carregando ? 'Entrando...' : 'Entrar na caderneta'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleCriarConta} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="reg-nome" className="block text-base font-semibold text-[#14211E]">
                    Seu nome (Dono)
                  </label>
                  <input
                    id="reg-nome"
                    type="text"
                    required
                    value={nomeDono}
                    onChange={(e) => setNomeDono(e.target.value)}
                    placeholder="Ex: João Oliveira"
                    className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="reg-comercio" className="block text-base font-semibold text-[#14211E]">
                    Nome do comércio
                  </label>
                  <input
                    id="reg-comercio"
                    type="text"
                    required
                    value={nomeComercio}
                    onChange={(e) => setNomeComercio(e.target.value)}
                    placeholder="Ex: Padaria Estrela"
                    className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="reg-limite" className="block text-base font-semibold text-[#14211E]">
                      Limite padrão (R$)
                    </label>
                    <input
                      id="reg-limite"
                      type="text"
                      inputMode="decimal"
                      value={limitePadraoStr}
                      onChange={(e) => setLimitePadraoStr(e.target.value)}
                      className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 font-mono-nums text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-pin" className="block text-base font-semibold text-[#14211E]">
                      PIN 4 dígitos (Dono)
                    </label>
                    <input
                      id="reg-pin"
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={pin4}
                      onChange={(e) => setPin4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="Ex: 1234"
                      className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 font-mono-nums text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="reg-email" className="block text-base font-semibold text-[#14211E]">
                    E-mail
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="reg-senha" className="block text-base font-semibold text-[#14211E]">
                    Senha (mínimo 6 caracteres)
                  </label>
                  <input
                    id="reg-senha"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    placeholder="Crie uma senha"
                    className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
                  />
                </div>

                {erro && (
                  <p className="rounded-xl bg-red-50 px-4 py-3 text-base text-red-800" role="alert">
                    {erro}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={carregando}
                  className="min-h-[52px] w-full rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {carregando ? 'Criando comércio...' : 'Criar comércio e começar'}
                </button>
              </form>
            )}

            <div className="my-5 flex items-center gap-3 text-sm text-slate-400">
              <div className="h-px flex-1 bg-[#E4E4DF]" />
              <span>ou</span>
              <div className="h-px flex-1 bg-[#E4E4DF]" />
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={carregando}
              className="min-h-[48px] w-full rounded-xl border border-[#D4D4CE] bg-white px-4 py-3 text-base font-semibold text-[#14211E] hover:bg-slate-50 transition-colors"
            >
              Entrar com Google
            </button>

            <div className="mt-6 pt-4 border-t border-[#ECECE7] text-center">
              <Link
                to="/qr"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 text-base font-medium text-slate-600 hover:text-teal-800 underline-offset-4 hover:underline"
              >
                <QrCode className="h-4 w-4" />
                <span>Abrir no celular (QR Code)</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
