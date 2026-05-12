import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron';
import path from 'path';
import { store } from './store';
import { startPoller, restartPoller, stopPoller } from './poller';
import { printTestPage, detectUsbPrinters, detectWindowsPrinters, detectSerialPorts } from './printer';

let tray: Tray | null = null;
let configWindow: BrowserWindow | null = null;
let currentStatus = 'disconnected';
let currentMessage = 'Iniciando...';

function getIconPath(status: string): string {
  const iconName = status === 'polling' ? 'icon-green'
    : status === 'printing'  ? 'icon-green'
    : status === 'error'     ? 'icon-red'
    : 'icon-gray';
  return path.join(__dirname, '..', 'assets', `${iconName}.png`);
}

function updateTrayTooltip() {
  if (!tray) return;
  tray.setToolTip(`Alinhafood Print Agent\n${currentMessage}`);
  try {
    tray.setImage(nativeImage.createFromPath(getIconPath(currentStatus)));
  } catch {
    /* ícone pode não existir em dev */
  }
}

function onStatus(status: string, message: string) {
  currentStatus = status;
  currentMessage = message;
  updateTrayTooltip();
  if (configWindow) {
    configWindow.webContents.send('status-update', status, message);
  }
}

function createConfigWindow() {
  if (configWindow) {
    configWindow.focus();
    return;
  }

  const preloadPath = path.join(__dirname, 'preload.js');
  console.log('[main] preload path:', preloadPath, 'exists:', require('fs').existsSync(preloadPath));

  configWindow = new BrowserWindow({
    width: 540,
    height: 700,
    resizable: true,
    title: 'Alinhafood Print Agent — Configurações',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Esconde a barra de menu padrão (File / Edit / View) no Windows
  configWindow.setMenuBarVisibility(false);

  const htmlPath = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
  console.log('[main] html path:', htmlPath, 'exists:', require('fs').existsSync(htmlPath));
  configWindow.loadFile(htmlPath);

  configWindow.on('closed', () => { configWindow = null; });
}

function openDevTools() {
  if (!configWindow) createConfigWindow();
  configWindow?.webContents.openDevTools({ mode: 'detach' });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon-gray.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Alinhafood Print Agent');

  const menu = Menu.buildFromTemplate([
    { label: 'Configurações', click: createConfigWindow },
    { label: 'Abrir ferramentas de diagnóstico', click: openDevTools },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', createConfigWindow);
}

app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: store.get('autoStart') });
  createTray();

  const hasConfig = store.get('apiUrl') && store.get('agentToken');
  if (!hasConfig) createConfigWindow();

  startPoller(onStatus);
});

app.on('window-all-closed', () => {
  /* mantém o agente vivo na bandeja */
});

app.on('before-quit', () => {
  stopPoller();
});

/* ── IPC handlers ── */

ipcMain.handle('get-config', () => ({
  apiUrl:           store.get('apiUrl'),
  agentToken:       store.get('agentToken'),
  printerType:      store.get('printerType'),
  printerInterface: store.get('printerInterface'),
  printerName:      store.get('printerName'),
  printerModel:     store.get('printerModel'),
  autoStart:        store.get('autoStart'),
  currentStatus,
  currentMessage,
}));

ipcMain.handle('save-config', (_event, config: {
  apiUrl: string;
  agentToken: string;
  printerType: 'usb' | 'windows' | 'serial' | 'tcp';
  printerInterface: string;
  printerName: string;
  printerModel: 'epson' | 'star' | 'tanca' | 'daruma';
  autoStart: boolean;
}) => {
  console.log('[main] save-config recebido');
  store.set('apiUrl',           config.apiUrl.trim());
  store.set('agentToken',       config.agentToken.trim());
  store.set('printerType',      config.printerType);
  store.set('printerInterface', config.printerInterface.trim());
  store.set('printerName',      config.printerName.trim());
  store.set('printerModel',     config.printerModel);
  store.set('autoStart',        config.autoStart);

  app.setLoginItemSettings({ openAtLogin: config.autoStart });
  restartPoller();

  return { ok: true };
});

ipcMain.handle('test-printer', async (_event, config: {
  type?: string;
  interface?: string;
  model?: string;
  printerName?: string;
}) => {
  console.log('[main] test-printer recebido:', config);
  const iface = (config?.interface ?? store.get('printerInterface') ?? '').trim();
  const type  = (config?.type      ?? store.get('printerType'))  as 'usb' | 'windows' | 'serial' | 'tcp';
  const model = (config?.model     ?? store.get('printerModel')) as string;

  if (!iface) {
    return { ok: false, error: 'Nenhuma porta/IP configurado. Preencha o campo e tente novamente.' };
  }

  try {
    // Envia uma página de teste real — se imprimir, a impressora está funcionando
    const printerName = (config?.printerName ?? store.get('printerName') ?? '').trim() || undefined;
    await printTestPage({ type, interface: iface, model, printerName });
    return { ok: true };
  } catch (err) {
    console.error('[main] test-printer erro:', err);
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return { ok: false, error: msg };
  }
});

ipcMain.handle('clear-config', () => {
  store.set('apiUrl', '');
  store.set('agentToken', '');
  store.set('printerInterface', '');
  store.set('printerName', '');
  restartPoller();
  return { ok: true };
});

ipcMain.handle('detect-usb-printers', () => {
  console.log('[main] detect-usb-printers chamado');
  try {
    const printers = detectUsbPrinters();
    console.log('[main] detect-usb-printers resultado:', printers);
    return { printers };
  } catch (err) {
    console.error('[main] detect-usb-printers erro:', err);
    return { printers: [], error: err instanceof Error ? err.message : 'Erro na detecção' };
  }
});

ipcMain.handle('detect-windows-printers', () => {
  console.log('[main] detect-windows-printers chamado');
  try {
    const printers = detectWindowsPrinters();
    console.log('[main] detect-windows-printers resultado:', printers);
    return { printers };
  } catch (err) {
    console.error('[main] detect-windows-printers erro:', err);
    return { printers: [], error: err instanceof Error ? err.message : 'Erro na detecção' };
  }
});

ipcMain.handle('detect-serial-ports', () => {
  console.log('[main] detect-serial-ports chamado');
  try {
    const ports = detectSerialPorts();
    console.log('[main] detect-serial-ports resultado:', ports);
    return { printers: ports };
  } catch (err) {
    console.error('[main] detect-serial-ports erro:', err);
    return { printers: [], error: err instanceof Error ? err.message : 'Erro na detecção' };
  }
});
