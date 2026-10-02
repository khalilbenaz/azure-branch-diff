import type { ChangeEntry, ChangeType } from '../../shared/types';

/** Forme minimale d'un GitChange renvoyé par getCommitDiffs. */
export interface AzureChange {
  changeType: number;
  item?: { path?: string; gitObjectType?: number | string; isFolder?: boolean };
  originalPath?: string;
  sourceServerItem?: string;
}

// VersionControlChangeType (flags) : Add=1, Edit=2, Rename=8, Delete=16. GitObjectType.Tree = 2.
const ADD = 1;
const RENAME = 8;
const DELETE = 16;
const TREE = 2;

const stripSlash = (p?: string) => (p ?? '').replace(/^\/+/, '');

function kindOf(flags: number): ChangeType {
  if (flags & RENAME) return 'rename';
  if (flags & DELETE) return 'delete';
  if (flags & ADD) return 'add';
  return 'edit';
}

export function fromAzureDiff(changes: AzureChange[]): ChangeEntry[] {
  return changes
    // GitChange.item n'est pas typé par le SDK : gitObjectType arrive en chaîne ('tree') depuis l'API.
    .filter((c) => c.item?.path && !c.item.isFolder && c.item.gitObjectType !== TREE && c.item.gitObjectType !== 'tree')
    .map((c): ChangeEntry => {
      const change = kindOf(c.changeType);
      const original = c.sourceServerItem ?? c.originalPath;
      return {
        path: stripSlash(c.item!.path),
        change,
        isBinary: false,
        ...(change === 'rename' && original ? { originalPath: stripSlash(original) } : {}),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}
