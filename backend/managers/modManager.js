const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { getOS } = require('../utils/platformUtils');
const { getModsPath, getProfilesDir } = require('../core/paths');
const { saveModsToConfig, loadModsFromConfig } = require('../core/config');
const profileManager = require('./profileManager');

const API_KEY = "$2a$10$bqk254NMZOWVTzLVJCcxEOmhcyUujKxA5xk.kQCN9q0KNYFJd5b32";

/**
 * Get the physical mods path for a specific profile.
 * Each profile now has its own 'mods' folder.
 */
function getProfileModsPath(profileId) {
  const profilesDir = getProfilesDir();
  if (!profilesDir) return null;
  
  const profileDir = path.join(profilesDir, profileId);
  const modsDir = path.join(profileDir, 'mods');
  
  if (!fs.existsSync(modsDir)) {
    fs.mkdirSync(modsDir, { recursive: true });
  }
  
  return modsDir;
}

function generateModId(filename) {
  return crypto.createHash('md5').update(filename).digest('hex').substring(0, 8);
}

function extractModName(filename) {
  let name = path.parse(filename).name;

  name = name.replace(/-v?\d+\.[\d\.]+.*$/i, '');
  name = name.replace(/-\d+\.[\d\.]+.*$/i, '');

  name = name.replace(/[-_]/g, ' ');
  name = name.replace(/\b\w/g, l => l.toUpperCase());

  return name || 'Unknown Mod';
}

function extractVersion(filename) {
  const versionMatch = filename.match(/v?(\d+\.[\d\.]+)/);
  return versionMatch ? versionMatch[1] : null;
}

// Helper to get mods from active profile
function getProfileMods() {
  const profile = profileManager.getActiveProfile();
  return profile ? (profile.mods || []) : [];
}

async function loadInstalledMods(modsPath) {
  try {
    // Sync first to ensure we detect any manually added mods and paths are correct
    await syncModsForCurrentProfile();

    const activeProfile = profileManager.getActiveProfile();
    if (!activeProfile) return [];

    const profileMods = activeProfile.mods || [];
    
    // Use profile-specific paths
    const profileModsPath = getProfileModsPath(activeProfile.id);
    const profileDisabledModsPath = path.join(path.dirname(profileModsPath), 'DisabledMods');
    
    if (!fs.existsSync(profileModsPath)) fs.mkdirSync(profileModsPath, { recursive: true });
    if (!fs.existsSync(profileDisabledModsPath)) fs.mkdirSync(profileDisabledModsPath, { recursive: true });

    const validMods = [];

    for (const modConfig of profileMods) {
      // Check if file exists in either location
      const inEnabled = fs.existsSync(path.join(profileModsPath, modConfig.fileName));
      const inDisabled = fs.existsSync(path.join(profileDisabledModsPath, modConfig.fileName));

      if (inEnabled || inDisabled) {
        validMods.push({
          ...modConfig,
          // Set filePath based on physical location
          filePath: inEnabled ? path.join(profileModsPath, modConfig.fileName) : path.join(profileDisabledModsPath, modConfig.fileName),
          enabled: modConfig.enabled !== false // Default true
        });
      } else {
        console.warn(`[ModManager] Mod ${modConfig.fileName} listed in profile but not found on disk.`);
        // Include it so user can see it's missing or remove it
        validMods.push({
          ...modConfig,
          filePath: null,
          missing: true,
          enabled: modConfig.enabled !== false
        });
      }
    }

    return validMods;
  } catch (error) {
    console.error('Error loading installed mods:', error);
    return [];
  }
}

