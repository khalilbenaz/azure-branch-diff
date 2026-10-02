import type { Api } from '../../../shared/api';
import type { ApiError, Result } from '../../../shared/types';

export const api = (window as unknown as { api: Api }).api;

/** Déballe un Result : renvoie la valeur ou lève l'ApiError. */
export async function call<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw r.error;
  return r.value;
}

/** Ouvre un lien https dans le navigateur ; lève l'ApiError en cas d'échec. */
export function openUrl(url: string): Promise<void> {
  return call(api.openExternal(url));
}

export function asApiError(e: unknown): ApiError {
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) return e as ApiError;
  return { code: 'unknown', message: e instanceof Error ? e.message : String(e) };
}
