const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { launchGame, launchGameWithVersionCheck, installGame, saveUsername, loadUsername, saveChatUsername, loadChatUsername, saveJavaPath, loadJavaPath, saveInstallPath, loadInstallPath, isGameInstalled, uninstallGame, getHytaleNews, handleFirstLaunchCheck, proposeGameUpdate, markAsLaunched } = require('./backend/launcher');
const UpdateManager = require('./backend/updateManager');

let mainWindow;
let updateManager;
let discordRPC = null;

// Discord Rich Presence setup
const DISCORD_CLIENT_ID = '1462244937868513373';

function initDiscordRPC() {
  try {
    const { Client } = require('discord-rpc');
    discordRPC = new Client({ transport: 'ipc' });
    
    discordRPC.on('ready', () => {
      console.log('Discord RPC connected');
      setDiscordActivity();
    });
    
    discordRPC.on('disconnected', () => {
      console.log('Discord RPC disconnected');
    });
    
    discordRPC.login({ clientId: DISCORD_CLIENT_ID }).catch(err => {
      console.log('Failed to connect to Discord:', err.message);
    });
  } catch (error) {
    console.log('Discord RPC module not available:', error.message);
  }
}

function setDiscordActivity() {
  if (!discordRPC) return;
  
  try {
    discordRPC.setActivity({
      details: 'Using HytaleF2P',
      startTimestamp: Date.now(),
      largeImageKey: 'hytale_logo',
      largeImageText: 'Hytale F2P Launcher',
      buttons: [
        {
          label: 'GitHub',
          url: 'https://github.com/amiayweb/Hytale-F2P'
        }
      ]
    });
  } catch (error) {
    console.error('Failed to set Discord activity:', error.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    frame: false,
    resizable: false,
    alwaysOnTop: false,
    backgroundColor: '#090909',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true,
      webSecurity: true
    }
  });

  mainWindow.loadFile('GUI/index.html');

  // Initialize Discord Rich Presence
  initDiscordRPC();

  updateManager = new UpdateManager();
  setTimeout(async () => {
    const updateInfo = await updateManager.checkForUpdates();
    if (updateInfo.updateAvailable) {
      mainWindow.webContents.send('show-update-popup', updateInfo);
    }
  }, 3000);


   mainWindow.webContents.on('devtools-opened', () => {
   mainWindow.webContents.closeDevTools();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
    }
    if (input.control && input.shift && input.key.toLowerCase() === 'j') {
      event.preventDefault();
    }
    if (input.control && input.shift && input.key.toLowerCase() === 'c') {
      event.preventDefault();
    }
    if (input.key === 'F12') {
      event.preventDefault();
    }
    if (input.key === 'F5') {
      event.preventDefault();
    }
  });


  mainWindow.webContents.on('context-menu', (e) => {
    e.preventDefault();
  });

  mainWindow.webContents.setIgnoreMenuShortcuts(true);
}

app.whenReady().then(async () => {
  createWindow();
  
  setTimeout(async () => {
    try {
      console.log('Starting first launch check...');
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('lock-play-button', true);
      }
      
      const progressCallback = (message, percent, speed, downloaded, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('first-launch-progress', { message, percent, speed, downloaded, total });
        }
      };

      const firstLaunchResult = await handleFirstLaunchCheck(progressCallback);
      
      console.log('First launch check result:', firstLaunchResult);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (firstLaunchResult.needsUpdate && firstLaunchResult.existingGame) {
          console.log('Sending show-first-launch-update event...');
          
          setTimeout(() => {
            mainWindow.webContents.send('show-first-launch-update', {
              existingGame: firstLaunchResult.existingGame,
              isFirstLaunch: firstLaunchResult.isFirstLaunch
            });
          }, 1000);
          
        } else if (firstLaunchResult.isFirstLaunch && !firstLaunchResult.existingGame) {
          console.log('Sending show-first-launch-welcome event...');
          
          setTimeout(() => {
            mainWindow.webContents.send('show-first-launch-welcome');
          }, 1000);
        } else {
          mainWindow.webContents.send('lock-play-button', false);
        }
      }
    } catch (error) {
      console.error('Error during first launch check:', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('lock-play-button', false);
      }
    }
  }, 3000);
});

