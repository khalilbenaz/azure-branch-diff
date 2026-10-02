import { gitOutput, insideGitRepo } from './safeGit';

export interface GitInfo {
  branch: string;
  commit: string;
  subject: string;
}

export async function getGitInfo(root: string): Promise<GitInfo | null> {
  try {
    if (!(await insideGitRepo(root))) return null;
    const branch = (await gitOutput(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    const [commit = '', subject = ''] = (await gitOutput(root, ['log', '-1', '--format=%H%x00%s'])).trim().split('\0');
    return { branch, commit, subject };
  } catch {
    return null;
  }
}
