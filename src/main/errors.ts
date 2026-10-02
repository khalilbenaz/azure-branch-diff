import { ERROR_CODES, type ApiError, type ErrorCode } from '../shared/types';

const NETWORK_CODES = ['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN', 'ESOCKETTIMEDOUT'];

interface RawError {
  statusCode?: number;
  code?: string;
  message?: string;
  details?: string;
  result?: { message?: string };
}

function isApiError(e: RawError): e is ApiError {
  return typeof e.message === 'string' && ERROR_CODES.includes(e.code as ErrorCode);
}

/** Transforme n'importe quelle erreur (SDK Azure, Node, ApiError) en ApiError, sans jamais laisser passer le PAT. */
export function normalizeError(e: unknown, secret?: string): ApiError {
  const raw = (e ?? {}) as RawError;
  // Le jeton peut apparaître tel quel ou encodé dans un en-tête Basic (« :PAT » en base64).
  const secrets = secret ? [secret, Buffer.from(`:${secret}`).toString('base64')] : [];
  const mask = (s: string) => secrets.reduce((acc, x) => acc.split(x).join('***'), s);
  if (isApiError(raw)) {
    return { code: raw.code, message: mask(raw.message), ...(raw.details ? { details: mask(raw.details) } : {}) };
  }
  const text = mask(raw.result?.message ?? raw.message ?? String(e));
  if (raw.statusCode === 401) {
    return { code: 'auth', message: 'Session refusée : PAT invalide ou expiré. Reconnectez-vous.', details: text };
  }
  if (raw.statusCode === 403) {
    return { code: 'forbidden', message: 'Droits insuffisants pour cette action (vérifiez les droits du PAT : Code Read & Write).', details: text };
  }
  if (raw.statusCode === 404) return { code: 'notFound', message: 'Élément introuvable sur Azure DevOps.', details: text };
  if ((raw.code && NETWORK_CODES.includes(raw.code)) || /timeout/i.test(text)) {
    return { code: 'network', message: 'Azure DevOps est injoignable (réseau ou délai dépassé).', details: text };
  }
  if (/policy|TF401027/i.test(text)) return { code: 'policy', message: 'Bloqué par une politique de branche.', details: text };
  return { code: 'unknown', message: text };
}
