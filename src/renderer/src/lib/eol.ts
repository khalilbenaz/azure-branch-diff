import { diffLines } from 'diff';

const lf = (s: string) => s.replace(/\r\n/g, '\n');

/** Vrai si les deux textes ne diffèrent que par leurs fins de ligne (CRLF / LF). */
export function isEolOnlyDiff(a: string, b: string): boolean {
  return a !== b && lf(a) === lf(b);
}

export function countLines(before: string, after: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const part of diffLines(lf(before), lf(after))) {
    if (part.added) added += part.count ?? 0;
    else if (part.removed) removed += part.count ?? 0;
  }
  return { added, removed };
}

const LANGUAGES: Record<string, string> = {
  cs: 'csharp',
  sql: 'sql',
  xml: 'xml',
  config: 'xml',
  csproj: 'xml',
  props: 'xml',
  targets: 'xml',
  resx: 'xml',
  xaml: 'xml',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  html: 'html',
  cshtml: 'razor',
  razor: 'razor',
  css: 'css',
  scss: 'scss',
  ps1: 'powershell',
  sh: 'shell',
  ini: 'ini',
  py: 'python',
  java: 'java',
};

export function languageFor(path: string): string {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'plaintext';
  return LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? 'plaintext';
}