async function downloadMod(modInfo) {
  try {
    const activeProfile = profileManager.getActiveProfile();
    if (!activeProfile) throw new Error('No active profile to save mod to');

    const modsPath = getProfileModsPath(activeProfile.id);
    if (!modsPath) throw new Error('Could not determine profile mods path');

    if (!modInfo.downloadUrl && !modInfo.fileId) {
      throw new Error('No download URL or file ID provided');
    }

    let downloadUrl = modInfo.downloadUrl;

    if (!downloadUrl && modInfo.fileId && modInfo.modId) {
      const response = await axios.get(`https://api.curseforge.com/v1/mods/${modInfo.modId || modInfo.curseForgeId}/files/${modInfo.fileId || modInfo.curseForgeFileId}`, {
        headers: {
          'x-api-key': modInfo.apiKey || API_KEY,
          'Accept': 'application/json'
        }
      });

      downloadUrl = response.data.data.downloadUrl;
    }

    if (!downloadUrl) {
      throw new Error('Could not determine download URL');
    }

    const fileName = modInfo.fileName || `mod-${modInfo.modId}.jar`;
    const filePath = path.join(modsPath, fileName);

    const response = await axios({
      method: 'get',
      url: downloadUrl,
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        // Update Active Profile
        const newMod = {
          id: modInfo.id || generateModId(fileName),
          name: modInfo.name || extractModName(fileName),
          version: modInfo.version || '1.0.0',
          description: modInfo.summary || modInfo.description || 'Downloaded from CurseForge',
          author: modInfo.author || 'Unknown',
          enabled: true,
          fileName: fileName,
          fileSize: fs.statSync(filePath).size,
          dateInstalled: new Date().toISOString(),
          curseForgeId: modInfo.modId,
          curseForgeFileId: modInfo.fileId
        };

        const updatedMods = [...(activeProfile.mods || []), newMod];
        profileManager.updateProfile(activeProfile.id, { mods: updatedMods });

        resolve({
          success: true,
          filePath: filePath,
          fileName: fileName,
          modInfo: newMod
        });
      });
      writer.on('error', reject);
    });

  } catch (error) {
    console.error('Error downloading mod:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function uninstallMod(modId, modsPath) {
  try {
    const activeProfile = profileManager.getActiveProfile();
    if (!activeProfile) throw new Error('No active profile');

    const profileMods = activeProfile.mods || [];
    const mod = profileMods.find(m => m.id === modId);

    if (!mod) {
      throw new Error('Mod not found in profile');
    }

    // Use profile paths
    const profileModsPath = getProfileModsPath(activeProfile.id);
    const disabledModsPath = path.join(path.dirname(profileModsPath), 'DisabledMods');
    
    const enabledPath = path.join(profileModsPath, mod.fileName);
    const disabledPath = path.join(disabledModsPath, mod.fileName);

    let fileRemoved = false;
    // Try to remove file from both locations to be safe
    if (fs.existsSync(enabledPath)) {
      fs.unlinkSync(enabledPath);
      fileRemoved = true;
    }
    if (fs.existsSync(disabledPath)) {
      try { fs.unlinkSync(disabledPath); fileRemoved = true; } catch (e) { }
    }

    if (!fileRemoved) {
      console.warn('Mod file not found on filesystem, removing from profile anyway');
    }

    const updatedMods = profileMods.filter(m => m.id !== modId);
    profileManager.updateProfile(activeProfile.id, { mods: updatedMods });

    console.log('Mod removed from profile');

    return { success: true };
  } catch (error) {
    console.error('Error uninstalling mod:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function toggleMod(modId, modsPath) {
  try {
    const activeProfile = profileManager.getActiveProfile();
    if (!activeProfile) throw new Error('No active profile');

    const profileMods = activeProfile.mods || [];
    const modIndex = profileMods.findIndex(m => m.id === modId);

    if (modIndex === -1) {
      throw new Error('Mod not found in profile');
    }

    const mod = profileMods[modIndex];
    const newEnabled = !mod.enabled; // Toggle

    // Update Profile First
    const updatedMods = [...profileMods];
    updatedMods[modIndex] = { ...mod, enabled: newEnabled };
    profileManager.updateProfile(activeProfile.id, { mods: updatedMods });

    // Move file between Profile/Mods and Profile/DisabledMods
    const profileModsPath = getProfileModsPath(activeProfile.id);
    const disabledModsPath = path.join(path.dirname(profileModsPath), 'DisabledMods');
    
    if (!fs.existsSync(disabledModsPath)) fs.mkdirSync(disabledModsPath, { recursive: true });

    const currentPath = mod.enabled ? path.join(profileModsPath, mod.fileName) : path.join(disabledModsPath, mod.fileName);
    const targetDir = newEnabled ? profileModsPath : disabledModsPath;
    const targetPath = path.join(targetDir, mod.fileName);

    if (fs.existsSync(currentPath)) {
      fs.renameSync(currentPath, targetPath);
    } else {
      // Fallback: check if it's already in target?
      if (fs.existsSync(targetPath)) {
        console.log(`[ModManager] Mod ${mod.fileName} is already in the correct state`);
      } else {
        // Try finding it
        const altPath = mod.enabled ? path.join(disabledModsPath, mod.fileName) : path.join(profileModsPath, mod.fileName);
        if (fs.existsSync(altPath)) fs.renameSync(altPath, targetPath);
      }
    }

    return { success: true, enabled: newEnabled };
  } catch (error) {
    console.error('Error toggling mod:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function syncModsForCurrentProfile() {
  try {
    const activeProfile = profileManager.getActiveProfile();
    if (!activeProfile) {
      console.warn('No active profile found during mod sync');
      return;
    }

    console.log(`[ModManager] Syncing mods for profile: ${activeProfile.name} (${activeProfile.id})`);

    // 1. Resolve Paths
    // globalModsPath is the one the game uses (symlink target)
    const globalModsPath = await getModsPath(); 
    // profileModsPath is the real storage for this profile
    const profileModsPath = getProfileModsPath(activeProfile.id);
    const profileDisabledModsPath = path.join(path.dirname(profileModsPath), 'DisabledMods');

    if (!fs.existsSync(profileDisabledModsPath)) {
      fs.mkdirSync(profileDisabledModsPath, { recursive: true });
    }

    // 2. Symlink / Migration Logic
    let needsLink = false;
    let globalStats = null;
    
    try {
      globalStats = fs.lstatSync(globalModsPath);
    } catch (e) {
      // Path doesn't exist
    }

    if (globalStats) {
      if (globalStats.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(globalModsPath);
        // Normalize paths for comparison
        if (path.resolve(linkTarget) !== path.resolve(profileModsPath)) {
          console.log(`[ModManager] Updating symlink from ${linkTarget} to ${profileModsPath}`);
          fs.unlinkSync(globalModsPath);
          needsLink = true;
        }
      } else if (globalStats.isDirectory()) {
        // MIGRATION: It's a real directory. Move contents to profile.
        console.log('[ModManager] Migrating global mods folder to profile folder...');
        const files = fs.readdirSync(globalModsPath);
        for (const file of files) {
          const src = path.join(globalModsPath, file);
          const dest = path.join(profileModsPath, file);
          // Only move if dest doesn't exist to avoid overwriting
          if (!fs.existsSync(dest)) {
             fs.renameSync(src, dest);
          }
        }
        
        // Also migrate DisabledMods if it exists globally
        const globalDisabledPath = path.join(path.dirname(globalModsPath), 'DisabledMods');
        if (fs.existsSync(globalDisabledPath) && fs.lstatSync(globalDisabledPath).isDirectory()) {
             const dFiles = fs.readdirSync(globalDisabledPath);
             for (const file of dFiles) {
                 const src = path.join(globalDisabledPath, file);
                 const dest = path.join(profileDisabledModsPath, file);
                 if (!fs.existsSync(dest)) {
                     fs.renameSync(src, dest);
                 }
             }
             // We can remove global DisabledMods now, as it's not used by game
             try { fs.rmSync(globalDisabledPath, { recursive: true, force: true }); } catch(e) {} 
        }

        // Remove the directory so we can link it
        try {
            let retries = 3;
            while (retries > 0) {
                try {
                    fs.rmSync(globalModsPath, { recursive: true, force: true });
                    break;
                } catch (err) {
                    if ((err.code === 'EPERM' || err.code === 'EBUSY') && retries > 0) {
                        retries--;
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } else {
                        throw err;
                    }
                }
            }
            needsLink = true;
        } catch (e) {
            console.error('Failed to remove global mods dir:', e);
             // Throw error to stop.
             throw new Error('Failed to migrate mods directory. Please clear ' + globalModsPath);
        }
      }
    } else {
      needsLink = true;
    }

    if (needsLink) {
      console.log(`[ModManager] Creating symlink: ${globalModsPath} -> ${profileModsPath}`);
      try {
         const symlinkType = getOS() === 'windows' ? 'junction' : 'dir';
         fs.symlinkSync(profileModsPath, globalModsPath, symlinkType); 
      } catch (err) {
        // If we can't create the symlink, try creating the directory first
        console.error('[ModManager] Failed to create symlink. Falling back to direct folder mode.');
        console.error(err.message);

    // Fallback: create a real directory so the game still works
    if (!fs.existsSync(globalModsPath)) {
      fs.mkdirSync(globalModsPath, { recursive: true });
      }
    }
  }

    // 3. Auto-Repair (Download missing mods)
    const profileModsSnapshot = activeProfile.mods || [];
    for (const mod of profileModsSnapshot) {
      if (mod.enabled && !mod.manual) {
        const inEnabled = fs.existsSync(path.join(profileModsPath, mod.fileName));
        const inDisabled = fs.existsSync(path.join(profileDisabledModsPath, mod.fileName));

        if (!inEnabled && !inDisabled) {
          if (mod.curseForgeId && (mod.curseForgeFileId || mod.fileId)) {
            console.log(`[ModManager] Auto-repair: Re-downloading missing mod "${mod.name}"...`);
            try {
              await downloadMod({
                ...mod,
                modId: mod.curseForgeId,
                fileId: mod.curseForgeFileId || mod.fileId,
                apiKey: API_KEY
              });
            } catch (err) {
              console.error(`[ModManager] Auto-repair failed for "${mod.name}": ${err.message}`);
            }
          }
        }
      }
    }

    // 4. Auto-Import (Detect manual drops in the profile folder)
    const enabledFiles = fs.existsSync(profileModsPath) ? fs.readdirSync(profileModsPath).filter(f => f.endsWith('.jar') || f.endsWith('.zip')) : [];
    
    let profileMods = activeProfile.mods || [];
    let profileUpdated = false;


    // Anything in this folder belongs to this profile.

    for (const file of enabledFiles) {
      const isKnown = profileMods.some(m => m.fileName === file);

      if (!isKnown) {
        console.log(`[ModManager] Auto-importing manual mod: ${file}`);
        const newMod = {
          id: generateModId(file),
          name: extractModName(file),
          version: 'Unknown',
          description: 'Manually installed',
          author: 'Local',
          enabled: true,
          fileName: file,
          fileSize: 0,
          dateInstalled: new Date().toISOString(),
          manual: true
        };
        profileMods.push(newMod);
        profileUpdated = true;
      }
    }

    if (profileUpdated) {
      profileManager.updateProfile(activeProfile.id, { mods: profileMods });
      const updatedProfile = profileManager.getActiveProfile();
      profileMods = updatedProfile ? (updatedProfile.mods || []) : profileMods;
    }

    // 5. Enforce Enabled/Disabled State (Move files between Profile/Mods and Profile/DisabledMods)
    // Note: Since Global/Mods IS Profile/Mods (via symlink), moving out of Profile/Mods disables it for the game.
    
    const disabledFiles = fs.existsSync(profileDisabledModsPath) ? fs.readdirSync(profileDisabledModsPath).filter(f => f.endsWith('.jar') || f.endsWith('.zip')) : [];
    const allFiles = new Set([...enabledFiles, ...disabledFiles]);

    for (const fileName of allFiles) {
      const modConfig = profileMods.find(m => m.fileName === fileName);
      const shouldBeEnabled = modConfig && modConfig.enabled !== false; 

      const currentPath = enabledFiles.includes(fileName) ? path.join(profileModsPath, fileName) : path.join(profileDisabledModsPath, fileName);
      const targetDir = shouldBeEnabled ? profileModsPath : profileDisabledModsPath;
      const targetPath = path.join(targetDir, fileName);

      if (path.dirname(currentPath) !== targetDir) {
        console.log(`[Mod Sync] Moving ${fileName} to ${shouldBeEnabled ? 'Enabled' : 'Disabled'}`);
        try {
          fs.renameSync(currentPath, targetPath);
        } catch (err) {
          console.error(`Failed to move ${fileName}: ${err.message}`);
        }
      }
    }

    return { success: true };

  } catch (error) {
    console.error('[ModManager] Error syncing mods:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  loadInstalledMods,
  downloadMod,
  uninstallMod,
  toggleMod,
  syncModsForCurrentProfile,
  generateModId,
  extractModName,
  extractVersion
};
