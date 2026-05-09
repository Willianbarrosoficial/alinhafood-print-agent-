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

/* ───── Detecção USB no Windows ───── */

interface RawPrinter { name: string; portName: string }

function detectViaPowerShell(): RawPrinter[] {
  try {
    // Get-Printer é nativo no Windows 8+, mais confiável que WMIC (que está deprecado no Win11)
    const cmd =
      'powershell.exe -NoProfile -NonInteractive -Command ' +
      '"Get-Printer | Where-Object { $_.PortName -match \'^USB\' } | ' +
      'Select-Object Name,PortName | ConvertTo-Json -Compress"';

    const out = execSync(cmd, { encoding: 'utf8', timeout: 8000, windowsHide: true }).trim();
    if (!out) return [];

    const parsed = JSON.parse(out);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr
      .filter((p: any) => p && p.PortName && p.Name)
      .map((p: any) => ({ name: String(p.Name), portName: String(p.PortName).toUpperCase() }));
  } catch {
    return [];
  }
}

function detectViaWmic(): RawPrinter[] {
  try {
    const out = execSync('wmic printer get name,portname /format:csv', {
      encoding: 'utf8',
      timeout: 6000,
      windowsHide: true,
    });

    const found: RawPrinter[] = [];
    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split(',');
      if (parts.length < 3) continue;
      const name = parts[1]?.trim() ?? '';
      const portName = parts[2]?.trim() ?? '';
      if (!portName || portName === 'PortName' || !/^USB\d+$/i.test(portName)) continue;
      found.push({ name, portName: portName.toUpperCase() });
    }
    return found;
  } catch {
    return [];
  }
}

function probeUsbPort(portNum: number): boolean {
  const portName = `USB${String(portNum).padStart(3, '0')}`;
  try {
    const fd = fs.openSync(`\\\\.\\${portName}`, 'w');
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

export function detectUsbPrinters(): DetectedPrinter[] {
  const result: DetectedPrinter[] = [];
  const seen = new Set<string>();

  // 1. PowerShell (Windows 8+)
  for (const p of detectViaPowerShell()) {
    if (seen.has(p.portName)) continue;
    seen.add(p.portName);
    result.push({
      port: `//./${p.portName}`,
      portName: p.portName,
      label: `${p.name} — ${p.portName}`,
    });
  }

  // 2. WMIC (fallback p/ Windows mais antigo)
  if (result.length === 0) {
    for (const p of detectViaWmic()) {
      if (seen.has(p.portName)) continue;
      seen.add(p.portName);
      result.push({
        port: `//./${p.portName}`,
        portName: p.portName,
        label: `${p.name} — ${p.portName}`,
      });
    }
  }

  // 3. Probe direto: testa USB001-005 mesmo sem driver Windows
  for (let i = 1; i <= 5; i++) {
    const portName = `USB${String(i).padStart(3, '0')}`;
    if (seen.has(portName)) continue;
    if (probeUsbPort(i)) {
      seen.add(portName);
      result.push({
        port: `//./${portName}`,
        portName,
        label: `${portName} — impressora detectada (sem driver Windows)`,
      });
    }
  }

  // 4. Sem nada encontrado: sempre sugere USB001/002/003 como pontos de partida
  if (result.length === 0) {
    for (const portName of ['USB001', 'USB002', 'USB003']) {
      result.push({
        port: `//./${portName}`,
        portName,
        label: `${portName} — tente esta porta (use "Testar" para confirmar)`,
      });
    }
  }

  return result;
}
