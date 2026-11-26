import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { PublicQRPage } from './pages/PublicQRPage';
import { PublicConsultaPage } from './pages/PublicConsultaPage';
import { HomePage } from './pages/HomePage';
import { NovaCompraPage } from './pages/NovaCompraPage';
import { ReceberPagamentoPage } from './pages/ReceberPagamentoPage';
import { ClientesPage } from './pages/ClientesPage';
import { ClienteFormPage } from './pages/ClienteFormPage';
import { ClienteFichaPage } from './pages/ClienteFichaPage';
import { CobrancaPage } from './pages/CobrancaPage';
import { ConfiguracoesPage } from './pages/ConfiguracoesPage';
import { PlanosPage } from './pages/PlanosPage';

const AppRoutes: React.FC = () => {
  const { firebaseUser, usuario, loadingAuth, loadingComercio, needsOnboarding, authError, logout } =
    useAuth();

  const renderProtected = (element: React.ReactNode) => {
    if (loadingAuth || (firebaseUser && loadingComercio)) {
      return (
        <div className="min-h-screen bg-[#FAFAF8] p-6">
          <div className="mx-auto max-w-4xl space-y-4">
            <div className="h-14 rounded-2xl bg-slate-200 animate-pulse" />
            <div className="h-40 rounded-2xl bg-slate-200 animate-pulse" />
            <div className="h-64 rounded-2xl bg-slate-200 animate-pulse" />
          </div>
        </div>
      );
    }

    if (!firebaseUser || needsOnboarding || authError) {
      return <LoginPage />;
    }

    if (usuario && !usuario.ativo) {
      return (
        <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-[#E4E4DF] bg-white p-6 text-center space-y-4">
            <h1 className="text-xl font-bold text-[#14211E]">Acesso desativado</h1>
            <p className="text-base text-slate-600">
              Seu usuário foi desativado pelo Dono do comércio. Fale com o responsável para reativar seu acesso.
            </p>
            <button
              type="button"
              onClick={logout}
              className="min-h-[48px] w-full rounded-xl bg-[#14211E] px-5 py-3 text-base font-semibold text-white"
            >
              Sair
            </button>
          </div>
        </div>
      );
    }

    return <AppShell>{element}</AppShell>;
  };

  return (
    <Routes>
      {/* Rotas públicas sem login */}
      <Route path="/qr" element={<PublicQRPage />} />
      <Route path="/s/:token" element={<PublicConsultaPage />} />
      <Route
        path="/login"
        element={
          firebaseUser && !needsOnboarding && !authError ? <Navigate to="/" replace /> : <LoginPage />
        }
      />

      {/* Rotas autenticadas */}
      <Route path="/" element={renderProtected(<HomePage />)} />
      <Route path="/nova-compra" element={renderProtected(<NovaCompraPage />)} />
      <Route path="/receber-pagamento" element={renderProtected(<ReceberPagamentoPage />)} />
      <Route path="/clientes" element={renderProtected(<ClientesPage />)} />
      <Route path="/clientes/novo" element={renderProtected(<ClienteFormPage />)} />
      <Route path="/clientes/:id" element={renderProtected(<ClienteFichaPage />)} />
      <Route path="/clientes/:id/editar" element={renderProtected(<ClienteFormPage />)} />
      <Route path="/cobranca" element={renderProtected(<CobrancaPage />)} />
      <Route path="/configuracoes" element={renderProtected(<ConfiguracoesPage />)} />
      <Route path="/planos" element={renderProtected(<PlanosPage />)} />

      {/* Fallback amigável */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
