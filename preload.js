const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gloryAPI', {
  // Display management
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  selectDisplay: (id) => ipcRenderer.invoke('select-display', id),
  deselectDisplay: (id) => ipcRenderer.invoke('deselect-display', id),
  setSyncMode: (enabled) => ipcRenderer.invoke('set-sync-mode', enabled),

  // Content
  pushContent: (payload) => ipcRenderer.invoke('push-content', payload),
  blankDisplay: (displayId) => ipcRenderer.invoke('blank-display', displayId),
  showLogo: (payload) => ipcRenderer.invoke('show-logo', payload),

  // Files
  readBible: () => ipcRenderer.invoke('read-bible'),
  pickFile: (opts) => ipcRenderer.invoke('pick-file', opts),
  readFileBase64: (path) => ipcRenderer.invoke('read-file-base64', path),
  getScreenThumbnail: (displayId) => ipcRenderer.invoke('get-screen-thumbnail', displayId),

  // Events from main process
  on: (channel, fn) => {
    const allowed = ['displays-changed', 'display-closed', 'display-info', 'show-content'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => fn(...args));
    }
  },
  off: (channel, fn) => {
    ipcRenderer.removeListener(channel, fn);
  },
});
