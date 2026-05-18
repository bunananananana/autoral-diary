const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, globalShortcut, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) app.quit();

let widgetWindow;
let mainWindow;
let exportWindow;
let knowledgeWindow;
let tray;
let knowledgeReminderTimer;

const dataDir = path.join(app.getPath('userData'), 'diaries');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const knowledgeDataPath = path.join(__dirname, 'data', 'knowledge-cards.json');
const knowledgeStatePath = path.join(app.getPath('userData'), 'knowledge-state.json');
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

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function loadAppSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    return {
      ...parsed,
      knowledgeReminderEnabled: parsed.knowledgeReminderEnabled !== false,
    };
  } catch {
    return { knowledgeReminderEnabled: true };
  }
}

function saveAppSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

function setKnowledgeReminderEnabled(enabled) {
  const settings = loadAppSettings();
  settings.knowledgeReminderEnabled = enabled !== false;
  saveAppSettings(settings);

  if (settings.knowledgeReminderEnabled) {
    scheduleKnowledgeReminder();
  } else {
    if (knowledgeReminderTimer) {
      clearTimeout(knowledgeReminderTimer);
      knowledgeReminderTimer = null;
    }
    if (knowledgeWindow && !knowledgeWindow.isDestroyed()) {
      knowledgeWindow.close();
    }
  }

  return settings;
}

function loadKnowledgeCards() {
  try {
    const cards = JSON.parse(fs.readFileSync(knowledgeDataPath, 'utf-8'));
    return Array.isArray(cards) ? cards.filter((card) => card && card.id) : [];
  } catch {
    return [];
  }
}

function loadKnowledgeState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(knowledgeStatePath, 'utf-8'));
    return {
      readIds: Array.isArray(parsed.readIds) ? parsed.readIds : [],
      favoriteIds: Array.isArray(parsed.favoriteIds) ? parsed.favoriteIds : [],
      dismissedDates: Array.isArray(parsed.dismissedDates) ? parsed.dismissedDates : [],
      lastShownDate: typeof parsed.lastShownDate === 'string' ? parsed.lastShownDate : '',
      lastShownId: typeof parsed.lastShownId === 'string' ? parsed.lastShownId : '',
    };
  } catch {
    return { readIds: [], favoriteIds: [], dismissedDates: [], lastShownDate: '', lastShownId: '' };
  }
}

function saveKnowledgeState(state) {
  fs.writeFileSync(knowledgeStatePath, JSON.stringify(state, null, 2), 'utf-8');
}

function pickKnowledgeCard(mode = 'today') {
  const cards = loadKnowledgeCards();
  if (!cards.length) return null;

  const state = loadKnowledgeState();
  const today = todayStr();
  if (mode === 'today' && state.lastShownDate === today) {
    const existing = cards.find((card) => card.id === state.lastShownId);
    if (existing) return existing;
  }

  const readIds = new Set(state.readIds);
  const unread = cards.filter((card) => !readIds.has(card.id));
  const pool = unread.length ? unread : cards;
  const seed = Number(today.replace(/-/g, ''));
  const offset = mode === 'next' ? Math.floor(Math.random() * pool.length) : seed;
  const card = pool[offset % pool.length];

  state.lastShownDate = today;
  state.lastShownId = card.id;
  saveKnowledgeState(state);
  return card;
}

