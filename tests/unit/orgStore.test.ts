import { test, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthStore } from '../../src/main/auth';
import { tempDir, reverseCipher } from './helpers';

const store = () => new AuthStore(join(tempDir(), 'cred.json'), reverseCipher);

test('un jeton par organisation, organisation active, jamais de PAT en clair', () => {
  const s = store();
  const t1 = s.addToken('PAT pro', 'secret-one');
  s.addOrg('https://dev.azure.com/A', t1);
  const t2 = s.addToken('PAT perso', 'secret-two');
  s.addOrg('https://dev.azure.com/B', t2);
  s.setActive('https://dev.azure.com/B');
  expect(s.load()).toEqual({ orgUrl: 'https://dev.azure.com/B', pat: 'secret-two' });
  expect(s.orgs()).toEqual([
    { orgUrl: 'https://dev.azure.com/A', tokenId: t1, tokenLabel: 'PAT pro' },
    { orgUrl: 'https://dev.azure.com/B', tokenId: t2, tokenLabel: 'PAT perso' },
  ]);
  const raw = readFileSync((s as unknown as { file: string }).file, 'utf8');
  expect(raw).not.toContain('secret-one');
  expect(raw).not.toContain('secret-two');
});

test('un jeton multi-organisations partagé ; retirer une organisation garde le jeton tant qu’il sert', () => {
  const s = store();
  const t = s.addToken('Toutes mes organisations', 'multi');
  s.addOrg('https://dev.azure.com/A', t);
  s.addOrg('https://dev.azure.com/B', t);
  expect(s.tokens()).toEqual([{ id: t, label: 'Toutes mes organisations', orgCount: 2 }]);
  expect(s.patFor('https://dev.azure.com/A')).toBe('multi');
  s.removeOrg('https://dev.azure.com/A');
  expect(s.tokens()).toEqual([{ id: t, label: 'Toutes mes organisations', orgCount: 1 }]);
  s.removeOrg('https://dev.azure.com/B');
  expect(s.tokens()).toEqual([]);
  expect(s.load()).toBeNull();
});

test('ajouter une organisation existante la rattache au nouveau jeton (sans doublon)', () => {
  const s = store();
  const t1 = s.addToken('ancien', 'old');
  s.addOrg('https://dev.azure.com/A', t1);
  const t2 = s.addToken('nouveau', 'new');
  s.addOrg('https://dev.azure.com/A/', t2);
  expect(s.orgs()).toEqual([{ orgUrl: 'https://dev.azure.com/A', tokenId: t2, tokenLabel: 'nouveau' }]);
  expect(s.tokens().map((x) => x.label)).toEqual(['nouveau']); // l'ancien jeton inutilisé est oublié
});

test('migration de l’ancien format (une seule organisation)', () => {
  const dir = tempDir();
  const file = join(dir, 'cred.json');
  const enc = reverseCipher.encrypt('legacy-pat').toString('base64');
  writeFileSync(file, JSON.stringify({ orgUrl: 'https://dev.azure.com/Old', pat: enc }));
  const s = new AuthStore(file, reverseCipher);
  expect(s.load()).toEqual({ orgUrl: 'https://dev.azure.com/Old', pat: 'legacy-pat' });
  expect(s.orgs()).toHaveLength(1);
});

test('save() (connexion directe) reste compatible : ajoute ou remplace et active', () => {
  const s = store();
  s.save({ orgUrl: 'https://dev.azure.com/A', pat: 'p1' });
  s.save({ orgUrl: 'https://dev.azure.com/B', pat: 'p2' });
  expect(s.orgs().map((o) => o.orgUrl)).toEqual(['https://dev.azure.com/A', 'https://dev.azure.com/B']);
  expect(s.load()).toEqual({ orgUrl: 'https://dev.azure.com/B', pat: 'p2' });
});
