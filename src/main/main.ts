/**
 * Electron main process entry (spec sections 2, 42).
 *
 * Creates the editor window with secure defaults (contextIsolation on,
 * nodeIntegration off, preload bridge), registers IPC handlers, prepares cache
 * directories, and verifies FFmpeg at startup.
 */

import { app, BrowserWindow, Menu } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerMediaIpc } from './ipc/media.ipc';
import { registerProjectIpc } from './ipc/project.ipc';
import { registerRenderIpc } from './ipc/render.ipc';
import { registerSystemIpc } from './ipc/system.ipc';
import { ensureCacheDirs, cleanStaleCache } from './services/cache/cachePaths';
import { verifyFfmpeg } from './services/ffmpeg/ffmpegLocator';
import {
  registerMediaProtocolSchemes,
  registerMediaProtocolHandler,
} from './services/media/mediaProtocol';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Privileged schemes must be registered before the app is ready.
registerMediaProtocolSchemes();

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#141518',
    show: false,
    title: 'ClipForge',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools();
  } else if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => send('menu:new') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => send('menu:open') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('menu:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu:saveas') },
        { type: 'separator' },
        { label: 'Import Media…', accelerator: 'CmdOrCtrl+I', click: () => send('menu:import') },
        { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: () => send('menu:export') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('menu:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('menu:redo') },
      ],
    },
    {
      label: 'Help',
      submenu: [{ label: 'Keyboard Shortcuts', click: () => send('menu:shortcuts') }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function send(channel: string): void {
  mainWindow?.webContents.send(channel);
}

app.whenReady().then(async () => {
  ensureCacheDirs();
  cleanStaleCache();

  registerMediaProtocolHandler();

  registerMediaIpc();
  registerProjectIpc();
  registerRenderIpc();
  registerSystemIpc();

  buildMenu();
  createWindow();

  // Verify FFmpeg in the background; renderer also queries this on load.
  verifyFfmpeg().then((status) => {
    if (!status.available) {
      console.warn('FFmpeg not available:', status.error);
    } else {
      console.log('FFmpeg ready:', status.ffmpegVersion);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Harden: block new-window and navigation to external origins.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('http://localhost:5173') || url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });
});
