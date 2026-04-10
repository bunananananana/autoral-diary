const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, globalShortcut, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) { app.quit(); }

let widgetWindow, mainWindow, tray;
const dataDir = path.join(app.getPath('userData'), 'diaries');
const exportFileExtension = 'autoral-diary';

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function getDiaryFilePath(date) {
  return path.join(dataDir, `${date}.json`);
}

function normalizeDiaryPayload(raw, fallbackDate) {
  if (!raw || typeof raw !== 'object') return null;
  const date = typeof raw.date === 'string' && raw.date ? raw.date : fallbackDate;
  const content = typeof raw.content === 'string' ? raw.content : '';
  if (!date) return null;
  return {
    date,
    content,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : new Date().toISOString(),
  };
}

function loadDiaryFromDisk(date) {
  const filePath = getDiaryFilePath(date);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return normalizeDiaryPayload(parsed, date);
  } catch {
    return null;
  }
}

function saveDiaryToDisk(date, content, updatedAt = new Date().toISOString()) {
  const filePath = getDiaryFilePath(date);
  const data = { date, content, updatedAt };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return data;
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
  return saveDiaryToDisk(date, content);
});

ipcMain.handle('diary:load', async (_, date) => {
  return loadDiaryFromDisk(date);
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
  const filePath = getDiaryFilePath(date);
  if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return true; }
  return false;
});

ipcMain.handle('diary:export', async (_, date) => {
  const diary = loadDiaryFromDisk(date);
  if (!diary) {
    return { success: false, message: '未找到可导出的日记。' };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出日记',
    defaultPath: `autoral-diary-${date}.${exportFileExtension}`,
    filters: [
      { name: 'Autoral Diary Export', extensions: [exportFileExtension] },
      { name: 'JSON', extensions: ['json'] },
    ],
  });

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true };
  }

  const payload = {
    app: 'autoral-diary',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    diaries: [diary],
  };

  fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return { success: true, filePath: result.filePath, count: 1 };
});

ipcMain.handle('diary:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入日记',
    properties: ['openFile'],
    filters: [
      { name: 'Autoral Diary Export', extensions: [exportFileExtension, 'json'] },
    ],
  });

  if (result.canceled || !result.filePaths.length) {
    return { success: false, canceled: true };
  }

  try {
    const filePath = result.filePaths[0];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const rawDiaries = Array.isArray(parsed?.diaries) ? parsed.diaries : (parsed ? [parsed] : []);
    const diaries = rawDiaries
      .map(item => normalizeDiaryPayload(item, item?.date))
      .filter(Boolean);

    if (!diaries.length) {
      return { success: false, message: '导入文件中没有有效的日记内容。' };
    }

    let imported = 0;
    let overwritten = 0;
    for (const diary of diaries) {
      if (fs.existsSync(getDiaryFilePath(diary.date))) overwritten++;
      saveDiaryToDisk(diary.date, diary.content, diary.updatedAt);
      imported++;
    }

    return {
      success: true,
      filePath,
      imported,
      overwritten,
      latestDate: diaries
        .map(item => item.date)
        .sort((a, b) => b.localeCompare(a))[0],
    };
  } catch {
    return { success: false, message: '导入失败，文件格式无法识别。' };
  }
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

// ── Auto Updater ──

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新就绪',
      message: `新版本 ${info.version} 已下载完成，是否立即重启并安装？`,
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        app.isQuitting = true;
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', () => {});

  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000);

  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

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

  setupAutoUpdater();
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});
