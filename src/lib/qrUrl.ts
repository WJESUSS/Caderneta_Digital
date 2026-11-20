export function resolveAppPublicUrl(
  envPublicUrl: string | undefined = import.meta.env.VITE_APP_PUBLIC_URL,
  fallbackOrigin: string = typeof window !== 'undefined' ? window.location.origin : ''
): string {
  const trimmed = (envPublicUrl ?? '').trim().replace(/\/+$/, '');
  if (trimmed.length > 0) {
    return trimmed;
  }
  return fallbackOrigin.replace(/\/+$/, '');
}

export const APP_PUBLIC_URL = resolveAppPublicUrl();

export interface UrlSafetyResult {
  isUnsafe: boolean;
  reason: string | null;
}

export function checkPublicUrlSafety(url: string): UrlSafetyResult {
  if (!url) {
    return {
      isUnsafe: true,
      reason: 'URL pública não definida.',
    };
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
      return {
        isUnsafe: true,
        reason:
          'Este QR Code aponta para localhost e não abrirá no celular dos clientes. Configure VITE_APP_PUBLIC_URL com a URL HTTPS de produção.',
      };
    }
    if (parsed.protocol !== 'https:') {
      return {
        isUnsafe: true,
        reason:
          'A URL do QR Code não usa HTTPS. Em produção, configure VITE_APP_PUBLIC_URL com endereço HTTPS válido.',
      };
    }
    return { isUnsafe: false, reason: null };
  } catch {
    return {
      isUnsafe: true,
      reason: 'URL pública inválida. Verifique a variável VITE_APP_PUBLIC_URL.',
    };
  }
}
