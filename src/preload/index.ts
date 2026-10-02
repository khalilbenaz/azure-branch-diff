import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { API_METHODS } from '../shared/api';
import type { UpdateState } from '../shared/types';

const api = Object.fromEntries(API_METHODS.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`api:${m}`, ...args)]));

contextBridge.exposeInMainWorld('api', api);

contextBridge.exposeInMainWorld('updates', {
  get: (): Promise<{ state: UpdateState; version: string }> => ipcRenderer.invoke('update:get'),
  check: (): Promise<void> => ipcRenderer.invoke('update:check'),
  install: (): Promise<void> => ipcRenderer.invoke('update:install'),
  /** Abonnement aux changements d'état ; renvoie la fonction de désabonnement. */
  onState(cb: (s: UpdateState) => void): () => void {
    const listener = (_e: IpcRendererEvent, s: UpdateState) => cb(s);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },
});

contextBridge.exposeInMainWorld('theme', {
  get: (): Promise<'system' | 'light' | 'dark'> => ipcRenderer.invoke('theme:get'),
  set: (t: 'system' | 'light' | 'dark'): Promise<'system' | 'light' | 'dark'> => ipcRenderer.invoke('theme:set', t),
});
