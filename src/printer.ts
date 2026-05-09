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
    .replace(/^[/\\]+\.[/\\]+/, '')
    .replace(/[/\\]+$/, '');
}

/* ─── USB via Windows Spooler com tipo RAW (ESC/POS passa sem modificação) ───
 *
 * print.exe trata o arquivo como texto e corrompe bytes binários ESC/POS.
 * A solução correta é usar a Win32 Spooler API com pDataType="RAW":
 * OpenPrinter → StartDocPrinter(RAW) → WritePrinter → EndDocPrinter.
 * O script PS1 é escrito em disco (não inline) para evitar falso positivo de AV.
 * Fallback automático para print.exe se PowerShell for bloqueado.
 */
function rawWriteUsbRaw(printerName: string, data: Buffer, timeoutMs = 15000): Promise<void> {
  const ts = Date.now();
  const tmpData   = path.join(os.tmpdir(), `alf_${ts}.prn`);
  const tmpScript = path.join(os.tmpdir(), `alf_${ts}.ps1`);

  fs.writeFileSync(tmpData, data);

  // Script usa Win32 P/Invoke via Add-Type — envia bytes RAW sem processamento pelo driver
  const script = [
    `param([string]$P,[string]$F)`,
    `Add-Type -TypeDefinition @'`,
    `using System;using System.Runtime.InteropServices;`,
    `[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Ansi)]`,
    `public class DI{`,
    `  [MarshalAs(UnmanagedType.LPStr)]public string pDocName;`,
    `  [MarshalAs(UnmanagedType.LPStr)]public string pOutputFile;`,
    `  [MarshalAs(UnmanagedType.LPStr)]public string pDataType;}`,
    `public class WP{`,
    `  [DllImport("winspool.Drv",SetLastError=true,CharSet=CharSet.Ansi)]public static extern bool OpenPrinter(string n,out IntPtr h,IntPtr d);`,
    `  [DllImport("winspool.Drv",SetLastError=true)]public static extern bool ClosePrinter(IntPtr h);`,
    `  [DllImport("winspool.Drv",SetLastError=true,CharSet=CharSet.Ansi)]public static extern int StartDocPrinter(IntPtr h,Int32 l,[In,MarshalAs(UnmanagedType.LPStruct)]DI d);`,
    `  [DllImport("winspool.Drv",SetLastError=true)]public static extern bool EndDocPrinter(IntPtr h);`,
    `  [DllImport("winspool.Drv",SetLastError=true)]public static extern bool StartPagePrinter(IntPtr h);`,
    `  [DllImport("winspool.Drv",SetLastError=true)]public static extern bool EndPagePrinter(IntPtr h);`,
    `  [DllImport("winspool.Drv",SetLastError=true)]public static extern bool WritePrinter(IntPtr h,IntPtr b,Int32 n,out Int32 w);}`,
    `'@`,
    `$b=[System.IO.File]::ReadAllBytes($F)`,
    `$h=[IntPtr]::Zero`,
    `$d=New-Object DI;$d.pDocName="ALF";$d.pDataType="RAW"`,
    `if(![WP]::OpenPrinter($P,[ref]$h,[IntPtr]::Zero)){Write-Error "OpenPrinter falhou";exit 1}`,
    `[WP]::StartDocPrinter($h,1,$d)|Out-Null`,
    `[WP]::StartPagePrinter($h)|Out-Null`,
    `$p=[System.Runtime.InteropServices.Marshal]::AllocHGlobal($b.Length)`,
    `[System.Runtime.InteropServices.Marshal]::Copy($b,0,$p,$b.Length)`,
    `$w=0;[WP]::WritePrinter($h,$p,$b.Length,[ref]$w)|Out-Null`,
    `[System.Runtime.InteropServices.Marshal]::FreeHGlobal($p)`,
    `[WP]::EndPagePrinter($h)|Out-Null`,
    `[WP]::EndDocPrinter($h)|Out-Null`,
    `[WP]::ClosePrinter($h)|Out-Null`,
  ].join('\r\n');

  fs.writeFileSync(tmpScript, script, 'utf8');

  return new Promise((resolve, reject) => {
    try {
      execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', tmpScript, '-P', printerName, '-F', tmpData,
      ], { timeout: timeoutMs, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      resolve();
    } catch (err: unknown) {
      const e = err as { stderr?: Buffer; stdout?: Buffer; message?: string };
      const detail = (e?.stderr?.toString() || e?.stdout?.toString() || e?.message || '').trim();
      reject(new Error(`RAW print falhou em "${printerName}": ${detail || 'erro desconhecido'}`));
    } finally {
      try { fs.unlinkSync(tmpData);   } catch { /* ignora */ }
      try { fs.unlinkSync(tmpScript); } catch { /* ignora */ }
    }
  });
}

