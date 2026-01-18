const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  launchGame: (playerName, javaPath, installPath) => ipcRenderer.invoke('launch-game', playerName, javaPath, installPath),
  installGame: (playerName, javaPath, installPath) => ipcRenderer.invoke('install-game', playerName, javaPath, installPath),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  saveUsername: (username) => ipcRenderer.invoke('save-username', username),
  loadUsername: () => ipcRenderer.invoke('load-username'),
  saveChatUsername: (chatUsername) => ipcRenderer.invoke('save-chat-username', chatUsername),
  loadChatUsername: () => ipcRenderer.invoke('load-chat-username'),
  saveJavaPath: (javaPath) => ipcRenderer.invoke('save-java-path', javaPath),
  loadJavaPath: () => ipcRenderer.invoke('load-java-path'),
  saveInstallPath: (installPath) => ipcRenderer.invoke('save-install-path', installPath),
  loadInstallPath: () => ipcRenderer.invoke('load-install-path'),
  selectInstallPath: () => ipcRenderer.invoke('select-install-path'),
  browseJavaPath: () => ipcRenderer.invoke('browse-java-path'),
  isGameInstalled: () => ipcRenderer.invoke('is-game-installed'),
  uninstallGame: () => ipcRenderer.invoke('uninstall-game'),
  getHytaleNews: () => ipcRenderer.invoke('get-hytale-news'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openExternalLink: (url) => ipcRenderer.invoke('openExternalLink', url),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  getLocalAppData: () => ipcRenderer.invoke('get-local-app-data'),
  getModsPath: () => ipcRenderer.invoke('get-mods-path'),
  loadInstalledMods: (modsPath) => ipcRenderer.invoke('load-installed-mods', modsPath),
  downloadMod: (modInfo) => ipcRenderer.invoke('download-mod', modInfo),
  uninstallMod: (modId, modsPath) => ipcRenderer.invoke('uninstall-mod', modId, modsPath),
  toggleMod: (modId, modsPath) => ipcRenderer.invoke('toggle-mod', modId, modsPath),
  selectModFiles: () => ipcRenderer.invoke('select-mod-files'),
  copyModFile: (sourcePath, modsPath) => ipcRenderer.invoke('copy-mod-file', sourcePath, modsPath),
  onProgressUpdate: (callback) => {
    ipcRenderer.on('progress-update', (event, data) => callback(data));
  },
  getUserId: () => ipcRenderer.invoke('get-user-id'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  openDownloadPage: () => ipcRenderer.invoke('open-download-page'),
  getUpdateInfo: () => ipcRenderer.invoke('get-update-info'),
  onUpdatePopup: (callback) => {
    ipcRenderer.on('show-update-popup', (event, data) => callback(data));
  },
  
  acceptFirstLaunchUpdate: (existingGame) => ipcRenderer.invoke('accept-first-launch-update', existingGame),
  markAsLaunched: () => ipcRenderer.invoke('mark-as-launched'),
  onFirstLaunchUpdate: (callback) => {
    ipcRenderer.on('show-first-launch-update', (event, data) => callback(data));
  },
  onFirstLaunchWelcome: (callback) => {
    ipcRenderer.on('show-first-launch-welcome', () => callback());
  },
  onFirstLaunchProgress: (callback) => {
    ipcRenderer.on('first-launch-progress', (event, data) => callback(data));
  },
  onLockPlayButton: (callback) => {
    ipcRenderer.on('lock-play-button', (event, locked) => callback(locked));
  }
});
