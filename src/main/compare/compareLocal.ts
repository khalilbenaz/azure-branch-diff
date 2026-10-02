import { lstat, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChangeEntry } from '../../shared/types';
import { hashLocalFiles } from '../local/hashFiles';
import { listLocalFiles } from '../local/listFiles';

export interface RemoteItem {
  path: string;
  objectId: string;
}

/** Même heuristique que git : un octet nul dans les 8000 premiers octets. */
export const isBinaryBuffer = (b: Buffer) => b.subarray(0, 8000).includes(0);

async function sniff(file: string): Promise<{ isBinary: boolean; sizeBytes: number }> {
  // Un lien symbolique n'est jamais suivi (il pourrait pointer hors du dossier).
  if ((await lstat(file)).isSymbolicLink()) return { isBinary: false, sizeBytes: 0 };
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(8000);
    const { bytesRead } = await fh.read(buf, 0, 8000, 0);
    return { isBinary: isBinaryBuffer(buf.subarray(0, bytesRead)), sizeBytes: (await stat(file)).size };
  } finally {
    await fh.close();
  }
}

/** Compare un dossier local à l'arbre d'une branche Azure, par SHA blob (sans télécharger les fichiers inchangés). */
export async function compareLocalToAzure(root: string, remote: RemoteItem[]): Promise<ChangeEntry[]> {
  const remoteSha = new Map(remote.map((r) => [r.path, r.objectId]));
  const localSha = await hashLocalFiles(root, await listLocalFiles(root));
  const out: ChangeEntry[] = [];
  for (const [path, sha] of localSha) {
    const remoteId = remoteSha.get(path);
    if (remoteId === sha) continue;
    out.push({ path, change: remoteId ? 'edit' : 'add', ...(await sniff(join(root, path))) });
  }
  for (const r of remote) if (!localSha.has(r.path)) out.push({ path: r.path, change: 'delete', isBinary: false });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
