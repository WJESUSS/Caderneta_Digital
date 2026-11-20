import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  HandCoins,
  Home,
  LogOut,
  Plus,
  QrCode,
  Settings,
  Users,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useOnlineStatus } from '../hooks/usePWAInstall';
import { PWAInstallButton } from './PWAInstallBanner';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { usuario, comercio, offlineQueueCount, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const isDono = usuario?.perfil === 'dono';

  const navItems = [
    { to: '/', label: 'Início', icon: Home },
    { to: '/clientes', label: 'Clientes', icon: Users },
    { to: '/cobranca', label: 'Cobrança', icon: HandCoins },
    { to: '/qr', label: 'QR Code', icon: QrCode },
    ...(isDono ? [{ to: '/configuracoes', label: 'Config', icon: Settings }] : []),
  ];

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-[#14211E] flex flex-col">
      {/* Desktop & Mobile Top Bar (strictly 3 zones on desktop, compact on mobile) */}
      <header className="no-print sticky top-0 z-30 border-b border-[#E4E4DF] bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-8 px-4 sm:px-6">
          {/* Zone 1: Brand Wordmark */}
          <Link
            to="/"
            className="flex items-center gap-2 text-lg font-bold tracking-tight text-[#14211E] whitespace-nowrap shrink-0"
          >
            <BookOpen className="h-5 w-5 text-teal-700" aria-hidden="true" />
            <span>Caderneta Digital</span>
          </Link>

          {/* Zone 2: Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-base font-medium text-slate-600">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`whitespace-nowrap shrink-0 py-1 transition-colors ${
                  isActive(item.to)
                    ? 'text-teal-800 font-semibold underline decoration-2 underline-offset-4'
                    : 'hover:text-[#14211E]'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Zone 3: Single Primary Action (+ Nova compra on desktop, sair/instalar discreto) */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:block">
              <PWAInstallButton compact />
            </div>
            <button
              type="button"
              onClick={() => navigate('/nova-compra')}
              className="hidden md:inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span>Nova compra</span>
            </button>
            <button
              type="button"
              onClick={logout}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 hover:text-[#14211E] transition-colors"
              title="Sair da conta"
              aria-label="Sair da conta"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Sub-header context strip (unboxed typography, zero pills) */}
      <div className="no-print border-b border-[#ECECE7] bg-[#F3F4F1]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-slate-600 sm:px-6">
          <div className="flex items-center gap-2 truncate">
            <span className="font-semibold text-[#14211E] truncate">
              {comercio?.nome || 'Meu Comércio'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{usuario?.nome}</span>
            <span aria-hidden="true">·</span>
            <span>{isDono ? 'Dono' : 'Atendente'}</span>
          </div>

          {(!isOnline || offlineQueueCount > 0) && (
            <div className="flex items-center gap-2 text-amber-800 font-medium">
              <WifiOff className="h-4 w-4 shrink-0" />
              <span>
                {!isOnline
                  ? 'Sem internet — lançamentos salvos na fila local'
                  : `Sincronizando ${offlineQueueCount} lançamento(s) pendente(s)...`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-24 sm:px-6 md:pb-10">
        {children}
      </main>

      {/* Mobile Bottom Tab Bar (Thumb Zone, <= 64px height) */}
      <nav
        aria-label="Navegação principal"
        className="no-print fixed bottom-0 left-0 right-0 z-40 border-t border-[#E4E4DF] bg-white/95 backdrop-blur-md md:hidden"
      >
        <div
          className={`grid h-16 items-center ${
            navItems.length === 5 ? 'grid-cols-5' : 'grid-cols-4'
          }`}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex h-full flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors ${
                  active ? 'text-teal-800 font-semibold' : 'text-slate-600 hover:text-[#14211E]'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="truncate max-w-[68px]">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
