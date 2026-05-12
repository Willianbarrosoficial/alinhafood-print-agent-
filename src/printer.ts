import { ThermalPrinter, PrinterTypes } from 'node-thermal-printer';
import { execSync } from 'child_process';
import { execFileSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

export interface PrinterConfig {
  type: 'usb' | 'windows' | 'serial' | 'tcp';
  interface: string;
  model?: string;
  printerName?: string;
}

export interface DetectedPrinter {
  port: string;
  portName: string;
  printerName?: string;
  driverName?: string;
  connectionType?: string;
  printerStatus?: string;
  isDefault?: boolean;
  isRecommended?: boolean;
  recommendationReason?: string;
  label: string;
}

interface SerialTarget {
  portName: string;
  baudRate: number;
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

function toPrinterSafeText(text: string): string {
  return Array.from(text)
    .filter(char => char.charCodeAt(0) <= 0xFF)
    .join('');
}

function buildReceiptBytes(text: string): Buffer {
  return Buffer.concat([
    Buffer.from([ESC, 0x40]),             // reset
    Buffer.from(toPrinterSafeText(text) + '\n\n\n', 'latin1'),
    Buffer.from([GS, 0x56, 0x00]),        // corte
  ]);
}

/* ─── extrai nome da porta de //./USB001 ou \\.\USB001 → "USB001" ─── */
function extractPortName(devicePath: string): string {
  return devicePath
    .replace(/^[/\\]+\.[/\\]+/, '')
    .replace(/[/\\]+$/, '');
}

function getRawHelperPath(): string | null {
  const overridePath = (process.env.ALINHAFOOD_RAW_PRINTER_HELPER ?? '').trim();
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidatePaths = [
    overridePath,
    resourcesPath ? path.join(resourcesPath, 'bin', 'win-x64', 'AlinhafoodRawPrinter.exe') : '',
    resourcesPath ? path.join(resourcesPath, 'bin', 'AlinhafoodRawPrinter.exe') : '',
    path.join(__dirname, '..', 'bin', 'win-x64', 'AlinhafoodRawPrinter.exe'),
    path.join(__dirname, '..', 'bin', 'AlinhafoodRawPrinter.exe'),
  ].filter(Boolean);

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveConfiguredPrinterName(target: { port: string; printerName?: string }): string | undefined {
  const configuredName = target.printerName?.trim();
  if (configuredName) return configuredName;

  const targetPortName = extractPortName(target.port).toUpperCase();
  for (const printer of [...detectViaPowerShell(), ...detectViaWmic()]) {
    if (printer.portName.toUpperCase() === targetPortName && printer.name.trim()) {
      return printer.name.trim();
    }
  }

  return undefined;
}

function rawWriteUsbViaHelper(printerName: string, data: Buffer, timeoutMs: number): void {
  const helperPath = getRawHelperPath();
  if (!helperPath) {
    throw new Error('Helper RAW do Windows nao encontrado no pacote.');
  }

  console.log('[printer] rawWriteUsb via helper RAW → ', JSON.stringify(printerName));

  const tmpFile = path.join(os.tmpdir(), `alf_${Date.now()}.prn`);
  fs.writeFileSync(tmpFile, data);

  try {
    execFileSync(helperPath, [printerName, tmpFile], {
      timeout: timeoutMs,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer; stdout?: Buffer; message?: string };
    const detail = (e?.stderr?.toString() || e?.stdout?.toString() || e?.message || '').trim();
    throw new Error(`Falha ao imprimir RAW em "${printerName}": ${detail || 'helper indisponivel'}`);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignora */ }
  }
}

/* ─── Fallback USB via Windows Spooler com print.exe ───
 * print.exe continua como plano B quando o helper RAW nao estiver disponivel
 * ou quando o nome da impressora nao puder ser resolvido.
 */
function rawWriteUsbViaPrintExe(targetName: string, data: Buffer, timeoutMs: number): void {
  console.warn('[printer] fallback para print.exe → ', JSON.stringify(targetName));

  const tmpFile = path.join(os.tmpdir(), `alf_${Date.now()}.prn`);
  fs.writeFileSync(tmpFile, data);

  try {
    execFileSync('print.exe', [`/D:${targetName}`, tmpFile], {
      timeout: timeoutMs,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer; stdout?: Buffer; message?: string };
    const detail = (e?.stderr?.toString() || e?.stdout?.toString() || e?.message || '').trim();
    throw new Error(`Falha ao imprimir em "${targetName}": ${detail || 'spooler indisponível'}`);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignora */ }
  }
}

function rawWriteUsb(target: { port: string; printerName?: string }, data: Buffer, timeoutMs = 12000): Promise<void> {
  const printerName = resolveConfiguredPrinterName(target);
  const fallbackTarget = printerName || extractPortName(target.port);

  return new Promise((resolve, reject) => {
    try {
      if (process.platform === 'win32' && printerName) {
        rawWriteUsbViaHelper(printerName, data, timeoutMs);
      } else {
        rawWriteUsbViaPrintExe(fallbackTarget, data, timeoutMs);
      }
      resolve();
    } catch (err) {
      if (process.platform === 'win32' && printerName) {
        const primaryDetail = err instanceof Error ? err.message : String(err);
        try {
          rawWriteUsbViaPrintExe(fallbackTarget, data, timeoutMs);
          resolve();
          return;
        } catch (fallbackErr) {
          const fallbackDetail = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          reject(new Error(`${primaryDetail} Fallback print.exe também falhou: ${fallbackDetail}`));
          return;
        }
      }
      reject(err);
    }
  });
}

function parseSerialInterface(value: string): SerialTarget {
  const cleanValue = value.trim();
  const match = cleanValue.match(/^(?:[/\\]+\.?[/\\]+)?(COM\d+)(?::(\d+))?$/i);
  if (!match) {
    throw new Error('Porta serial inválida. Use o formato COM5 ou COM5:9600.');
  }

  const baudRate = parseInt(match[2] ?? '9600', 10);
  if (!Number.isFinite(baudRate) || baudRate <= 0) {
    throw new Error('Velocidade serial inválida. Use 9600, 19200, 38400, 57600 ou 115200.');
  }

  return { portName: match[1].toUpperCase(), baudRate };
}

function configureSerialPort(target: SerialTarget): void {
  if (process.platform !== 'win32') return;

  execFileSync('mode.com', [
    `${target.portName}:`,
    `BAUD=${target.baudRate}`,
    'PARITY=N',
    'DATA=8',
    'STOP=1',
  ], {
    timeout: 5000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function rawWriteSerial(serialInterface: string, data: Buffer): Promise<void> {
  const target = parseSerialInterface(serialInterface);
  const devicePath = `\\\\.\\${target.portName}`;

  return new Promise((resolve, reject) => {
    try {
      configureSerialPort(target);
      const fd = fs.openSync(devicePath, 'w');
      try {
        fs.writeSync(fd, data, 0, data.length);
      } finally {
        fs.closeSync(fd);
      }
      resolve();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reject(new Error(`Falha ao imprimir via serial ${target.portName}:${target.baudRate}: ${message}`));
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
  } else if (config.type === 'serial') {
    await rawWriteSerial(config.interface, data);
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
    } else if (config.type === 'serial') {
      await rawWriteSerial(config.interface, data);
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
  if (config.type !== 'tcp') throw new Error('Somente TCP usa node-thermal-printer');
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

/* ─── Detecção de impressoras no Windows ─── */

interface RawPrinter {
  name: string;
  portName: string;
  driverName?: string;
  printerStatus?: string;
  isDefault?: boolean;
  isOffline?: boolean;
}

interface RawSerialPort {
  portName: string;
  name?: string;
  description?: string;
  pnpDeviceId?: string;
}

/* PowerShell Get-Printer — leitura simples, não usa Add-Type/P-Invoke */
function detectViaPowerShell(onlyUsb = false): RawPrinter[] {
  try {
    const cmd =
      'powershell.exe -NoProfile -NonInteractive -Command ' +
      '"Get-CimInstance Win32_Printer | Select-Object Name,PortName,DriverName,PrinterStatus,Default,WorkOffline | ConvertTo-Json -Compress"';
    const out = execSync(cmd, { encoding: 'utf8', timeout: 8000, windowsHide: true }).trim();
    if (!out) return [];
    const parsed = JSON.parse(out) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return (arr as Record<string, unknown>[])
      .filter(p => p && p['PortName'] && p['Name'])
      .map(p => ({
        name: String(p['Name']).trim(),
        portName: String(p['PortName']).trim(),
        driverName: p['DriverName'] ? String(p['DriverName']).trim() : undefined,
        printerStatus: p['PrinterStatus'] ? normalizePrinterStatus(String(p['PrinterStatus'])) : undefined,
        isDefault: Boolean(p['Default']),
        isOffline: Boolean(p['WorkOffline']),
      }))
      .filter(p => !onlyUsb || /^USB\d+$/i.test(p.portName));
  } catch { return []; }
}

function parseWmicCsv(out: string): Record<string, string>[] {
  const lines = out.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(header => header.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = (cells[i] ?? '').trim();
    }
    return row;
  });
}

function parseBoolean(value?: string): boolean {
  return /^(true|1|yes)$/i.test(value ?? '');
}

function normalizePrinterStatus(value: string): string {
  const statusMap: Record<string, string> = {
    '1': 'Outro',
    '2': 'Desconhecido',
    '3': 'Pronta',
    '4': 'Imprimindo',
    '5': 'Aquecendo',
    '6': 'Parada',
    '7': 'Offline',
  };
  return statusMap[value] ?? value;
}

/* WMIC — fallback para Windows sem PowerShell ou Get-Printer */
function detectViaWmic(onlyUsb = false): RawPrinter[] {
  try {
    const out = execSync('wmic printer get name,portname,drivername,printerstatus,default,workoffline /format:csv', {
      encoding: 'utf8', timeout: 6000, windowsHide: true,
    });
    const found: RawPrinter[] = [];
    for (const row of parseWmicCsv(out)) {
      const driverName = row.drivername ?? '';
      const name = row.name ?? '';
      const portName = row.portname ?? '';
      if (!portName || portName === 'PortName') continue;
      if (onlyUsb && !/^USB\d+$/i.test(portName)) continue;
      found.push({
        name,
        portName,
        driverName,
        printerStatus: row.printerstatus ? normalizePrinterStatus(row.printerstatus) : undefined,
        isDefault: parseBoolean(row.default),
        isOffline: parseBoolean(row.workoffline),
      });
    }
    return found;
  } catch { return []; }
}

function isVirtualPrinter(printer: RawPrinter): boolean {
  const haystack = `${printer.name} ${printer.driverName ?? ''} ${printer.portName}`.toLowerCase();
  return [
    'microsoft print to pdf',
    'microsoft xps',
    'onenote',
    'fax',
    'pdfcreator',
    'send to onenote',
  ].some(token => haystack.includes(token));
}

function classifyConnection(portName: string): string {
  if (/^USB\d+$/i.test(portName)) return 'USB';
  if (/^COM\d+$/i.test(portName)) return 'Bluetooth/Serial';
  if (/^BTH/i.test(portName) || /bluetooth/i.test(portName)) return 'Bluetooth';
  if (/^\d{1,3}(\.\d{1,3}){3}/.test(portName) || /^IP_/i.test(portName)) return 'Rede';
  return 'Windows';
}

function getRecommendation(printer: RawPrinter, connectionType: string): { recommended: boolean; reason?: string; score: number } {
  const haystack = `${printer.name} ${printer.driverName ?? ''}`.toLowerCase();
  const thermalTokens = [
    'thermal',
    'receipt',
    'cupom',
    'esc/pos',
    'pos',
    'epson',
    'elgin',
    'tanca',
    'daruma',
    'bematech',
    'sweda',
    'star',
    'tm-',
    'mp-',
    'mtp',
    'i7',
    'i8',
    'i9',
  ];
  const hasThermalHint = thermalTokens.some(token => haystack.includes(token));
  let score = 0;
  if (hasThermalHint) score += 100;
  if (['USB', 'Bluetooth', 'Bluetooth/Serial'].includes(connectionType)) score += 30;
  if (printer.isDefault) score += 10;
  if (printer.isOffline) score -= 40;

  if (hasThermalHint) return { recommended: true, reason: 'provável térmica ESC/POS', score };
  return { recommended: false, score };
}

function getConnectionRank(connectionType: string): number {
  switch (connectionType) {
    case 'USB': return 0;
    case 'Bluetooth': return 1;
    case 'Bluetooth/Serial': return 2;
    case 'Rede': return 3;
    default: return 4;
  }
}

function toDetectedPrinter(printer: RawPrinter): DetectedPrinter {
  const portName = printer.portName.trim();
  const connectionType = classifyConnection(portName);
  const recommendation = getRecommendation(printer, connectionType);
  const driverInfo = printer.driverName ? ` — ${printer.driverName}` : '';
  const port = /^USB\d+$/i.test(portName) || /^COM\d+$/i.test(portName)
    ? `//./${portName.toUpperCase()}`
    : portName;

  return {
    port,
    portName,
    printerName: printer.name,
    driverName: printer.driverName,
    connectionType,
    printerStatus: printer.isOffline ? 'Offline' : printer.printerStatus,
    isDefault: printer.isDefault,
    isRecommended: recommendation.recommended,
    recommendationReason: recommendation.reason,
    label: `${printer.name} — ${portName} (${connectionType})${driverInfo}`,
  };
}

function sortDetectedPrinters(printers: DetectedPrinter[]): DetectedPrinter[] {
  return printers.sort((a, b) => {
    if (a.isRecommended !== b.isRecommended) return a.isRecommended ? -1 : 1;
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    const connectionDiff = getConnectionRank(a.connectionType ?? '') - getConnectionRank(b.connectionType ?? '');
    if (connectionDiff !== 0) return connectionDiff;
    return (a.printerName ?? a.label).localeCompare(b.printerName ?? b.label, 'pt-BR');
  });
}

function detectSerialViaPowerShell(): RawSerialPort[] {
  try {
    const cmd =
      'powershell.exe -NoProfile -NonInteractive -Command ' +
      '"Get-CimInstance Win32_SerialPort | Select-Object DeviceID,Name,Description,PNPDeviceID | ConvertTo-Json -Compress"';
    const out = execSync(cmd, { encoding: 'utf8', timeout: 8000, windowsHide: true }).trim();
    if (!out) return [];
    const parsed = JSON.parse(out) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return (arr as Record<string, unknown>[])
      .filter(p => p && p['DeviceID'])
      .map(p => ({
        portName: String(p['DeviceID']).trim().toUpperCase(),
        name: p['Name'] ? String(p['Name']).trim() : undefined,
        description: p['Description'] ? String(p['Description']).trim() : undefined,
        pnpDeviceId: p['PNPDeviceID'] ? String(p['PNPDeviceID']).trim() : undefined,
      }))
      .filter(p => /^COM\d+$/i.test(p.portName));
  } catch { return []; }
}

function detectSerialViaWmic(): RawSerialPort[] {
  try {
    const out = execSync('wmic path Win32_SerialPort get DeviceID,Name,Description,PNPDeviceID /format:csv', {
      encoding: 'utf8', timeout: 6000, windowsHide: true,
    });
    const found: RawSerialPort[] = [];
    for (const row of parseWmicCsv(out)) {
      const portName = (row.deviceid ?? '').trim().toUpperCase();
      if (!/^COM\d+$/i.test(portName)) continue;
      found.push({
        portName,
        name: row.name,
        description: row.description,
        pnpDeviceId: row.pnpdeviceid,
      });
    }
    return found;
  } catch { return []; }
}

function isLikelyBluetoothSerial(port: RawSerialPort): boolean {
  const haystack = `${port.name ?? ''} ${port.description ?? ''} ${port.pnpDeviceId ?? ''}`.toLowerCase();
  return haystack.includes('bluetooth') || haystack.includes('bth') || haystack.includes('standard serial over bluetooth');
}

function serialPortToDetectedPrinter(port: RawSerialPort): DetectedPrinter {
  const isBluetooth = isLikelyBluetoothSerial(port);
  const displayName = port.name || port.description || `${port.portName} serial`;
  return {
    port: `${port.portName}:9600`,
    portName: port.portName,
    printerName: displayName,
    driverName: port.description,
    connectionType: isBluetooth ? 'Bluetooth/Serial' : 'Serial',
    printerStatus: 'Porta COM',
    isRecommended: isBluetooth,
    recommendationReason: isBluetooth ? 'Bluetooth SPP/COM' : undefined,
    label: `${displayName} — ${port.portName} (${isBluetooth ? 'Bluetooth/Serial' : 'Serial'})`,
  };
}

export function detectSerialPorts(): DetectedPrinter[] {
  const result: DetectedPrinter[] = [];
  const seen = new Set<string>();

  for (const p of [...detectSerialViaPowerShell(), ...detectSerialViaWmic()]) {
    if (seen.has(p.portName)) continue;
    seen.add(p.portName);
    result.push(serialPortToDetectedPrinter(p));
  }

  return sortDetectedPrinters(result);
}

export function detectWindowsPrinters(): DetectedPrinter[] {
  const result: DetectedPrinter[] = [];
  const seen = new Set<string>();
  const seenPorts = new Set<string>();

  for (const p of [...detectViaPowerShell(false), ...detectViaWmic(false)]) {
    if (!p.name || !p.portName || isVirtualPrinter(p)) continue;
    const key = `${p.name.toLowerCase()}|${p.portName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    seenPorts.add(p.portName.toUpperCase());
    result.push(toDetectedPrinter(p));
  }

  for (let i = 1; i <= 5; i++) {
    const pn = `USB${String(i).padStart(3, '0')}`;
    if (seenPorts.has(pn)) continue;
    if (probeUsbPort(i)) {
      seenPorts.add(pn);
      result.push({
        port: `//./${pn}`,
        portName: pn,
        connectionType: 'USB',
        printerStatus: 'Porta detectada',
        label: `${pn} — detectada sem driver Windows`,
      });
    }
  }

  return sortDetectedPrinters(result);
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

  for (const p of [...detectViaPowerShell(true), ...detectViaWmic(true)]) {
    if (seen.has(p.portName)) continue;
    seen.add(p.portName);
    result.push(toDetectedPrinter({ ...p, portName: p.portName.toUpperCase() }));
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
