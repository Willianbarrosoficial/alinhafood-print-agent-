import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('save-config', config),
  testPrinter: () => ipcRenderer.invoke('test-printer'),
  onStatus: (cb: (status: string, message: string) => void) => {
    ipcRenderer.on('status-update', (_e, status: string, message: string) => cb(status, message));
  },
});
