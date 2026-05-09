import { ThermalPrinter, PrinterTypes } from 'node-thermal-printer';
import { execSync } from 'child_process';
import fs from 'fs';

export interface PrinterConfig {
  type: 'usb' | 'tcp';
  interface: string;
  model?: string;
}

export interface DetectedPrinter {
  port: string;
  portName: string;
  label: string;
}

function getPrinterType(model?: string): PrinterTypes {
  switch (model) {
    case 'star':   return PrinterTypes.STAR;
    case 'tanca':  return PrinterTypes.TANCA;
    case 'daruma': return PrinterTypes.DARUMA;
    default:       return PrinterTypes.EPSON;
  }
}

function buildPrinter(config: PrinterConfig): ThermalPrinter {
  return new ThermalPrinter({
    type: getPrinterType(config.model),
    interface: config.interface,
    removeSpecialCharacters: false,
    lineCharacter: '-',
    options: { timeout: 5000 },
  });
}

export async function printReceipt(text: string, config: PrinterConfig, copies = 1): Promise<void> {
  const printer = buildPrinter(config);

  const isConnected = await printer.isPrinterConnected();
  if (!isConnected) {
    throw new Error(
      'Impressora não encontrada. Verifique se está ligada e conectada, ' +
      'depois tente os botões "Detectar USB" ou "Testar impressora".'
    );
  }

  for (let copy = 0; copy < copies; copy++) {
    for (const line of text.split('\n')) {
      printer.println(line);
    }
    printer.cut();
    await printer.execute();
    printer.clear();

    if (copy < copies - 1) {
      await new Promise(r => setTimeout(r, 600));
    }
  }
}

export async function testConnection(config: PrinterConfig): Promise<boolean> {
  const printer = new ThermalPrinter({
    type: getPrinterType(config.model),
    interface: config.interface,
    options: { timeout: 4000 },
  });
  return printer.isPrinterConnected();
}

export function detectUsbPrinters(): DetectedPrinter[] {
  const found: DetectedPrinter[] = [];
  const seenPorts = new Set<string>();

  // 1. WMI: lista impressoras instaladas no Windows com porta USB
  try {
    const out = execSync('wmic printer get name,portname /format:csv', {
      encoding: 'utf8',
      timeout: 6000,
      windowsHide: true,
    });

    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split(',');
      if (parts.length < 3) continue;
      const name = parts[1]?.trim() ?? '';
      const portName = parts[2]?.trim() ?? '';
      if (!portName || portName === 'PortName' || !/^USB\d+$/i.test(portName)) continue;

      const upper = portName.toUpperCase();
      seenPorts.add(upper);
      found.push({
        port: `//./${upper}`,
        portName: upper,
        label: `${name} — ${upper}`,
      });
    }
  } catch {
    // WMI indisponível
  }

  // 2. Probe direto: tenta abrir USB001–USB005 como arquivo de dispositivo
  for (let i = 1; i <= 5; i++) {
    const pn = `USB${String(i).padStart(3, '0')}`;
    if (seenPorts.has(pn)) continue;

    try {
      // \\.\ é o prefixo de device path no Windows
      const fd = fs.openSync(`\\\\.\\${pn}`, 'w');
      fs.closeSync(fd);
      found.push({
        port: `//./${pn}`,
        portName: pn,
        label: `${pn} — impressora detectada (sem driver Windows)`,
      });
      seenPorts.add(pn);
    } catch {
      // Porta não disponível
    }
  }

  // 3. Se nada encontrado, sempre sugere USB001/002/003 como ponto de partida
  if (found.length === 0) {
    for (const pn of ['USB001', 'USB002', 'USB003']) {
      found.push({
        port: `//./${pn}`,
        portName: pn,
        label: `${pn} — tente esta porta (use "Testar" para confirmar)`,
      });
    }
  }

  return found;
}
