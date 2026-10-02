import type { ApiError } from '../shared/types';

/** Validation à l'exécution des arguments reçus par IPC : le renderer n'est pas une source de confiance. */
const bad = (what: string): ApiError => ({ code: 'unknown', message: `Paramètre invalide : ${what}.` });

export function str(v: unknown, what: string, max = 4096): string {
  if (typeof v !== 'string' || v.length > max) throw bad(what);
  return v;
}

export function int(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw bad(what);
  return v;
}

export function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad(what);
  return v as Record<string, unknown>;
}

export function oneOf<T extends string>(v: unknown, values: readonly T[], what: string): T {
  if (typeof v !== 'string' || !values.includes(v as T)) throw bad(what);
  return v as T;
}

export function bool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') throw bad(what);
  return v;
}
