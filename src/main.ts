import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron';
import path from 'path';
import { store } from './store';
import { startPoller, restartPoller, stopPoller } from './poller';
import { testConnection, detectUsbPrinters } from './printer';

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
    // ícone pode não existir em dev
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

  configWindow = new BrowserWindow({
    width: 520,
    height: 680,
    resizable: false,
    title: 'Alinhafood Print Agent — Configurações',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  configWindow.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  configWindow.on('closed', () => { configWindow = null; });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon-gray.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Alinhafood Print Agent');

  const menu = Menu.buildFromTemplate([
    { label: 'Configurações', click: createConfigWindow },
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
  // Continua na bandeja mesmo sem janelas abertas
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
  printerType: 'usb' | 'tcp';
  printerInterface: string;
  printerName: string;
  printerModel: 'epson' | 'star' | 'tanca' | 'daruma';
  autoStart: boolean;
}) => {
  store.set('apiUrl',           config.apiUrl.trim());
  store.set('agentToken',       config.agentToken.trim());
  store.set('printerType',      config.printerType);
  store.set('printerInterface', config.printerInterface.trim());
  store.set('printerName',      config.printerName.trim());
  store.set('printerModel',     config.printerModel);
  store.set('autoStart',        config.autoStart);

  app.setLoginItemSettings({ openAtLogin: config.autoStart });

  // Reinicia o poller imediatamente com a nova configuração
  restartPoller();

  return { ok: true };
});

ipcMain.handle('test-printer', async (_event, config: {
  type?: string;
  interface?: string;
  model?: string;
}) => {
  const iface  = (config?.interface ?? store.get('printerInterface') ?? '').trim();
  const type   = (config?.type      ?? store.get('printerType'))  as 'usb' | 'tcp';
  const model  = (config?.model     ?? store.get('printerModel'))  as string;

  if (!iface) {
    return { ok: false, error: 'Nenhuma porta/IP configurado. Preencha o campo e tente novamente.' };
  }

  try {
    const connected = await testConnection({ type, interface: iface, model });
    return {
      ok: connected,
      error: connected ? null : 'Impressora não respondeu. Verifique se está ligada e no endereço correto.',
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erro desconhecido' };
  }
});

ipcMain.handle('detect-usb-printers', () => {
  try {
    return { printers: detectUsbPrinters() };
  } catch (err) {
    return { printers: [], error: err instanceof Error ? err.message : 'Erro na detecção' };
  }
});
