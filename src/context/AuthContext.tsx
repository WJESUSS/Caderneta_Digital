import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  carregarUsuarioAtual,
  observarClientes,
  observarComercio,
  registrarCompra,
  registrarPagamento,
} from '../lib/firestoreService';
import type { Cliente, Comercio, Usuario } from '../lib/businessRules';
import { getOfflineQueue, removeFromOfflineQueue } from '../lib/offlineQueue';
import { useOnlineStatus } from '../hooks/usePWAInstall';

interface AuthContextValue {
  firebaseUser: User | null;
  usuario: Usuario | null;
  comercio: Comercio | null;
  clientes: Cliente[];
  loadingAuth: boolean;
  loadingComercio: boolean;
  needsOnboarding: boolean;
  authError: string | null;
  offlineQueueCount: number;
  refreshProfile: () => Promise<void>;
  refreshOfflineQueueCount: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function formatProfileLoadError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('Missing or insufficient permissions') || raw.includes('PERMISSION_DENIED')) {
    return 'Sem permissão para acessar o Firestore. Publique as regras do arquivo firestore.rules no Firebase Console do projeto configurado.';
  }
  if (raw.includes('the client is offline') || raw.includes('NOT_FOUND')) {
    return 'Não foi possível conectar ao banco Firestore. Verifique se o banco (default) foi criado no Firebase Console e se as variáveis VITE_FIREBASE_* estão corretas.';
  }
  return 'Não foi possível carregar seu perfil no Firestore. Tente recarregar a página.';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [comercio, setComercio] = useState<Comercio | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loadingComercio, setLoadingComercio] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [offlineQueueCount, setOfflineQueueCount] = useState(() => getOfflineQueue().length);
  const isOnline = useOnlineStatus();

  const refreshOfflineQueueCount = useCallback(() => {
    setOfflineQueueCount(getOfflineQueue().length);
  }, []);

  const refreshProfile = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) {
      setUsuario(null);
      setComercio(null);
      setClientes([]);
      setAuthError(null);
      return;
    }
    setLoadingComercio(true);
    setAuthError(null);
    try {
      const prof = await carregarUsuarioAtual(current.uid);
      setUsuario(prof);
    } catch (e) {
      console.error(e);
      setAuthError(formatProfileLoadError(e));
      setUsuario(null);
    } finally {
      setLoadingComercio(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setUsuario(null);
        setComercio(null);
        setClientes([]);
        setAuthError(null);
        setLoadingAuth(false);
        return;
      }
      setLoadingComercio(true);
      setAuthError(null);
      try {
        const prof = await carregarUsuarioAtual(user.uid);
        setUsuario(prof);
      } catch (e) {
        console.error(e);
        setAuthError(formatProfileLoadError(e));
        setUsuario(null);
      } finally {
        setLoadingComercio(false);
        setLoadingAuth(false);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!usuario || !usuario.ativo) {
      setComercio(null);
      setClientes([]);
      return;
    }
    const handleSubError = (err: unknown) => {
      console.error(err);
      setAuthError(formatProfileLoadError(err));
    };
    const unsubCom = observarComercio(usuario.comercioId, setComercio, handleSubError);
    const unsubCli = observarClientes(usuario.comercioId, setClientes, handleSubError);
    return () => {
      unsubCom();
      unsubCli();
    };
  }, [usuario]);

  // Sincroniza fila offline ao reconectar
  useEffect(() => {
    if (!isOnline || !usuario || !comercio) return;
    const queue = getOfflineQueue().filter((q) => q.comercioId === comercio.id);
    if (queue.length === 0) return;

    let cancelled = false;
    const flush = async () => {
      for (const item of queue) {
        if (cancelled) break;
        try {
          if (item.tipo === 'compra') {
            await registrarCompra({
              comercioId: item.comercioId,
              comercioNome: comercio.nome,
              clienteId: item.clienteId,
              valorCentavos: item.valor,
              itens: item.itens,
              autorizadoExcecaoPor: item.autorizadoExcecaoPor || undefined,
              uid: usuario.uid,
              idempotencyKey: item.idempotencyKey,
            });
          } else {
            await registrarPagamento({
              comercioId: item.comercioId,
              comercioNome: comercio.nome,
              clienteId: item.clienteId,
              valorCentavos: item.valor,
              forma: item.forma === 'fiado' ? 'dinheiro' : item.forma,
              uid: usuario.uid,
              idempotencyKey: item.idempotencyKey,
            });
          }
          removeFromOfflineQueue(item.idempotencyKey);
          refreshOfflineQueueCount();
        } catch (err) {
          console.error('Erro ao sincronizar lançamento offline:', err);
          // Mantém se erro de rede, descarta se erro de regra definitivo
          if (err instanceof Error && (err.message.includes('limite') || err.message.includes('maior'))) {
            removeFromOfflineQueue(item.idempotencyKey);
            refreshOfflineQueueCount();
          }
        }
      }
    };
    void flush();
    return () => {
      cancelled = true;
    };
  }, [isOnline, usuario, comercio, refreshOfflineQueueCount]);

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        usuario,
        comercio,
        clientes,
        loadingAuth,
        loadingComercio,
        needsOnboarding: Boolean(firebaseUser && !loadingAuth && !loadingComercio && !usuario && !authError),
        authError,
        offlineQueueCount,
        refreshProfile,
        refreshOfflineQueueCount,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  }
  return ctx;
}
