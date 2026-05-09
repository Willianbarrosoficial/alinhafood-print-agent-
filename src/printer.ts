import { ThermalPrinter, PrinterTypes } from 'node-thermal-printer';

export interface PrinterConfig {
  type: 'usb' | 'tcp';
  interface: string;
}

export async function printReceipt(text: string, config: PrinterConfig, copies = 1): Promise<void> {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: config.interface,
    removeSpecialCharacters: false,
    lineCharacter: '-',
    options: {
      timeout: 5000,
    },
  });

  const isConnected = await printer.isPrinterConnected();
  if (!isConnected) {
    throw new Error('Impressora não encontrada ou não conectada. Verifique a conexão USB ou IP de rede.');
  }

  for (let copy = 0; copy < copies; copy++) {
    for (const line of text.split('\n')) {
      printer.println(line);
    }
    printer.cut();
    await printer.execute();
    printer.clear();

    if (copy < copies - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

export async function testConnection(config: PrinterConfig): Promise<boolean> {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: config.interface,
    options: { timeout: 3000 },
  });
  return printer.isPrinterConnected();
}
