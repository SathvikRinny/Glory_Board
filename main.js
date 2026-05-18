const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let controlWindow = null;
let stageWindow = null;
let pendingCaptureDisplayId = null; // set before getDisplayMedia so handler can pick the right screen
let presentationWindows = {}; // { displayId: BrowserWindow }
let selectedDisplayIds = new Set();
let syncMode = true;
let currentContent = {}; // { displayId: contentObject }

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 700,
    title: 'GloryBoard — Control',
    backgroundColor: '#0d0d0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: true,
  });

  controlWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  controlWindow.on('closed', () => {
    // Close all presentation windows
    Object.values(presentationWindows).forEach(w => { if (!w.isDestroyed()) w.close(); });
    app.quit();
  });
}

function getExternalDisplays() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return displays.filter(d => d.id !== primary.id);
}

function openPresentationWindow(displayId) {
  if (presentationWindows[displayId] && !presentationWindows[displayId].isDestroyed()) {
    return;
  }

  const displays = screen.getAllDisplays();
  const display = displays.find(d => d.id === displayId);
  if (!display) return;

  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    fullscreen: true,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  win.loadFile(path.join(__dirname, 'renderer', 'presentation.html'));

  win.once('ready-to-show', () => {
    win.show();
    // Send display info
    win.webContents.send('display-info', { displayId, bounds: display.bounds });
  });

  win.on('closed', () => {
    delete presentationWindows[displayId];
    selectedDisplayIds.delete(displayId);
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('display-closed', displayId);
    }
  });

  presentationWindows[displayId] = win;
}

function closePresentationWindow(displayId) {
  if (presentationWindows[displayId] && !presentationWindows[displayId].isDestroyed()) {
    presentationWindows[displayId].close();
  }
}

