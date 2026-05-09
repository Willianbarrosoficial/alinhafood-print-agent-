import { ThermalPrinter, PrinterTypes } from 'node-thermal-printer';
import { execSync } from 'child_process';
import { execFileSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

export interface PrinterConfig {
  type: 'usb' | 'tcp';
  interface: string;
  model?: string;
  printerName?: string;
}

export interface DetectedPrinter {
  port: string;
  portName: string;
  label: string;
}

/* ─── ESC/POS raw bytes ─── */
const ESC = 0x1B;
const GS  = 0x1D;

function buildTestPageBytes(): Buffer {
  const now = new Date().toLocaleString('pt-BR');
  return Buffer.concat([
    Buffer.from([ESC, 0x40]),             // ESC @ — reset/inicializa
    Buffer.from([ESC, 0x61, 0x01]),       // centralizar
    Buffer.from([ESC, 0x21, 0x10]),       // fonte dupla altura
    Buffer.from('ALINHAFOOD\n', 'latin1'),
    Buffer.from([ESC, 0x21, 0x00]),       // fonte normal
    Buffer.from('Print Agent - Teste\n', 'latin1'),
    Buffer.from('------------------------\n', 'latin1'),
    Buffer.from([ESC, 0x61, 0x00]),       // alinhar esquerda
    Buffer.from(`Data: ${now}\n`, 'latin1'),
    Buffer.from('Impressora funcionando!\n', 'latin1'),
    Buffer.from('------------------------\n', 'latin1'),
    Buffer.from([0x0A, 0x0A, 0x0A]),      // 3 linhas em branco
    Buffer.from([GS, 0x56, 0x00]),        // GS V 0 — corte total
  ]);
}

function buildReceiptBytes(text: string): Buffer {
  return Buffer.concat([
    Buffer.from([ESC, 0x40]),             // reset
    Buffer.from(text + '\n\n\n', 'latin1'),
    Buffer.from([GS, 0x56, 0x00]),        // corte
  ]);
}

/* ─── extrai nome da porta de //./USB001 ou \\.\USB001 → "USB001" ─── */
function extractPortName(devicePath: string): string {
  return devicePath
    .replace(/^[/\\]+\.[/\\]+/, '') // remove //. ou \\.
    .replace(/[/\\]+$/, '');         // remove trailing slashes
}

/* ─── USB: usa print.exe + Windows Spooler (não acesso direto à porta) ───
 * Quando o driver está instalado, o spooler segura a porta e bloqueia
 * escrita direta (acesso negado). print.exe envia via fila de impressão
 * que é o caminho correto. É um utilitário built-in do Windows, não
 * spawna PowerShell (não dispara antivírus).
 *
 * print.exe aceita tanto nome de porta (USB001) quanto nome da impressora
 * (ex: "Epson TM-T20"). Se houver "printerName" preenchido, usa ele
 * (mais confiável); senão usa o nome da porta.
 */
function rawWriteUsb(target: { port: string; printerName?: string }, data: Buffer, timeoutMs = 12000): Promise<void> {
  const targetName = (target.printerName && target.printerName.trim())
    ? target.printerName.trim()
    : extractPortName(target.port);

  console.log('[printer] rawWriteUsb via print.exe → ', JSON.stringify(targetName));

  const tmpFile = path.join(os.tmpdir(), `alf_${Date.now()}.prn`);
  fs.writeFileSync(tmpFile, data);

  return new Promise((resolve, reject) => {
    try {
      // print /D:device file - envia via spooler do Windows
      execFileSync('print.exe', [`/D:${targetName}`, tmpFile], {
        timeout: timeoutMs,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      resolve();
    } catch (err: unknown) {
      const e = err as { stderr?: Buffer; stdout?: Buffer; message?: string };
      const detail = (e?.stderr?.toString() || e?.stdout?.toString() || e?.message || '').trim();
      reject(new Error(`Falha ao imprimir em "${targetName}": ${detail || 'spooler indisponível'}`));
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignora */ }
    }
  });
}

/* ─── TCP: escreve raw via net.Socket ─── */
function rawWriteTcp(hostport: string, data: Buffer, timeoutMs = 6000): Promise<void> {
  return new Promise((resolve, reject) => {
    const [host, portStr] = hostport.split(':');
    const port = parseInt(portStr ?? '9100', 10);

    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timeout ao conectar em ' + hostport));
    }, timeoutMs);

    socket.connect(port, host, () => {
      socket.write(data, (err) => {
        clearTimeout(timer);
        socket.destroy();
        if (err) reject(err);
        else resolve();
      });
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/* ─── API pública ─── */

export async function printTestPage(config: PrinterConfig): Promise<void> {
  const data = buildTestPageBytes();
  if (config.type === 'tcp') {
    await rawWriteTcp(config.interface, data);
  } else {
    await rawWriteUsb({ port: config.interface, printerName: config.printerName }, data);
  }
}

export async function printReceipt(text: string, config: PrinterConfig, copies = 1): Promise<void> {
  const data = buildReceiptBytes(text);

  for (let i = 0; i < copies; i++) {
    if (config.type === 'tcp') {
      // TCP: tenta node-thermal-printer (melhor formatação), fallback raw
      try {
        await printViaThermal(text, config, 1);
      } catch {
        await rawWriteTcp(config.interface, data);
      }
    } else {
      // USB: via print.exe + spooler do Windows
      await rawWriteUsb({ port: config.interface, printerName: config.printerName }, data);
    }
    if (i < copies - 1) await new Promise(r => setTimeout(r, 600));
  }
}

function getPrinterType(model?: string): PrinterTypes {
  switch (model) {
    case 'star':   return PrinterTypes.STAR;
    case 'tanca':  return PrinterTypes.TANCA;
    case 'daruma': return PrinterTypes.DARUMA;
    default:       return PrinterTypes.EPSON;
  }
}

async function printViaThermal(text: string, config: PrinterConfig, copies: number): Promise<void> {
  // Para USB, node-thermal-printer sofre do mesmo problema do libuv com device paths.
  // Só usa para TCP onde não há esse problema.
  if (config.type === 'usb') throw new Error('USB usa raw path — usar rawWriteUsb');
  const printer = new ThermalPrinter({
    type: getPrinterType(config.model),
    interface: config.interface,
    removeSpecialCharacters: false,
    lineCharacter: '-',
    options: { timeout: 5000 },
  });

  const isConnected = await printer.isPrinterConnected();
  if (!isConnected) throw new Error('isPrinterConnected retornou false');

  for (let copy = 0; copy < copies; copy++) {
    for (const line of text.split('\n')) {
      printer.println(line);
    }
    printer.cut();
    await printer.execute();
    printer.clear();
    if (copy < copies - 1) await new Promise(r => setTimeout(r, 600));
  }
}

/* ─── Detecção USB no Windows ─── */

interface RawPrinter { name: string; portName: string }

function detectViaWmic(): RawPrinter[] {
  try {
    const out = execSync('wmic printer get name,portname /format:csv', {
      encoding: 'utf8', timeout: 6000, windowsHide: true,
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
  } catch { return []; }
}

function probeUsbPort(portNum: number): boolean {
  const portName = `USB${String(portNum).padStart(3, '0')}`;
  try {
    const fd = fs.openSync(`\\\\.\\${portName}`, 'w');
    fs.closeSync(fd);
    return true;
  } catch { return false; }
}

export function detectUsbPrinters(): DetectedPrinter[] {
  const result: DetectedPrinter[] = [];
  const seen = new Set<string>();

  for (const p of detectViaWmic()) {
    if (seen.has(p.portName)) continue;
    seen.add(p.portName);
    result.push({ port: `//./${p.portName}`, portName: p.portName, label: `${p.name} — ${p.portName}` });
  }

  for (let i = 1; i <= 5; i++) {
    const pn = `USB${String(i).padStart(3, '0')}`;
    if (seen.has(pn)) continue;
    if (probeUsbPort(i)) {
      seen.add(pn);
      result.push({ port: `//./${pn}`, portName: pn, label: `${pn} — detectada sem driver Windows` });
    }
  }

  if (result.length === 0) {
    for (const pn of ['USB001', 'USB002', 'USB003']) {
      result.push({ port: `//./${pn}`, portName: pn, label: `${pn} — tente esta porta` });
    }
  }

  return result;
}
