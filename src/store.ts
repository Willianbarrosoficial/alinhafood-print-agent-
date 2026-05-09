import Store from 'electron-store';

interface StoreSchema {
  apiUrl: string;
  agentToken: string;
  printerType: 'usb' | 'tcp';
  printerInterface: string;
  printerName: string;
  autoStart: boolean;
}

export const store = new Store<StoreSchema>({
  name: 'alinhafood-print-agent',
  defaults: {
    apiUrl: '',
    agentToken: '',
    printerType: 'usb',
    printerInterface: '',
    printerName: '',
    autoStart: true,
  },
});
