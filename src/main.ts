import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron';
import path from 'path';
import { store } from './store';
import { startPoller, stopPoller } from './poller';
import { testConnection } from './printer';

let tray: Tray | null = null;
let configWindow: BrowserWindow | null = null;
let currentStatus = 'disconnected';
let currentMessage = 'Iniciando...';

function getIconPath(status: string): string {
  const iconName = status === 'polling' ? 'icon-green'
    : status === 'printing' ? 'icon-green'
    : status === 'error' ? 'icon-red'
    : 'icon-gray';
  return path.join(__dirname, '..', 'assets', `${iconName}.png`);
}

function updateTrayTooltip() {
  if (tray) {
    tray.setToolTip(`Alinhafood Print Agent\n${currentMessage}`);
    try {
      tray.setImage(nativeImage.createFromPath(getIconPath(currentStatus)));
    } catch {
      // icon may not exist in dev
    }
  }
}

function createConfigWindow() {
  if (configWindow) {
    configWindow.focus();
    return;
  }

  configWindow = new BrowserWindow({
    width: 520,
    height: 600,
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
  if (!hasConfig) {
    createConfigWindow();
  }

  startPoller((status, message) => {
    currentStatus = status;
    currentMessage = message;
    updateTrayTooltip();

    if (configWindow) {
      configWindow.webContents.send('status-update', status, message);
    }
  });
});

app.on('window-all-closed', () => {
  // Stay alive in tray even if all windows are closed
});

app.on('before-quit', () => {
  stopPoller();
});

/* IPC handlers */
ipcMain.handle('get-config', () => ({
  apiUrl: store.get('apiUrl'),
  agentToken: store.get('agentToken'),
  printerType: store.get('printerType'),
  printerInterface: store.get('printerInterface'),
  printerName: store.get('printerName'),
  autoStart: store.get('autoStart'),
  currentStatus,
  currentMessage,
}));

ipcMain.handle('save-config', (_event, config: {
  apiUrl: string;
  agentToken: string;
  printerType: 'usb' | 'tcp';
  printerInterface: string;
  printerName: string;
  autoStart: boolean;
}) => {
  store.set('apiUrl', config.apiUrl.trim());
  store.set('agentToken', config.agentToken.trim());
  store.set('printerType', config.printerType);
  store.set('printerInterface', config.printerInterface.trim());
  store.set('printerName', config.printerName.trim());
  store.set('autoStart', config.autoStart);

  app.setLoginItemSettings({ openAtLogin: config.autoStart });
  return { ok: true };
});

ipcMain.handle('test-printer', async () => {
  const printerInterface = store.get('printerInterface');
  const printerType = store.get('printerType');
  if (!printerInterface) return { ok: false, error: 'Nenhuma impressora configurada' };
  try {
    const connected = await testConnection({ type: printerType, interface: printerInterface });
    return { ok: connected, error: connected ? null : 'Impressora não respondeu. Verifique a conexão.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erro desconhecido' };
  }
});
