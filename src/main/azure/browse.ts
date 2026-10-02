import type { NamedRef } from '../../shared/types';
import { type AzureContext, shortBranch } from './client';

const byName = (a: NamedRef, b: NamedRef) => a.name.localeCompare(b.name);

const PAGE = 100;

export async function listProjects(ctx: AzureContext): Promise<NamedRef[]> {
  const all: NamedRef[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const page = await ctx.core.getProjects(undefined, PAGE, skip);
    all.push(...page.map((p) => ({ id: p.id ?? '', name: p.name ?? '' })));
    if (page.length < PAGE) return all.sort(byName);
  }
}

export async function listRepos(ctx: AzureContext, project: string): Promise<NamedRef[]> {
  const rs = await ctx.git.getRepositories(project);
  return rs.filter((r) => !r.isDisabled).map((r) => ({ id: r.id ?? '', name: r.name ?? '' })).sort(byName);
}

const MAIN_BRANCHES = ['master', 'main'];

export async function listBranches(ctx: AzureContext, project: string, repoId: string): Promise<string[]> {
  const bs = await ctx.git.getBranches(repoId, project);
  const names = bs.map((b) => shortBranch(b.name ?? '')).filter(Boolean);
  const rank = (n: string) => (MAIN_BRANCHES.includes(n) ? MAIN_BRANCHES.indexOf(n) : MAIN_BRANCHES.length);
  return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