/* Fallback: print.exe via spooler (funciona para drivers sem RAW, mas pode corromper ESC/POS) */
function rawWriteUsbFallback(target: { port: string; printerName?: string }, data: Buffer, timeoutMs = 12000): Promise<void> {
  const targetName = (target.printerName && target.printerName.trim())
    ? target.printerName.trim()
    : extractPortName(target.port);

  console.log('[printer] fallback print.exe → ', JSON.stringify(targetName));

  const tmpFile = path.join(os.tmpdir(), `alf_${Date.now()}.prn`);
  fs.writeFileSync(tmpFile, data);

  return new Promise((resolve, reject) => {
    try {
      execFileSync('print.exe', [`/D:${targetName}`, tmpFile], {
        timeout: timeoutMs,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      resolve();
    } catch (err: unknown) {
      const e = err as { stderr?: Buffer; stdout?: Buffer; message?: string };
      const detail = (e?.stderr?.toString() || e?.stdout?.toString() || e?.message || '').trim();
      reject(new Error(`print.exe falhou em "${targetName}": ${detail || 'spooler indisponível'}`));
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignora */ }
    }
  });
}

async function rawWriteUsb(target: { port: string; printerName?: string }, data: Buffer): Promise<void> {
  const printerName = (target.printerName && target.printerName.trim())
    ? target.printerName.trim()
    : extractPortName(target.port);

  console.log('[printer] rawWriteUsb RAW → ', JSON.stringify(printerName));

  try {
    await rawWriteUsbRaw(printerName, data);
  } catch (rawErr) {
    const rawMsg = rawErr instanceof Error ? rawErr.message : String(rawErr);
    console.warn('[printer] RAW falhou, tentando print.exe:', rawMsg);
    // Se PowerShell foi bloqueado (ex: antivírus), tenta print.exe
    await rawWriteUsbFallback(target, data);
  }
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
      try {
        await printViaThermal(text, config, 1);
      } catch {
        await rawWriteTcp(config.interface, data);
      }
    } else {
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

/* PowerShell Get-Printer — mais confiável, funciona mesmo sem WMIC */
function detectViaPowerShell(): RawPrinter[] {
  try {
    const cmd =
      'powershell.exe -NoProfile -NonInteractive -Command ' +
      '"Get-Printer | Where-Object { $_.PortName -match \'^USB\' } | ' +
      'Select-Object Name,PortName | ConvertTo-Json -Compress"';
    const out = execSync(cmd, { encoding: 'utf8', timeout: 8000, windowsHide: true }).trim();
    if (!out) return [];
    const parsed = JSON.parse(out) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return (arr as Record<string, unknown>[])
      .filter(p => p && p['PortName'] && p['Name'])
      .map(p => ({ name: String(p['Name']), portName: String(p['PortName']).toUpperCase() }));
  } catch { return []; }
}

/* WMIC — fallback para versões antigas do Windows onde Get-Printer não existe */
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

  // Combina PowerShell + WMIC para máxima cobertura
  for (const p of [...detectViaPowerShell(), ...detectViaWmic()]) {
    if (seen.has(p.portName)) continue;
    seen.add(p.portName);
    result.push({ port: `//./${p.portName}`, portName: p.portName, label: `${p.name} — ${p.portName}` });
  }

  // Probe direto nas portas USB001–USB005 como último recurso
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
