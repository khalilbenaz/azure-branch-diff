import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, constants, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

/** Fichier d'une version, tel que listé par latest-mac.yml (electron-updater). */
export interface UpdateFile {
  url: string;
  sha512: string;
  size?: number;
}

export interface MacInstallerDeps {
  /** process.arch : choisit le zip arm64 ou x64. */
  arch: string;
  /** Bundle de l'app en cours (…/Azure Branch Diff.app). */
  bundlePath: string;
  bundleId: string;
  tmpDir: string;
  /** « propriétaire/dépôt » GitHub. */
  repo: string;
  pid: number;
  fetch(url: string): Promise<Response>;
  /** execFile sans shell ; rejette si la commande échoue. */
  run(cmd: string, args: string[]): Promise<string>;
  /** Lance un processus détaché qui survit à l'app. */
  spawnDetached(cmd: string, args: string[]): void;
  quit(): void;
}

export interface MacInstaller {
  /** Télécharge, vérifie (SHA-512, identifiant, version, signature) et prépare la nouvelle version. */
  download(info: { version: string; files?: UpdateFile[] }, progress: (percent: number) => void): Promise<void>;
  /** Remplace l'app dès qu'elle est fermée. false : remplacement impossible (dossier non modifiable). */
  install(relaunch: boolean): Promise<boolean>;
  staged(): string | null;
}

/**
 * Remplacement du bundle, exécuté après la fermeture de l'app (arguments, jamais interpolés) :
 * $1 pid de l'app, $2 bundle installé, $3 nouveau bundle, $4 « 1 » pour relancer.
 * En cas d'échec, l'ancienne version est remise en place.
 */
export const SWAP_SCRIPT = `#!/bin/sh
pid="$1"; target="$2"; new="$3"; relaunch="$4"
case "$target" in /*.app) ;; *) exit 1 ;; esac
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1)); [ "$i" -gt 600 ] && exit 1
  sleep 0.2
done
bak="$target.abd-previous"
rm -rf "$bak"
mv "$target" "$bak" || exit 1
if mv "$new" "$target"; then rm -rf "$bak"; else mv "$bak" "$target"; fi
[ "$relaunch" = "1" ] && open "$target"
exit 0
`;

const VERSION = /^\d+\.\d+\.\d+$/;
const ZIP_NAME = /^[A-Za-z0-9._-]+\.zip$/;

/** Zip de l'architecture courante parmi les fichiers de la version. */
export function pickZip(files: UpdateFile[] | undefined, arch: string): UpdateFile {
  const tag = arch === 'arm64' ? 'arm64' : 'x64';
  const f = (files ?? []).find((x) => ZIP_NAME.test(x.url) && x.url.includes(`mac-${tag}`));
  if (!f || !f.sha512) throw new Error(`Aucune archive macOS ${tag} dans la version.`);
  return f;
}

/**
 * Exigence de signature de l'app installée, si elle est signée par un certificat
 * (« identifier … and certificate root = H"…" »). Signature ad hoc : null (rien à imposer).
 */
export async function designatedRequirement(d: Pick<MacInstallerDeps, 'run'>, bundle: string): Promise<string | null> {
  // codesign écrit cette information sur stderr : « -r- » la renvoie sur stdout.
  const out = await d.run('/usr/bin/codesign', ['-d', '-r-', bundle]).catch(() => '');
  const m = /designated => (.+)/.exec(out);
  const req = m?.[1].trim() ?? '';
  return /certificate (root|leaf) = H"[0-9a-f]{40}"/.test(req) ? req : null;
}

export function createMacInstaller(d: MacInstallerDeps): MacInstaller {
  if (!isAbsolute(d.bundlePath) || !d.bundlePath.endsWith('.app')) throw new Error('Emplacement de l’app inattendu.');
  let ready: { app: string; dir: string } | null = null;

  return {
    staged: () => ready?.app ?? null,

    async download(info, progress) {
      if (!VERSION.test(info.version)) throw new Error('Version invalide.');
      const file = pickZip(info.files, d.arch);
      const dir = await mkdtemp(join(d.tmpDir, 'abd-update-'));
      const zip = join(dir, 'update.zip');

      const res = await d.fetch(`https://github.com/${d.repo}/releases/download/v${info.version}/${file.url}`);
      if (!res.ok || !res.body) throw new Error(`Téléchargement refusé (HTTP ${res.status}).`);
      const total = Number(res.headers.get('content-length')) || file.size || 0;
      const hash = createHash('sha512');
      const out = createWriteStream(zip);
      let received = 0;
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          hash.update(chunk);
          received += chunk.length;
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          if (total) progress(Math.min(99, Math.round((received / total) * 100)));
        }
      } finally {
        await new Promise<void>((r) => out.end(r));
      }
      if (hash.digest('base64') !== file.sha512) throw new Error('Empreinte SHA-512 différente : mise à jour refusée.');

      const unpacked = join(dir, 'app');
      await d.run('/usr/bin/ditto', ['-x', '-k', zip, unpacked]);
      const app = join(unpacked, basename(d.bundlePath));
      const plist = join(app, 'Contents', 'Info');
      const id = (await d.run('/usr/bin/defaults', ['read', plist, 'CFBundleIdentifier'])).trim();
      const version = (await d.run('/usr/bin/defaults', ['read', plist, 'CFBundleShortVersionString'])).trim();
      if (id !== d.bundleId) throw new Error('Identifiant d’application inattendu : mise à jour refusée.');
      if (version !== info.version) throw new Error('Numéro de version inattendu : mise à jour refusée.');
      await d.run('/usr/bin/codesign', ['--verify', '--deep', app]);
      // App signée par le certificat du projet : la mise à jour doit l'être par le même certificat.
      const req = await designatedRequirement(d, d.bundlePath);
      if (req) await d.run('/usr/bin/codesign', ['--verify', '--deep', `-R=${req}`, app]);
      await d.run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', app]).catch(() => '');
      progress(100);
      ready = { app, dir };
    },

    async install(relaunch) {
      if (!ready) return false;
      try {
        await access(dirname(d.bundlePath), constants.W_OK);
        await access(d.bundlePath, constants.W_OK);
      } catch {
        return false; // ex. app lancée depuis le .dmg, ou /Applications non modifiable
      }
      const script = join(ready.dir, 'swap.sh');
      await writeFile(script, SWAP_SCRIPT, { mode: 0o700 });
      d.spawnDetached('/bin/sh', [script, String(d.pid), d.bundlePath, ready.app, relaunch ? '1' : '0']);
      ready = null; // une seule installation
      if (relaunch) d.quit();
      return true;
    },
  };
}

/** Restes de téléchargements précédents (zip et bundle décompressé) : supprimés au démarrage. */
export async function cleanupUpdateDirs(tmpDir: string): Promise<void> {
  const names = await readdir(tmpDir).catch(() => [] as string[]);
  await Promise.all(
    names.filter((n) => /^abd-update-[A-Za-z0-9]{6}$/.test(n)).map((n) => rm(join(tmpDir, n), { recursive: true, force: true }).catch(() => {})),
  );
}