function sendToPresentation(displayId, channel, data) {
  const win = presentationWindows[displayId];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

function broadcastToSelected(channel, data) {
  selectedDisplayIds.forEach(id => sendToPresentation(id, channel, data));
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────

ipcMain.handle('get-displays', () => {
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return all.map(d => ({
    id: d.id,
    label: d.label || `Display ${d.id}`,
    bounds: d.bounds,
    isPrimary: d.id === primary.id,
    scaleFactor: d.scaleFactor,
    selected: selectedDisplayIds.has(d.id),
  }));
});

ipcMain.handle('select-display', (event, displayId) => {
  selectedDisplayIds.add(displayId);
  openPresentationWindow(displayId);
  return { ok: true };
});

ipcMain.handle('deselect-display', (event, displayId) => {
  selectedDisplayIds.delete(displayId);
  closePresentationWindow(displayId);
  return { ok: true };
});

ipcMain.handle('set-sync-mode', (event, enabled) => {
  syncMode = enabled;
  return { ok: true };
});

ipcMain.handle('push-content', (event, { displayId, content }) => {
  // content: { type: 'text'|'video'|'logo'|'blank', ...payload }
  if (syncMode && !displayId) {
    broadcastToSelected('show-content', content);
    selectedDisplayIds.forEach(id => { currentContent[id] = content; });
  } else if (displayId) {
    sendToPresentation(displayId, 'show-content', content);
    currentContent[displayId] = content;
  } else {
    broadcastToSelected('show-content', content);
    selectedDisplayIds.forEach(id => { currentContent[id] = content; });
  }
  // Forward to stage window
  if (stageWindow && !stageWindow.isDestroyed()) {
    stageWindow.webContents.send('show-content', content);
  }
  return { ok: true };
});

ipcMain.handle('open-stage-window', () => {
  if (stageWindow && !stageWindow.isDestroyed()) { stageWindow.focus(); return true; }
  stageWindow = new BrowserWindow({
    width: 820, height: 520, minWidth: 600, minHeight: 400,
    title: 'GloryBoard — Stage Display',
    backgroundColor: '#0a0a10',
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  stageWindow.loadFile(path.join(__dirname, 'renderer', 'stage.html'));
  stageWindow.on('closed', () => {
    stageWindow = null;
    if (controlWindow && !controlWindow.isDestroyed()) controlWindow.webContents.send('stage-window-closed');
  });
  return true;
});

ipcMain.handle('close-stage-window', () => {
  if (stageWindow && !stageWindow.isDestroyed()) stageWindow.close();
  return true;
});

ipcMain.handle('push-stage-update', (event, data) => {
  if (stageWindow && !stageWindow.isDestroyed()) stageWindow.webContents.send('stage-update', data);
  return true;
});

ipcMain.handle('read-pdf', async (event, filePath) => {
  try {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const result = await pdfParse(buffer);
    return result.text;
  } catch (e) {
    console.error('PDF parse failed:', e.message);
    return null;
  }
});

ipcMain.handle('blank-display', (event, displayId) => {
  if (displayId) {
    sendToPresentation(displayId, 'show-content', { type: 'blank' });
  } else {
    broadcastToSelected('show-content', { type: 'blank' });
  }
  return { ok: true };
});

ipcMain.handle('show-logo', (event, { displayId, logoPath, position, size, valign, halign }) => {
  const payload = { type: 'logo', logoPath, position, size, valign, halign };
  if (displayId) {
    sendToPresentation(displayId, 'show-content', payload);
  } else {
    broadcastToSelected('show-content', payload);
  }
  return { ok: true };
});

ipcMain.handle('pick-file', async (event, { filters }) => {
  const result = await dialog.showOpenDialog(controlWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  // Return file path + base64 for small files or just path for videos
  return filePath;
});

ipcMain.handle('read-file-base64', async (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
    const mime = mimeMap[ext] || 'application/octet-stream';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
});

ipcMain.handle('read-bible', async () => {
  const biblePath = path.join(__dirname, 'bible_full.json');
  try {
    return fs.readFileSync(biblePath, 'utf8');
  } catch (e) {
    console.error('read-bible failed:', e.message);
    return null;
  }
});

ipcMain.handle('get-screen-thumbnail', async (event, displayId) => {
  const win = presentationWindows[displayId];
  if (!win || win.isDestroyed()) return null;
  try {
    const image = await win.webContents.capturePage();
    // Downscale to 320×180 before base64-encoding — keeps IPC payload small
    const small = image.resize({ width: 320, height: 180, quality: 'good' });
    return small.toDataURL();
  } catch {
    return null;
  }
});

// Renderer calls this (via sendSync) right before getDisplayMedia() so the
// setDisplayMediaRequestHandler below knows which physical screen to capture.
ipcMain.on('prepare-screen-capture', (event, displayId) => {
  pendingCaptureDisplayId = displayId;
  event.returnValue = true;
});

app.whenReady().then(() => {
  const { session, desktopCapturer } = require('electron');

  // Auto-approve camera/media/display-capture permissions — trusted local app
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') callback(true);
    else callback(false);
  });

  // Live preview: intercept getDisplayMedia() calls from the control window and
  // select the screen source that matches the display the operator chose.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
      });

      const targetId = pendingCaptureDisplayId;
      pendingCaptureDisplayId = null;

      let source;
      if (targetId !== null) {
        // Match by display_id (works on most platforms)
        source = sources.find(s => String(s.display_id) === String(targetId));
      }
      if (!source) {
        // Fallback: use the first non-primary screen (covers the common single-projector case)
        const primary = screen.getPrimaryDisplay();
        source = sources.find(s => String(s.display_id) !== String(primary.id));
      }
      if (!source && sources.length > 0) {
        source = sources[sources.length - 1];
      }

      callback(source ? { video: source } : {});
    } catch (e) {
      callback({});
    }
  });

  // screen module is only safe to use after app ready
  screen.on('display-added', () => {
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('displays-changed');
    }
  });
  screen.on('display-removed', () => {
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('displays-changed');
    }
  });

  createControlWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
