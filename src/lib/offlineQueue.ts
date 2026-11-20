import type { FormaPagamento } from './businessRules';

export interface OfflineQueuedLancamento {
  idempotencyKey: string;
  comercioId: string;
  clienteId: string;
  clienteNome: string;
  tipo: 'compra' | 'pagamento';
  valor: number;
  forma: FormaPagamento;
  itens: string;
  autorizadoExcecaoPor: string;
  enqueuedAt: number;
}

const STORAGE_KEY = 'caderneta_offline_queue_v1';

export function getOfflineQueue(): OfflineQueuedLancamento[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function enqueueOfflineLancamento(item: OfflineQueuedLancamento): OfflineQueuedLancamento[] {
  const current = getOfflineQueue();
  if (current.some((x) => x.idempotencyKey === item.idempotencyKey)) {
    return current;
  }
  const next = [...current, item];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function removeFromOfflineQueue(idempotencyKey: string): OfflineQueuedLancamento[] {
  const current = getOfflineQueue();
  const next = current.filter((x) => x.idempotencyKey !== idempotencyKey);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function generateIdempotencyKey(prefix: 'cmp' | 'pag'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}