function createKnowledgeWindow() {
  if (knowledgeWindow && !knowledgeWindow.isDestroyed()) {
    knowledgeWindow.show();
    knowledgeWindow.focus();
    return;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  knowledgeWindow = new BrowserWindow({
    width: 520,
    height: 680,
    minWidth: 460,
    minHeight: 560,
    x: Math.max(20, width - 560),
    y: Math.max(20, height - 740),
    title: '今日小知识',
    show: false,
    resizable: true,
    backgroundColor: '#f6f7f4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  knowledgeWindow.loadFile('knowledge.html');
  knowledgeWindow.once('ready-to-show', () => {
    knowledgeWindow.show();
    knowledgeWindow.focus();
  });
  knowledgeWindow.on('closed', () => { knowledgeWindow = null; });
}

function shouldShowKnowledgeReminder() {
  if (!loadAppSettings().knowledgeReminderEnabled) return false;
  const state = loadKnowledgeState();
  const today = todayStr();
  const now = new Date();
  const afterNine = now.getHours() >= 9;
  return afterNine && state.lastShownDate !== today && !state.dismissedDates.includes(today);
}

function scheduleKnowledgeReminder() {
  if (knowledgeReminderTimer) clearTimeout(knowledgeReminderTimer);
  knowledgeReminderTimer = null;
  if (!loadAppSettings().knowledgeReminderEnabled) return;

  const now = new Date();
  const next = new Date(now);
  next.setHours(9, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  knowledgeReminderTimer = setTimeout(() => {
    if (!loadAppSettings().knowledgeReminderEnabled) {
      scheduleKnowledgeReminder();
      return;
    }
    const state = loadKnowledgeState();
    if (!state.dismissedDates.includes(todayStr())) {
      createKnowledgeWindow();
    }
    scheduleKnowledgeReminder();
  }, next.getTime() - now.getTime());

  if (shouldShowKnowledgeReminder()) {
    setTimeout(() => createKnowledgeWindow(), 1500);
  }
}

function buildDiaryPreview(content) {
  return String(content || '')
    .replace(/[#*_~`>\-\[\]]/g, '')
    .trim()
    .substring(0, 60);
}

function createTrayIcon() {
  const s = 16;
  const buf = Buffer.alloc(s * s * 4, 0);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || x >= s || y < 0 || y >= s) return;
    const i = (y * s + x) * 4;
    buf[i] = b;
    buf[i + 1] = g;
    buf[i + 2] = r;
    buf[i + 3] = a;
  };
  const fill = (x1, y1, x2, y2, r, g, b, a = 255) => {
    for (let y = y1; y <= y2; y += 1) {
      for (let x = x1; x <= x2; x += 1) set(x, y, r, g, b, a);
    }
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
    title: 'Autoral 日记本',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadFile('app.html');

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createExportWindow() {
  if (exportWindow && !exportWindow.isDestroyed()) {
    exportWindow.show();
    exportWindow.focus();
    return;
  }

  exportWindow = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 460,
    minHeight: 560,
    parent: mainWindow,
    modal: true,
    show: false,
    title: '导出日记',
    backgroundColor: '#f7f7f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  exportWindow.loadFile('export.html');
  exportWindow.once('ready-to-show', () => exportWindow.show());
  exportWindow.on('closed', () => { exportWindow = null; });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : createTrayIcon();

  tray = new Tray(icon);

  const buildMenu = () => Menu.buildFromTemplate([
    { label: '打开日记本', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: '今日小知识', click: () => createKnowledgeWindow() },
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

ipcMain.handle('diary:save', async (_, date, content) => saveDiaryToDisk(date, content));

ipcMain.handle('diary:load', async (_, date) => loadDiaryFromDisk(date));

ipcMain.handle('diary:list', async () => {
  if (!fs.existsSync(dataDir)) return [];
  const files = fs.readdirSync(dataDir).filter(file => file.endsWith('.json'));
  const entries = files.map((file) => {
    try {
      const raw = fs.readFileSync(path.join(dataDir, file), 'utf-8');
      const data = JSON.parse(raw);
      return {
        date: data.date,
        preview: buildDiaryPreview(data.content),
        updatedAt: data.updatedAt
      };
    } catch {
      return null;
    }
  }).filter(Boolean);

  return entries.sort((a, b) => b.date.localeCompare(a.date));
});

ipcMain.handle('diary:delete', async (_, date) => {
  const filePath = getDiaryFilePath(date);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
});

ipcMain.handle('diary:export', async (_, dates) => {
  const requestedDates = Array.isArray(dates) ? dates : [dates];
  const normalizedDates = [...new Set(requestedDates.filter(Boolean))].sort((a, b) => b.localeCompare(a));
  const diaries = normalizedDates.map((date) => loadDiaryFromDisk(date)).filter(Boolean);

  if (!diaries.length) {
    return { success: false, message: '未找到可导出的日记。' };
  }

  const defaultName = diaries.length === 1
    ? `autoral-diary-${diaries[0].date}.${exportFileExtension}`
    : `autoral-diaries-${new Date().toISOString().slice(0, 10)}.${exportFileExtension}`;

  const ownerWindow = exportWindow && !exportWindow.isDestroyed() ? exportWindow : mainWindow;
  const result = await dialog.showSaveDialog(ownerWindow, {
    title: '导出日记',
    defaultPath: defaultName,
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
    diaries,
  };

  fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return { success: true, filePath: result.filePath, count: diaries.length };
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
    const diaries = rawDiaries.map((item) => normalizeDiaryPayload(item, item?.date)).filter(Boolean);

    if (!diaries.length) {
      return { success: false, message: '导入文件中没有有效的日记内容。' };
    }

    let imported = 0;
    let appended = 0;

    for (const diary of diaries) {
      const existing = loadDiaryFromDisk(diary.date);
      if (existing && existing.content.trim()) {
        const merged = [existing.content.trimEnd(), '', '---', '', diary.content.trimStart()].join('\n');
        saveDiaryToDisk(diary.date, merged, new Date().toISOString());
        appended += 1;
      } else {
        saveDiaryToDisk(diary.date, diary.content, diary.updatedAt);
      }
      imported += 1;
    }

    return {
      success: true,
      filePath,
      imported,
      appended,
      latestDate: diaries.map((item) => item.date).sort((a, b) => b.localeCompare(a))[0],
    };
  } catch {
    return { success: false, message: '导入失败，文件格式无法识别。' };
  }
});

ipcMain.handle('app:open-main', async () => {
  mainWindow.show();
  mainWindow.focus();
});

ipcMain.handle('app:open-export-window', async () => {
  createExportWindow();
  return true;
});

ipcMain.handle('app:close-export-window', async () => {
  if (exportWindow && !exportWindow.isDestroyed()) {
    exportWindow.close();
  }
  return true;
});

ipcMain.handle('knowledge:get-card', async (_, mode) => pickKnowledgeCard(mode));

ipcMain.handle('knowledge:get-state', async () => loadKnowledgeState());

ipcMain.handle('knowledge:mark-read', async (_, id) => {
  const state = loadKnowledgeState();
  if (id && !state.readIds.includes(id)) state.readIds.push(id);
  state.lastShownDate = todayStr();
  state.lastShownId = id || state.lastShownId;
  saveKnowledgeState(state);
  return true;
});

ipcMain.handle('knowledge:favorite', async (_, id) => {
  const state = loadKnowledgeState();
  if (id && !state.favoriteIds.includes(id)) state.favoriteIds.push(id);
  saveKnowledgeState(state);
  return true;
});

ipcMain.handle('knowledge:dismiss-today', async () => {
  const state = loadKnowledgeState();
  const today = todayStr();
  if (!state.dismissedDates.includes(today)) state.dismissedDates.push(today);
  saveKnowledgeState(state);
  return true;
});

ipcMain.handle('knowledge:insert-to-diary', async (_, id) => {
  const card = loadKnowledgeCards().find((item) => item.id === id);
  if (!card) return false;

  const date = todayStr();
  const existing = loadDiaryFromDisk(date);
  const snippet = [
    '今日学到：',
    `- ${card.title}：${card.takeaway}`,
    `- ${card.content}`,
  ].join('\n');
  const content = existing?.content?.trim()
    ? `${existing.content.trimEnd()}\n\n${snippet}`
    : snippet;

  saveDiaryToDisk(date, content);
  return true;
});

ipcMain.handle('knowledge:close-window', async () => {
  if (knowledgeWindow && !knowledgeWindow.isDestroyed()) {
    knowledgeWindow.close();
  }
  return true;
});

ipcMain.handle('settings:get', async () => loadAppSettings());

ipcMain.handle('settings:set-knowledge-reminder', async (_, enabled) => setKnowledgeReminderEnabled(enabled));

ipcMain.handle('widget:pick-bg', async () => {
  const result = await dialog.showOpenDialog(widgetWindow, {
    title: '选择背景图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }]
  });
  if (result.canceled || !result.filePaths.length) return null;

  const src = result.filePaths[0];
  const ext = path.extname(src).slice(1).toLowerCase();
  const dest = path.join(app.getPath('userData'), `widget-bg.${ext}`);
  fs.copyFileSync(src, dest);

  const settings = loadAppSettings();
  settings.widgetBg = dest;
  saveAppSettings(settings);

  const buf = fs.readFileSync(dest);
  const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
  return `data:${mimeMap[ext] || 'image/png'};base64,${buf.toString('base64')}`;
});

ipcMain.handle('widget:get-bg', async () => {
  try {
    const settings = loadAppSettings();
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
  const settings = loadAppSettings();
  if (settings.widgetBg && fs.existsSync(settings.widgetBg)) {
    try { fs.unlinkSync(settings.widgetBg); } catch {}
  }
  delete settings.widgetBg;
  saveAppSettings(settings);
  return true;
});

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

app.whenReady().then(() => {
  createWidgetWindow();
  createMainWindow();
  createTray();
  scheduleKnowledgeReminder();

  globalShortcut.register('CommandOrControl+Shift+D', () => {
    if (widgetWindow.isVisible()) widgetWindow.hide();
    else {
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
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});
