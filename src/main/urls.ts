/** Lien ouvrable dans le navigateur : URL valide, https, sans identifiants intégrés. */
export function isSafeExternalUrl(url: string): boolean {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}