app.on('window-all-closed', () => {
  // Clean up Discord RPC connection
  if (discordRPC) {
    try {
      discordRPC.destroy();
    } catch (error) {
      console.log('Error cleaning up Discord RPC:', error.message);
    }
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('launch-game', async (event, playerName, javaPath, installPath) => {
  try {
    const progressCallback = (message, percent, speed, downloaded, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const data = {
          message: message || null,
          percent: percent !== null && percent !== undefined ? Math.min(100, Math.max(0, percent)) : null,
          speed: speed !== null && speed !== undefined ? speed : null,
          downloaded: downloaded !== null && downloaded !== undefined ? downloaded : null,
          total: total !== null && total !== undefined ? total : null
        };
        mainWindow.webContents.send('progress-update', data);
      }
    };

    const result = await launchGameWithVersionCheck(playerName, progressCallback, javaPath, installPath);
    
    return result;
  } catch (error) {
    console.error('Launch error:', error);
    const errorMessage = error.message || error.toString();
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('install-game', async (event, playerName, javaPath, installPath) => {
  try {
    const progressCallback = (message, percent, speed, downloaded, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const data = {
          message: message || null,
          percent: percent !== null && percent !== undefined ? Math.min(100, Math.max(0, percent)) : null,
          speed: speed !== null && speed !== undefined ? speed : null,
          downloaded: downloaded !== null && downloaded !== undefined ? downloaded : null,
          total: total !== null && total !== undefined ? total : null
        };
        mainWindow.webContents.send('progress-update', data);
      }
    };

    const result = await installGame(playerName, progressCallback, javaPath, installPath);
    
    return result;
  } catch (error) {
    console.error('Install error:', error);
    const errorMessage = error.message || error.toString();
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('save-username', (event, username) => {
  saveUsername(username);
  return { success: true };
});

ipcMain.handle('load-username', () => {
  return loadUsername();
});
ipcMain.handle('save-chat-username', async (event, chatUsername) => {
  saveChatUsername(chatUsername);
});

ipcMain.handle('load-chat-username', async () => {
  return loadChatUsername();
});
ipcMain.handle('save-java-path', (event, javaPath) => {
  saveJavaPath(javaPath);
  return { success: true };
});

ipcMain.handle('load-java-path', () => {
  return loadJavaPath();
});

ipcMain.handle('save-install-path', (event, installPath) => {
  saveInstallPath(installPath);
  return { success: true };
});

ipcMain.handle('load-install-path', () => {
  return loadInstallPath();
});

ipcMain.handle('select-install-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Installation Folder'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('accept-first-launch-update', async (event, existingGame) => {
  try {
    const progressCallback = (message, percent, speed, downloaded, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const data = {
          message: message || null,
          percent: percent !== null && percent !== undefined ? Math.min(100, Math.max(0, percent)) : null,
          speed: speed !== null && speed !== undefined ? speed : null,
          downloaded: downloaded !== null && downloaded !== undefined ? downloaded : null,
          total: total !== null && total !== undefined ? total : null
        };
        mainWindow.webContents.send('first-launch-progress', data);
      }
    };

    const result = await proposeGameUpdate(existingGame, progressCallback);
    
    return result;
  } catch (error) {
    console.error('First launch update error:', error);
    const errorMessage = error.message || error.toString();
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('mark-as-launched', async () => {
  try {
    markAsLaunched();
    return { success: true };
  } catch (error) {
    console.error('Mark as launched error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('is-game-installed', () => {
  return isGameInstalled();
});

ipcMain.handle('uninstall-game', async () => {
  try {
    await uninstallGame();
    return { success: true };
  } catch (error) {
    console.error('Uninstall error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-hytale-news', async () => {
  try {
    const news = await getHytaleNews();
    return news;
  } catch (error) {
    console.error('News fetch error:', error);
    return [];
  }
});

ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('Failed to open external URL:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('browse-java-path', async () => {
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  
  let dialogOptions;
  
  if (isWindows) {
    dialogOptions = {
      properties: ['openFile'],
      title: 'Select Java Executable',
      filters: [
        { name: 'Java Executable', extensions: ['exe'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    };
  } else if (isMac) {
    dialogOptions = {
      properties: ['openFile'],
      title: 'Select Java Executable',
      message: 'Select java executable (usually in /Library/Java/JavaVirtualMachines/*/Contents/Home/bin/java)',
      filters: [
        { name: 'All Files', extensions: ['*'] }
      ]
    };
  } else {
    dialogOptions = {
      properties: ['openFile'],
      title: 'Select Java Executable',
      message: 'Select java executable (usually /usr/bin/java or similar)',
      filters: [
        { name: 'All Files', extensions: ['*'] }
      ]
    };
  }
  
  const result = await dialog.showOpenDialog(mainWindow, dialogOptions);
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    if (settings.playerName) saveUsername(settings.playerName);
    if (settings.javaPath !== undefined) saveJavaPath(settings.javaPath);
    if (settings.installPath !== undefined) saveInstallPath(settings.installPath);
    return { success: true };
  } catch (error) {
    console.error('Save settings error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-settings', async () => {
  try {
    return {
      playerName: loadUsername() || 'Player',
      javaPath: loadJavaPath() || '',
      installPath: loadInstallPath() || '',
      customInstall: false
    };
  } catch (error) {
    console.error('Load settings error:', error);
    return {
      playerName: 'Player',
      javaPath: '',
      installPath: '',
      customInstall: false
    };
  }
});

const { getModsPath, loadInstalledMods, downloadMod, uninstallMod, toggleMod } = require('./backend/launcher');
const os = require('os');

ipcMain.handle('get-local-app-data', async () => {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
});

ipcMain.handle('get-user-id', async () => {
  try {
    const { getOrCreatePlayerId } = require('./backend/launcher');
    return await getOrCreatePlayerId();
  } catch (error) {
    console.error('Error getting user ID:', error);
    return null;
  }
});

ipcMain.handle('load-installed-mods', async (event, modsPath) => {
  try {
    return await loadInstalledMods(modsPath);
  } catch (error) {
    console.error('Error loading installed mods:', error);
    return [];
  }
});

ipcMain.handle('openExternalLink', async (event, url) => {
  try {
    console.log('Opening external URL:', url);
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('Error opening external link:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('download-mod', async (event, modInfo) => {
  try {
    return await downloadMod(modInfo);
  } catch (error) {
    console.error('Error downloading mod:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('uninstall-mod', async (event, modId, modsPath) => {
  try {
    return await uninstallMod(modId, modsPath);
  } catch (error) {
    console.error('Error uninstalling mod:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('toggle-mod', async (event, modId, modsPath) => {
  try {
    return await toggleMod(modId, modsPath);
  } catch (error) {
    console.error('Error toggling mod:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-mods-path', async () => {
  try {
    return await getModsPath();
  } catch (error) {
    console.error('Error getting mods path:', error);
    return null;
  }
});

ipcMain.handle('select-mod-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Select Mod Files',
    filters: [
      { name: 'Mod Files', extensions: ['jar', 'zip'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths;
  }
  return null;
});

ipcMain.handle('copy-mod-file', async (event, sourcePath, modsPath) => {
  try {
    const fileName = path.basename(sourcePath);
    const destPath = path.join(modsPath, fileName);
    
    fs.copyFileSync(sourcePath, destPath);
    
    return { success: true, fileName };
  } catch (error) {
    console.error('Error copying mod file:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-for-updates', async () => {
  try {
    return await updateManager.checkForUpdates();
  } catch (error) {
    console.error('Error checking for updates:', error);
    return { updateAvailable: false, error: error.message };
  }
});

ipcMain.handle('open-download-page', async () => {
  try {
    await shell.openExternal(updateManager.getDownloadUrl());
    
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }
    }, 1000);
    
    return { success: true };
  } catch (error) {
    console.error('Error opening download page:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-update-info', async () => {
  return updateManager.getUpdateInfo();
});

ipcMain.handle('window-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.handle('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});
