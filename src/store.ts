import Store from 'electron-store';

interface StoreSchema {
  apiUrl: string;
  agentToken: string;
  printerType: 'usb' | 'windows' | 'serial' | 'tcp';
  printerInterface: string;
  printerName: string;
  printerModel: 'epson' | 'star' | 'tanca' | 'daruma';
  autoStart: boolean;
}

export const store = new Store<StoreSchema>({
  name: 'alinhafood-print-agent',
  defaults: {
    apiUrl: '',
    agentToken: '',
    printerType: 'windows',
    printerInterface: '',
    printerName: '',
    printerModel: 'epson',
    autoStart: true,
  },
});
