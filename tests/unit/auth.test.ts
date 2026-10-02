import { test, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthStore } from '../../src/main/auth';
import { tempDir, reverseCipher } from './helpers';

test('save/load round trip without clear-text PAT on disk', () => {
  const f = join(tempDir(), 'cred.json');
  const s = new AuthStore(f, reverseCipher);
  s.save({ orgUrl: 'https://dev.azure.com/X', pat: 'mysecretpat' });
  expect(readFileSync(f, 'utf8')).not.toContain('mysecretpat');
  expect(s.load()).toEqual({ orgUrl: 'https://dev.azure.com/X', pat: 'mysecretpat' });
  s.clear();
  expect(s.load()).toBeNull();
});
test('refuses to save when encryption unavailable', () => {
  const f = join(tempDir(), 'cred.json');
  expect(() => new AuthStore(f, { ...reverseCipher, isAvailable: () => false }).save({ orgUrl: 'u', pat: 'p' })).toThrow();
});
test('load returns null on corrupt file', () => {
  const f = join(tempDir(), 'cred.json');
  writeFileSync(f, '{bad');
  expect(new AuthStore(f, reverseCipher).load()).toBeNull();
});
