import { test, expect } from 'vitest';
import { normalizeError } from '../../src/main/errors';

test('401 → auth', () => expect(normalizeError({ statusCode: 401, message: 'x' }).code).toBe('auth'));
test('403 → forbidden (non fatal)', () => expect(normalizeError({ statusCode: 403, message: 'x' }).code).toBe('forbidden'));
test('404 → notFound', () => expect(normalizeError({ statusCode: 404, message: 'x' }).code).toBe('notFound'));
test('dns failure → network', () =>
  expect(normalizeError(Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' })).code).toBe('network'));
test('timeout → network', () => expect(normalizeError(new Error('Request timeout: /x')).code).toBe('network'));
test('policy', () => expect(normalizeError({ statusCode: 409, message: 'TF401027: blocked by policy' }).code).toBe('policy'));
test('unknown keeps message', () => expect(normalizeError(new Error('boom'))).toEqual({ code: 'unknown', message: 'boom' }));
test('masks secret in message and details', () => {
  const e = normalizeError({ statusCode: 401, message: 'bad token abc123secret' }, 'abc123secret');
  expect(JSON.stringify(e)).not.toContain('abc123secret');
  expect(e.details).toContain('***');
});
test('already-normalized ApiError passes through', () =>
  expect(normalizeError({ code: 'stale', message: 'changed' })).toEqual({ code: 'stale', message: 'changed' }));
