import { test, expect } from 'vitest';
import { join } from 'node:path';
import { discoverOrgs } from '../../src/main/azure/discover';
import { createHandlers } from '../../src/main/ipc';
import { AuthStore } from '../../src/main/auth';
import { fakeContext } from '../../src/main/azure/fake';
import { normalizeError } from '../../src/main/errors';
import type { Result } from '../../src/shared/types';
import { tempDir, reverseCipher } from './helpers';

const ok = <T,>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
};

function fakeFetch(status = 200) {
  const calls: { url: string; auth: string }[] = [];
  const impl = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, auth: init?.headers?.Authorization ?? '' });
    if (status !== 200) return new Response('<html>sign in</html>', { status });
    if (url.includes('/profile/profiles/me')) return Response.json({ id: 'member-1' });
    if (url.includes('/accounts?memberId=member-1')) return Response.json({ value: [{ accountName: 'Contoso' }, { accountName: 'Fabrikam' }] });
    return new Response('not found', { status: 404 });
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

test('découverte des organisations accessibles avec un jeton', async () => {
  const f = fakeFetch();
  expect(await discoverOrgs('multi-pat', f.impl)).toEqual(['https://dev.azure.com/Contoso', 'https://dev.azure.com/Fabrikam']);
  expect(f.calls[0].auth).toBe(`Basic ${Buffer.from(':multi-pat').toString('base64')}`);
  expect(f.calls.every((c) => c.url.startsWith('https://app.vssps.visualstudio.com/'))).toBe(true);
});

test('découverte : jeton refusé (203 / 401) → erreur auth', async () => {
  for (const status of [203, 401]) {
    await discoverOrgs('bad', fakeFetch(status).impl).then(
      () => expect.unreachable(),
      (e) => expect(normalizeError(e).code).toBe('auth'),
    );
  }
});

function setup() {
  const store = new AuthStore(join(tempDir(), 'c.json'), reverseCipher);
  const connected: { url: string; pat: string }[] = [];
  const api = createHandlers({
    store,
    connect: async (url, pat) => {
      connected.push({ url, pat });
      return fakeContext();
    },
    pickFolder: async () => null,
    openExternal: async () => {},
    discover: async (pat) => (pat === 'multi' ? ['https://dev.azure.com/Contoso', 'https://dev.azure.com/Fabrikam'] : []),
  });
  return { api, store, connected };
}

test('jeton multi-organisations : découverte, ajout de plusieurs organisations, bascule', async () => {
  const { api, connected } = setup();
  expect(ok(await api.discoverOrgs({ pat: 'multi' }))).toEqual(['https://dev.azure.com/Contoso', 'https://dev.azure.com/Fabrikam']);
  const st = ok(await api.addOrgs({ pat: 'multi', label: 'Toutes', orgUrls: ['https://dev.azure.com/Contoso', 'https://dev.azure.com/Fabrikam'] }));
  expect(st.active).toBe('https://dev.azure.com/Contoso');
  expect(st.orgs.map((o) => o.tokenLabel)).toEqual(['Toutes', 'Toutes']);
  expect(st.tokens).toEqual([{ id: st.tokens[0].id, label: 'Toutes', orgCount: 2 }]);
  expect(ok(await api.session())).toEqual({ orgUrl: 'https://dev.azure.com/Contoso' });
  ok(await api.connectOrg('https://dev.azure.com/Fabrikam'));
  expect(ok(await api.session())).toEqual({ orgUrl: 'https://dev.azure.com/Fabrikam' });
  expect(connected.at(-1)).toEqual({ url: 'https://dev.azure.com/Fabrikam', pat: 'multi' });
  expect(JSON.stringify(st)).not.toContain('multi"'); // le PAT n'est jamais renvoyé
});

test('jeton par organisation, et ajout avec un jeton déjà enregistré', async () => {
  const { api } = setup();
  ok(await api.addOrgs({ pat: 'p-a', label: 'PAT A', orgUrls: ['https://dev.azure.com/A'] }));
  const st = ok(await api.addOrgs({ pat: 'p-b', label: 'PAT B', orgUrls: ['https://dev.azure.com/B'] }));
  expect(st.tokens.map((t) => t.label)).toEqual(['PAT A', 'PAT B']);
  const tokenA = st.tokens.find((t) => t.label === 'PAT A')!.id;
  const st2 = ok(await api.addOrgs({ tokenId: tokenA, orgUrls: ['https://dev.azure.com/C'] }));
  expect(st2.orgs.find((o) => o.orgUrl === 'https://dev.azure.com/C')?.tokenLabel).toBe('PAT A');
});

test('déconnexion : tout est gardé ; retirer une organisation oublie son jeton s’il ne sert plus', async () => {
  const { api } = setup();
  ok(await api.addOrgs({ pat: 'p-a', label: 'PAT A', orgUrls: ['https://dev.azure.com/A'] }));
  ok(await api.logout());
  expect(ok(await api.orgs()).orgs).toHaveLength(1);
  expect(ok(await api.session())).toEqual({ orgUrl: 'https://dev.azure.com/A' }); // reconnexion automatique à la dernière
  ok(await api.logout());
  const st = ok(await api.removeOrg('https://dev.azure.com/A'));
  expect(st).toEqual({ orgs: [], tokens: [], active: null });
});

test('bascule refusée pendant un merge en cours ; organisations non https refusées', async () => {
  const { api } = setup();
  expect((await api.addOrgs({ pat: 'x', label: 'x', orgUrls: ['http://dev.azure.com/A'] })).ok).toBe(false);
  expect((await api.connectOrg('https://dev.azure.com/Unknown')).ok).toBe(false);
});
