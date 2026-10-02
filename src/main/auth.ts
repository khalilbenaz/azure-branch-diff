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

/** PAT chiffré par le trousseau système (Keychain / DPAPI), jamais écrit en clair. */
export class AuthStore {
  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {}

  save(c: Credentials): void {
    if (!this.cipher.isAvailable()) throw new Error('Chiffrement système indisponible : le PAT ne peut pas être enregistré.');
    const data = { orgUrl: c.orgUrl, pat: this.cipher.encrypt(c.pat).toString('base64') };
    writeFileSync(this.file, JSON.stringify(data), { mode: 0o600 });
  }

  load(): Credentials | null {
    try {
      if (!existsSync(this.file)) return null;
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as { orgUrl: string; pat: string };
      return { orgUrl: j.orgUrl, pat: this.cipher.decrypt(Buffer.from(j.pat, 'base64')) };
    } catch {
      return null;
    }
  }

  clear(): void {
    rmSync(this.file, { force: true });
  }
}

/** Vérifie le PAT. Azure renvoie parfois une page HTML (203) au lieu d'un 401 : on la traite comme un refus. */
export async function testConnection(ctx: AzureContext): Promise<void> {
  const projects = await ctx.core.getProjects();
  if (!Array.isArray(projects)) throw { statusCode: 401, message: 'Réponse inattendue (page de connexion)' };
}
