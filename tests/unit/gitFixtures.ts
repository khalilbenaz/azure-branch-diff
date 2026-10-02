import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers';

/** git sans shell ; renvoie la sortie standard. */
export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
}

export function writeFile(dir: string, path: string, content: string | Buffer) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

export function commitFile(dir: string, path: string, content: string | Buffer, msg = `edit ${path}`) {
  writeFile(dir, path, content);
  git(dir, 'add', '--', path);
  git(dir, 'commit', '-q', '-m', msg);
}

function identity(dir: string) {
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

/**
 * Dépôt « origin » nu + clone :
 *  master : src/Service.cs (v1), README.md
 *  feature/data : Service.cs modifié + src/Data.cs ajouté
 * Les deux branches sont poussées ; le clone est sur master.
 */
export function makeOrigin(): { bare: string; clone: string } {
  const bare = tempDir();
  git(bare, 'init', '-q', '--bare', '-b', 'master');
  const seed = tempDir();
  git(seed, 'init', '-q', '-b', 'master');
  identity(seed);
  commitFile(seed, 'src/Service.cs', 'class Service\n{\n    int Amount = 10;\n}\n', 'init');
  commitFile(seed, 'README.md', '# Demo\n', 'readme');
  git(seed, 'remote', 'add', 'origin', bare);
  git(seed, 'push', '-q', 'origin', 'master');
  git(seed, 'checkout', '-q', '-b', 'feature/data');
  commitFile(seed, 'src/Service.cs', 'class Service\n{\n    int Amount = 30;\n}\n', 'feature change');
  commitFile(seed, 'src/Data.cs', 'class Data {}\n', 'add data');
  git(seed, 'push', '-q', 'origin', 'feature/data');
  const parent = tempDir();
  git(parent, 'clone', '-q', bare, 'clone');
  const clone = join(parent, 'clone');
  identity(clone);
  return { bare, clone };
}

/**
 * Fait passer le clone pour un clone Azure (origin = https://dev.azure.com/X/Demo/_git/Gateway) tout en poussant
 * vers le dépôt nu local : réécriture d'URL dans une config git *globale* de test (refusée si elle était locale).
 * Renvoie une fonction qui restaure l'environnement.
 */
export function azureOrigin(clone: string, bare: string): () => void {
  const url = 'https://dev.azure.com/X/Demo/_git/Gateway';
  git(clone, 'remote', 'set-url', 'origin', url);
  const cfg = join(tempDir(), 'gitconfig');
  // Dans un fichier de config git, « \\ » est un échappement : chemin Windows écrit avec des « / ».
  writeFileSync(cfg, `[url "${bare.replace(/\\/g, '/')}"]\n\tinsteadOf = ${url}\n[protocol "file"]\n\tallow = always\n`);
  const before = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = cfg;
  return () => {
    if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = before;
  };
}
