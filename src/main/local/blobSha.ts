import { createHash } from 'node:crypto';

/** SHA-1 d'un blob git : identique à `git hash-object` et à l'objectId Azure. */
export function blobSha(buf: Buffer): string {
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}
