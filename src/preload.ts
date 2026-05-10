import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('save-config', config),
  testPrinter: (config: { type: string; interface: string; model: string; printerName?: string }) =>
    ipcRenderer.invoke('test-printer', config),
  detectUsbPrinters: () => ipcRenderer.invoke('detect-usb-printers'),
  detectWindowsPrinters: () => ipcRenderer.invoke('detect-windows-printers'),
  detectSerialPorts: () => ipcRenderer.invoke('detect-serial-ports'),
  clearConfig: () => ipcRenderer.invoke('clear-config'),
  onStatus: (cb: (status: string, message: string) => void) => {
    ipcRenderer.on('status-update', (_e, status: string, message: string) => cb(status, message));
  },
});
