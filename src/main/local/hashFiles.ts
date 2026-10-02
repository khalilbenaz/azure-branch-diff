import { lstat, readFile, readlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { blobSha } from './blobSha';
import { autocrlf, hasLocalFilters, insideGitRepo, safeGitArgs } from './safeGit';

/** `git hash-object --stdin-paths` : chemins sur l'entrée standard, pas de limite de ligne de commande, pas de shell. */
function gitHashPaths(root: string, paths: string[]): Promise<string[]> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', safeGitArgs(['hash-object', '--stdin-paths']), { cwd: root, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      const shas = out.trim().split(/\r?\n/);
      if (code === 0 && shas.length === paths.length) resolvePromise(shas);
      else reject(new Error(err.trim() || `git hash-object: ${code}`));
    });
    child.stdin.end(paths.join('\n') + '\n');
  });
}

const isText = (b: Buffer) => !b.subarray(0, 8000).includes(0);

/** Calcul direct, avec la normalisation de fin de ligne qu'appliquerait git (core.autocrlf true/input). */
async function hashDirect(root: string, p: string, normalizeEol: boolean): Promise<string> {
  let buf = await readFile(join(root, p));
  if (normalizeEol && isText(buf) && buf.includes(13)) buf = Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return blobSha(buf);
}

/**
 * SHA blob de chaque fichier régulier (ou lien symbolique). Dossiers, sous-modules et entrées illisibles sont ignorés.
 * Dans un dépôt git sans filtre local, `git hash-object` applique les règles du dépôt (autocrlf, .gitattributes) :
 * un fichier CRLF sur disque a alors le même SHA que le blob LF stocké sur Azure.
 * Si la config locale déclare des filtres (commandes arbitraires), on ne les exécute pas : calcul direct.
 */
export async function hashLocalFiles(root: string, paths: string[]): Promise<Map<string, string>> {
  const files: string[] = [];
  const links: string[] = [];
  for (const p of paths) {
    try {
      const st = await lstat(join(root, p));
      if (st.isFile()) files.push(p);
      else if (st.isSymbolicLink()) links.push(p);
    } catch {
      /* absent ou illisible */
    }
  }
  const out = new Map<string, string>();
  // Git stocke un lien symbolique comme un blob contenant sa cible.
  for (const p of links) out.set(p, blobSha(Buffer.from(await readlink(join(root, p)))));
  const sorted = () => new Map([...out].sort(([a], [b]) => a.localeCompare(b)));

  const inRepo = files.length > 0 && (await insideGitRepo(root));
  const normalizeEol = inRepo && ['true', 'input'].includes(await autocrlf(root));
  if (inRepo && !(await hasLocalFilters(root))) {
    // Un nom contenant un saut de ligne casserait --stdin-paths : il est calculé à part.
    const plain = files.filter((p) => !p.includes('\n'));
    try {
      const shas = await gitHashPaths(root, plain);
      plain.forEach((p, i) => out.set(p, shas[i]));
      for (const p of files.filter((f) => f.includes('\n'))) out.set(p, await hashDirect(root, p, normalizeEol));
      return sorted();
    } catch {
      /* git indisponible ou fichier illisible : repli sur le calcul direct */
    }
  }
  for (const p of files) {
    try {
      out.set(p, await hashDirect(root, p, normalizeEol));
    } catch {
      /* illisible : ignoré */
    }
  }
  return sorted();
}
