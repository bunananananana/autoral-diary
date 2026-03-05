const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) { app.quit(); }

let widgetWindow, mainWindow, tray;
const dataDir = path.join(app.getPath('userData'), 'diaries');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function createTrayIcon() {
  const s = 16;
  const buf = Buffer.alloc(s * s * 4, 0);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || x >= s || y < 0 || y >= s) return;
    const i = (y * s + x) * 4;
    buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = a;
  };
  const fill = (x1, y1, x2, y2, r, g, b, a = 255) => {
    for (let y = y1; y <= y2; y++)
      for (let x = x1; x <= x2; x++) set(x, y, r, g, b, a);
  };

  fill(4, 1, 13, 14, 250, 248, 240);
  fill(2, 1, 4, 14, 90, 130, 180);
  fill(3, 0, 4, 0, 70, 110, 160);
  fill(3, 15, 4, 15, 70, 110, 160);
  fill(6, 4, 11, 4, 190, 190, 190);
  fill(6, 7, 10, 7, 190, 190, 190);
  fill(6, 10, 11, 10, 190, 190, 190);

  return nativeImage.createFromBitmap(buf, { width: s, height: s });
}

function createWidgetWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  widgetWindow = new BrowserWindow({
    width: 300,
    height: 300,
    x: width - 320,
    y: height - 320,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  widgetWindow.loadFile('widget.html');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 700,
    minHeight: 450,
    show: false,
    title: '日记本',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadFile('app.html');

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  let icon;
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    icon = createTrayIcon();
  }

  tray = new Tray(icon);

  const buildMenu = () => Menu.buildFromTemplate([
    { label: '打开日记本', click: () => { mainWindow.show(); mainWindow.focus(); } },
    {
      label: widgetWindow.isVisible() ? '隐藏桌面组件' : '显示桌面组件',
      click: () => {
        if (widgetWindow.isVisible()) widgetWindow.hide();
        else widgetWindow.show();
        tray.setContextMenu(buildMenu());
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setToolTip('Autoral 日记本');
  tray.setContextMenu(buildMenu());
  tray.on('click', () => { mainWindow.show(); mainWindow.focus(); });
}

// ── IPC Handlers ──

ipcMain.handle('diary:save', async (_, date, content) => {
  const filePath = path.join(dataDir, `${date}.json`);
  const data = { date, content, updatedAt: new Date().toISOString() };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return data;
});

ipcMain.handle('diary:load', async (_, date) => {
  const filePath = path.join(dataDir, `${date}.json`);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return null;
});

ipcMain.handle('diary:list', async () => {
  if (!fs.existsSync(dataDir)) return [];
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
  const entries = files.map(f => {
    try {
      const raw = fs.readFileSync(path.join(dataDir, f), 'utf-8');
      const data = JSON.parse(raw);
      return {
        date: data.date,
        preview: data.content.replace(/[#*_~`>\-\[\]]/g, '').trim().substring(0, 60),
        updatedAt: data.updatedAt
      };
    } catch { return null; }
  }).filter(Boolean);
  return entries.sort((a, b) => b.date.localeCompare(a.date));
});

ipcMain.handle('diary:delete', async (_, date) => {
  const filePath = path.join(dataDir, `${date}.json`);
  if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return true; }
  return false;
});

ipcMain.handle('app:open-main', async () => {
  mainWindow.show();
  mainWindow.focus();
});

ipcMain.handle('widget:pick-bg', async () => {
  const result = await dialog.showOpenDialog(widgetWindow, {
    title: '选择背景图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }]
  });
  if (result.canceled || !result.filePaths.length) return null;

  const src = result.filePaths[0];
  const ext = path.extname(src).slice(1).toLowerCase();
  const dest = path.join(app.getPath('userData'), 'widget-bg.' + ext);
  fs.copyFileSync(src, dest);

  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
  settings.widgetBg = dest;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

  const buf = fs.readFileSync(dest);
  const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
  return `data:${mimeMap[ext] || 'image/png'};base64,${buf.toString('base64')}`;
});

ipcMain.handle('widget:get-bg', async () => {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    if (settings.widgetBg && fs.existsSync(settings.widgetBg)) {
      const ext = path.extname(settings.widgetBg).slice(1).toLowerCase();
      const buf = fs.readFileSync(settings.widgetBg);
      const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
      return `data:${mimeMap[ext] || 'image/png'};base64,${buf.toString('base64')}`;
    }
  } catch {}
  return null;
});

ipcMain.handle('widget:clear-bg', async () => {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
  if (settings.widgetBg && fs.existsSync(settings.widgetBg)) {
    try { fs.unlinkSync(settings.widgetBg); } catch {}
  }
  delete settings.widgetBg;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  return true;
});

// ── App Lifecycle ──

app.whenReady().then(() => {
  createWidgetWindow();
  createMainWindow();
  createTray();

  globalShortcut.register('CommandOrControl+Shift+D', () => {
    if (widgetWindow.isVisible()) {
      widgetWindow.hide();
    } else {
      widgetWindow.show();
      widgetWindow.focus();
    }
  });
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});
