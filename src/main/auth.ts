import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import type { AzureContext } from './azure/client';

/** Sous-ensemble de safeStorage d'Electron, injecté pour pouvoir tester sans Electron. */
export interface Cipher {
  isAvailable(): boolean;
  encrypt(s: string): Buffer;
  decrypt(b: Buffer): string;
}

export interface Credentials {
  orgUrl: string;
  pat: string;
}

interface StoredToken {
  id: string;
  label: string;
  /** PAT chiffré (base64). */
  pat: string;
}

interface StoredData {
  v: 2;
  tokens: StoredToken[];
  orgs: { orgUrl: string; tokenId: string }[];
  active: string | null;
}

export interface OrgEntry {
  orgUrl: string;
  tokenId: string;
  tokenLabel: string;
}

export interface TokenEntry {
  id: string;
  label: string;
  orgCount: number;
}

const normOrg = (u: string) => u.trim().replace(/\/+$/, '');
const EMPTY: StoredData = { v: 2, tokens: [], orgs: [], active: null };

/**
 * Organisations et jetons, chiffrés par le trousseau système (Keychain / DPAPI), jamais écrits en clair.
 * Un jeton peut servir à plusieurs organisations (PAT « toutes les organisations accessibles ») ou à une seule.
 */
export class AuthStore {
  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {}

  private read(): StoredData {
    try {
      if (!existsSync(this.file)) return { ...EMPTY, tokens: [], orgs: [] };
      const j = JSON.parse(readFileSync(this.file, 'utf8'));
      if (j && j.v === 2) return j as StoredData;
      // Ancien format : une seule organisation.
      if (j && typeof j.orgUrl === 'string' && typeof j.pat === 'string') {
        return { v: 2, tokens: [{ id: 't1', label: 'Jeton', pat: j.pat }], orgs: [{ orgUrl: normOrg(j.orgUrl), tokenId: 't1' }], active: normOrg(j.orgUrl) };
      }
    } catch {
      /* fichier illisible : comme vide */
    }
    return { ...EMPTY, tokens: [], orgs: [] };
  }

  private write(d: StoredData): void {
    // Jetons inutilisés : oubliés.
    d.tokens = d.tokens.filter((t) => d.orgs.some((o) => o.tokenId === t.id));
    if (d.active && !d.orgs.some((o) => o.orgUrl === d.active)) d.active = d.orgs[0]?.orgUrl ?? null;
    if (!d.orgs.length) {
      rmSync(this.file, { force: true });
      return;
    }
    writeFileSync(this.file, JSON.stringify(d), { mode: 0o600 });
  }

  /** Enregistre un jeton (chiffré) et renvoie son identifiant. */
  addToken(label: string, pat: string): string {
    if (!this.cipher.isAvailable()) throw new Error('Chiffrement système indisponible : le PAT ne peut pas être enregistré.');
    const d = this.read();
    const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    d.tokens.push({ id, label: label.trim() || 'Jeton', pat: this.cipher.encrypt(pat).toString('base64') });
    // Le jeton n'est conservé que rattaché à une organisation : on écrit sans filtrer.
    writeFileSync(this.file, JSON.stringify(d), { mode: 0o600 });
    return id;
  }

  /** Ajoute (ou rattache à `tokenId`) une organisation. */
  addOrg(orgUrl: string, tokenId: string): void {
    const d = this.read();
    if (!d.tokens.some((t) => t.id === tokenId)) throw new Error('Jeton inconnu.');
    const url = normOrg(orgUrl);
    d.orgs = [...d.orgs.filter((o) => o.orgUrl !== url), { orgUrl: url, tokenId }].sort((a, b) => a.orgUrl.localeCompare(b.orgUrl));
    if (!d.active) d.active = url;
    this.write(d);
  }

  setActive(orgUrl: string): void {
    const d = this.read();
    const url = normOrg(orgUrl);
    if (!d.orgs.some((o) => o.orgUrl === url)) throw new Error('Organisation inconnue.');
    d.active = url;
    this.write(d);
  }

  removeOrg(orgUrl: string): void {
    const d = this.read();
    const url = normOrg(orgUrl);
    d.orgs = d.orgs.filter((o) => o.orgUrl !== url);
    if (d.active === url) d.active = null;
    this.write(d);
  }

  orgs(): OrgEntry[] {
    const d = this.read();
    return d.orgs.map((o) => ({ orgUrl: o.orgUrl, tokenId: o.tokenId, tokenLabel: d.tokens.find((t) => t.id === o.tokenId)?.label ?? '' }));
  }

  tokens(): TokenEntry[] {
    const d = this.read();
    return d.tokens.map((t) => ({ id: t.id, label: t.label, orgCount: d.orgs.filter((o) => o.tokenId === t.id).length }));
  }

  private decrypt(t: StoredToken | undefined): string | null {
    if (!t) return null;
    try {
      return this.cipher.decrypt(Buffer.from(t.pat, 'base64'));
    } catch {
      return null;
    }
  }

  patFor(orgUrl: string): string | null {
    const d = this.read();
    const o = d.orgs.find((x) => x.orgUrl === normOrg(orgUrl));
    return o ? this.decrypt(d.tokens.find((t) => t.id === o.tokenId)) : null;
  }

  tokenPat(tokenId: string): string | null {
    return this.decrypt(this.read().tokens.find((t) => t.id === tokenId));
  }

  /** Organisation active et son PAT. */
  load(): Credentials | null {
    const d = this.read();
    const url = d.active ?? d.orgs[0]?.orgUrl;
    if (!url) return null;
    const pat = this.patFor(url);
    return pat === null ? null : { orgUrl: url, pat };
  }

  /** Connexion directe (organisation + PAT) : nouveau jeton, organisation ajoutée et active. */
  save(c: Credentials): void {
    const id = this.addToken(`Jeton ${new URL(normOrg(c.orgUrl)).pathname.split('/').filter(Boolean)[0] ?? ''}`.trim(), c.pat);
    this.addOrg(c.orgUrl, id);
    this.setActive(c.orgUrl);
  }

  /** Oublie tout (organisations et jetons). */
  clear(): void {
    rmSync(this.file, { force: true });
  }
}

/** Vérifie le PAT. Azure renvoie parfois une page HTML (203) au lieu d'un 401 : on la traite comme un refus. */
export async function testConnection(ctx: AzureContext): Promise<void> {
  const projects = await ctx.core.getProjects();
  if (!Array.isArray(projects)) throw { statusCode: 401, message: 'Réponse inattendue (page de connexion)' };
}
