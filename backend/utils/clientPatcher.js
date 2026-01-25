const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { execSync, spawn } = require('child_process');
const { getJavaExec, getBundledJavaPath } = require('../managers/javaManager');
const { JRE_DIR } = require('../core/paths');

// Domain configuration
const ORIGINAL_DOMAIN = 'hytale.com';
const MIN_DOMAIN_LENGTH = 4;
const MAX_DOMAIN_LENGTH = 16;

function getTargetDomain() {
  if (process.env.HYTALE_AUTH_DOMAIN) {
    return process.env.HYTALE_AUTH_DOMAIN;
  }
  try {
    const { getAuthDomain } = require('../core/config');
    return getAuthDomain();
  } catch (e) {
    return 'auth.sanasol.ws';
  }
}

const DEFAULT_NEW_DOMAIN = 'auth.sanasol.ws';

/**
 * Patches HytaleClient and HytaleServer binaries to replace hytale.com with custom domain
 * This allows the game to connect to a custom authentication server
 *
 * Supports domains from 4 to 16 characters:
 * - All F2P traffic routes to single endpoint: https://{domain} (no subdomains)
 * - Domains <= 10 chars: Direct replacement, subdomains stripped
 * - Domains 11-16 chars: Split mode - first 6 chars replace subdomain prefix, rest replaces domain
 *
 * Official hytale.com keeps original subdomain behavior (sessions., account-data., etc.)
 */
class ClientPatcher {
  constructor() {
    this.patchedFlag = '.patched_custom';
  }

  /**
   * Get the target domain for patching
   */
  getNewDomain() {
    const domain = getTargetDomain();
    if (domain.length < MIN_DOMAIN_LENGTH) {
      console.warn(`Warning: Domain "${domain}" is too short (min ${MIN_DOMAIN_LENGTH} chars)`);
      console.warn(`Using default domain: ${DEFAULT_NEW_DOMAIN}`);
      return DEFAULT_NEW_DOMAIN;
    }
    if (domain.length > MAX_DOMAIN_LENGTH) {
      console.warn(`Warning: Domain "${domain}" is too long (max ${MAX_DOMAIN_LENGTH} chars)`);
      console.warn(`Using default domain: ${DEFAULT_NEW_DOMAIN}`);
      return DEFAULT_NEW_DOMAIN;
    }
    return domain;
  }

  /**
   * Calculate the domain patching strategy based on length
   * @returns {object} Strategy with mainDomain and subdomainPrefix
   */
  getDomainStrategy(domain) {
    if (domain.length <= 10) {
      // Direct replacement - subdomains will be stripped
      return {
        mode: 'direct',
        mainDomain: domain,
        subdomainPrefix: '', // Empty = subdomains stripped
        description: `Direct replacement: hytale.com -> ${domain}`
      };
    } else {
      // Split mode: first 6 chars become subdomain prefix, rest replaces hytale.com
      const prefix = domain.slice(0, 6);
      const suffix = domain.slice(6);
      return {
        mode: 'split',
        mainDomain: suffix,
        subdomainPrefix: prefix,
        description: `Split mode: subdomain prefix="${prefix}", main domain="${suffix}"`
      };
    }
  }

  /**
   * Convert a string to the length-prefixed byte format used by the client
   * Format: [length byte] [00 00 00 padding] [char1] [00] [char2] [00] ... [lastChar]
   * Note: No null byte after the last character
   */
  stringToLengthPrefixed(str) {
    const length = str.length;
    const result = Buffer.alloc(4 + length + (length - 1)); // length byte + padding + chars + separators

    // Length byte
    result[0] = length;
    // Padding: 00 00 00
    result[1] = 0x00;
    result[2] = 0x00;
    result[3] = 0x00;

    // Characters with null separators (no separator after last char)
    let pos = 4;
    for (let i = 0; i < length; i++) {
      result[pos++] = str.charCodeAt(i);
      if (i < length - 1) {
        result[pos++] = 0x00;
      }
    }

    return result;
  }

  /**
   * Convert a string to UTF-16LE bytes (how .NET stores strings)
   */
  stringToUtf16LE(str) {
    const buf = Buffer.alloc(str.length * 2);
    for (let i = 0; i < str.length; i++) {
      buf.writeUInt16LE(str.charCodeAt(i), i * 2);
    }
    return buf;
  }

  /**
   * Convert a string to UTF-8 bytes (how Java stores strings)
   */
  stringToUtf8(str) {
    return Buffer.from(str, 'utf8');
  }

  /**
   * Find all occurrences of a pattern in a buffer
   */
  findAllOccurrences(buffer, pattern) {
    const positions = [];
    let pos = 0;
    while (pos < buffer.length) {
      const index = buffer.indexOf(pattern, pos);
      if (index === -1) break;
      positions.push(index);
      pos = index + 1;
    }
    return positions;
  }

  /**
   * Replace bytes in buffer - only overwrites the length of new bytes
   * Prevents offset corruption by not expanding the replacement
   */
  replaceBytes(buffer, oldBytes, newBytes) {
    let count = 0;
    const result = Buffer.from(buffer);

    if (newBytes.length > oldBytes.length) {
      console.warn(`  Warning: New pattern (${newBytes.length}) longer than old (${oldBytes.length}), skipping`);
      return { buffer: result, count: 0 };
    }

    const positions = this.findAllOccurrences(result, oldBytes);

    for (const pos of positions) {
      // Only overwrite the length of the new bytes
      newBytes.copy(result, pos);
      count++;
    }

    return { buffer: result, count };
  }

  /**
   * UTF-8 domain replacement for Java JAR files.
   * Java stores strings in UTF-8 format in the constant pool.
   */
  findAndReplaceDomainUtf8(data, oldDomain, newDomain) {
    let count = 0;
    const result = Buffer.from(data);

    const oldUtf8 = this.stringToUtf8(oldDomain);
    const newUtf8 = this.stringToUtf8(newDomain);

    const positions = this.findAllOccurrences(result, oldUtf8);

    for (const pos of positions) {
      newUtf8.copy(result, pos);
      count++;
      console.log(`  Patched UTF-8 occurrence at offset 0x${pos.toString(16)}`);
    }

    return { buffer: result, count };
  }

  /**
   * Smart domain replacement that handles both null-terminated and non-null-terminated strings.
   * .NET AOT stores some strings in various formats:
   * - Standard UTF-16LE (each char is 2 bytes with \x00 high byte)
   * - Length-prefixed where last char may have metadata byte instead of \x00
   */
  findAndReplaceDomainSmart(data, oldDomain, newDomain) {
    let count = 0;
    const result = Buffer.from(data);

    const oldUtf16NoLast = this.stringToUtf16LE(oldDomain.slice(0, -1));
    const newUtf16NoLast = this.stringToUtf16LE(newDomain.slice(0, -1));

    const oldLastCharByte = oldDomain.charCodeAt(oldDomain.length - 1);
    const newLastCharByte = newDomain.charCodeAt(newDomain.length - 1);

    const positions = this.findAllOccurrences(result, oldUtf16NoLast);

    for (const pos of positions) {
      const lastCharPos = pos + oldUtf16NoLast.length;
      if (lastCharPos + 1 > result.length) continue;

      const lastCharFirstByte = result[lastCharPos];

      if (lastCharFirstByte === oldLastCharByte) {
        newUtf16NoLast.copy(result, pos);

        result[lastCharPos] = newLastCharByte;

        if (lastCharPos + 1 < result.length) {
          const secondByte = result[lastCharPos + 1];
          if (secondByte === 0x00) {
            console.log(`  Patched UTF-16LE occurrence at offset 0x${pos.toString(16)}`);
          } else {
            console.log(`  Patched length-prefixed occurrence at offset 0x${pos.toString(16)} (metadata: 0x${secondByte.toString(16)})`);
          }
        }
        count++;
      }
    }

    return { buffer: result, count };
  }

  /**
   * Apply all domain patches using length-prefixed format
   * This is the main patching method for variable-length domains
   */
  applyDomainPatches(data, domain, protocol = 'https://') {
    let result = Buffer.from(data);
    let totalCount = 0;
    const strategy = this.getDomainStrategy(domain);

    console.log(`  Patching strategy: ${strategy.description}`);

    // 1. Patch telemetry/sentry URL
    const oldSentry = 'https://ca900df42fcf57d4dd8401a86ddd7da2@sentry.hytale.com/2';
    const newSentry = `${protocol}t@${domain}/2`;

    console.log(`  Patching sentry: ${oldSentry.slice(0, 30)}... -> ${newSentry}`);
    const sentryResult = this.replaceBytes(
        result,
        this.stringToLengthPrefixed(oldSentry),
        this.stringToLengthPrefixed(newSentry)
    );
    result = sentryResult.buffer;
    if (sentryResult.count > 0) {
      console.log(`    Replaced ${sentryResult.count} sentry occurrence(s)`);
      totalCount += sentryResult.count;
    }

    // 2. Patch main domain (hytale.com -> mainDomain)
    console.log(`  Patching domain: ${ORIGINAL_DOMAIN} -> ${strategy.mainDomain}`);
    const domainResult = this.replaceBytes(
        result,
        this.stringToLengthPrefixed(ORIGINAL_DOMAIN),
        this.stringToLengthPrefixed(strategy.mainDomain)
    );
    result = domainResult.buffer;
    if (domainResult.count > 0) {
      console.log(`    Replaced ${domainResult.count} domain occurrence(s)`);
      totalCount += domainResult.count;
    }

    // 3. Patch subdomain prefixes
    const subdomains = ['https://tools.', 'https://sessions.', 'https://account-data.', 'https://telemetry.'];
    const newSubdomainPrefix = protocol + strategy.subdomainPrefix;

    for (const sub of subdomains) {
      console.log(`  Patching subdomain: ${sub} -> ${newSubdomainPrefix}`);
      const subResult = this.replaceBytes(
          result,
          this.stringToLengthPrefixed(sub),
          this.stringToLengthPrefixed(newSubdomainPrefix)
      );
      result = subResult.buffer;
      if (subResult.count > 0) {
        console.log(`    Replaced ${subResult.count} occurrence(s)`);
        totalCount += subResult.count;
      }
    }

    return { buffer: result, count: totalCount };
  }

  /**
   * Patch Discord invite URLs from .gg/hytale to .gg/MHkEjepMQ7
   */
  patchDiscordUrl(data) {
    let count = 0;
    const result = Buffer.from(data);

    const oldUrl = '.gg/hytale';
    const newUrl = '.gg/MHkEjepMQ7';

    // Try length-prefixed format first
    const lpResult = this.replaceBytes(
        result,
        this.stringToLengthPrefixed(oldUrl),
        this.stringToLengthPrefixed(newUrl)
    );

    if (lpResult.count > 0) {
      return { buffer: lpResult.buffer, count: lpResult.count };
    }

    // Fallback to UTF-16LE
    const oldUtf16 = this.stringToUtf16LE(oldUrl);
    const newUtf16 = this.stringToUtf16LE(newUrl);

    const positions = this.findAllOccurrences(result, oldUtf16);

    for (const pos of positions) {
      newUtf16.copy(result, pos);
      count++;
    }

    return { buffer: result, count };
  }

  /**
   * Check if the client binary has already been patched
   * Also verifies the binary actually contains the patched domain
   */
  isPatchedAlready(clientPath) {
    const newDomain = this.getNewDomain();
    const patchFlagFile = clientPath + this.patchedFlag;

    // First check flag file
    if (fs.existsSync(patchFlagFile)) {
      try {
        const flagData = JSON.parse(fs.readFileSync(patchFlagFile, 'utf8'));
        if (flagData.targetDomain === newDomain) {
          // Verify the binary actually contains the patched domain
          const data = fs.readFileSync(clientPath);
          const strategy = this.getDomainStrategy(newDomain);
          const domainPattern = this.stringToLengthPrefixed(strategy.mainDomain);

          if (data.includes(domainPattern)) {
            return true;
          } else {
            console.log('  Flag exists but binary not patched (was updated?), re-patching...');
            return false;
          }
        }
      } catch (e) {
        // Flag file corrupt or unreadable
      }
    }
    return false;
  }

  /**
   * Mark the client as patched
   */
  markAsPatched(clientPath) {
    const newDomain = this.getNewDomain();
    const strategy = this.getDomainStrategy(newDomain);
    const patchFlagFile = clientPath + this.patchedFlag;
    const flagData = {
      patchedAt: new Date().toISOString(),
      originalDomain: ORIGINAL_DOMAIN,
      targetDomain: newDomain,
      patchMode: strategy.mode,
      mainDomain: strategy.mainDomain,
      subdomainPrefix: strategy.subdomainPrefix,
      patcherVersion: '2.0.0',
      verified: 'binary_contents'
    };
    fs.writeFileSync(patchFlagFile, JSON.stringify(flagData, null, 2));
  }

  /**
   * Create a backup of the original client binary
   */
  backupClient(clientPath) {
    const backupPath = clientPath + '.original';
    if (!fs.existsSync(backupPath)) {
      console.log(`  Creating backup at ${path.basename(backupPath)}`);
      fs.copyFileSync(clientPath, backupPath);
      return backupPath;
    }

    // Check if current file differs from backup (might have been updated)
    const currentSize = fs.statSync(clientPath).size;
    const backupSize = fs.statSync(backupPath).size;

    if (currentSize !== backupSize) {
      // File was updated, create timestamped backup of old backup
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const oldBackupPath = `${clientPath}.original.${timestamp}`;
      console.log(`  File updated, archiving old backup to ${path.basename(oldBackupPath)}`);
      fs.renameSync(backupPath, oldBackupPath);
      fs.copyFileSync(clientPath, backupPath);
      return backupPath;
    }

    console.log('  Backup already exists');
    return backupPath;
  }

  /**
   * Restore the original client binary from backup
   */
  restoreClient(clientPath) {
    const backupPath = clientPath + '.original';
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, clientPath);
      const patchFlagFile = clientPath + this.patchedFlag;
      if (fs.existsSync(patchFlagFile)) {
        fs.unlinkSync(patchFlagFile);
      }
      console.log('Client restored from backup');
      return true;
    }
    console.log('No backup found to restore');
    return false;
  }

  /**
   * Patch the client binary to use the custom domain
   * @param {string} clientPath - Path to the HytaleClient binary
   * @param {function} progressCallback - Optional callback for progress updates
   * @returns {object} Result object with success status and details
   */
  async patchClient(clientPath, progressCallback) {
    const newDomain = this.getNewDomain();
    const strategy = this.getDomainStrategy(newDomain);

    console.log('=== Client Patcher v2.0 ===');
    console.log(`Target: ${clientPath}`);
    console.log(`Domain: ${newDomain} (${newDomain.length} chars)`);
    console.log(`Mode: ${strategy.mode}`);
    if (strategy.mode === 'split') {
      console.log(`  Subdomain prefix: ${strategy.subdomainPrefix}`);
      console.log(`  Main domain: ${strategy.mainDomain}`);
    }

    if (!fs.existsSync(clientPath)) {
      const error = `Client binary not found: ${clientPath}`;
      console.error(error);
      return { success: false, error };
    }

    if (this.isPatchedAlready(clientPath)) {
      console.log(`Client already patched for ${newDomain}, skipping`);
      if (progressCallback) {
        progressCallback('Client already patched', 100);
      }
      return { success: true, alreadyPatched: true, patchCount: 0 };
    }

    if (progressCallback) {
      progressCallback('Preparing to patch client...', 10);
    }

    console.log('Creating backup...');
    this.backupClient(clientPath);

    if (progressCallback) {
      progressCallback('Reading client binary...', 20);
    }

    console.log('Reading client binary...');
    const data = fs.readFileSync(clientPath);
    console.log(`Binary size: ${(data.length / 1024 / 1024).toFixed(2)} MB`);

    if (progressCallback) {
      progressCallback('Patching domain references...', 50);
    }

    console.log('Applying domain patches (length-prefixed format)...');
    const { buffer: patchedData, count } = this.applyDomainPatches(data, newDomain);

    console.log('Patching Discord URLs...');
    const { buffer: finalData, count: discordCount } = this.patchDiscordUrl(patchedData);

    if (count === 0 && discordCount === 0) {
      console.log('No occurrences found - trying legacy UTF-16LE format...');

      // Fallback to legacy patching for older binary formats
      const legacyResult = this.findAndReplaceDomainSmart(data, ORIGINAL_DOMAIN, strategy.mainDomain);
      if (legacyResult.count > 0) {
        console.log(`Found ${legacyResult.count} occurrences with legacy format`);
        fs.writeFileSync(clientPath, legacyResult.buffer);
        this.markAsPatched(clientPath);
        return { success: true, patchCount: legacyResult.count, format: 'legacy' };
      }

      console.log('No occurrences found - binary may already be modified or has different format');
      return { success: true, patchCount: 0, warning: 'No occurrences found' };
    }

    if (progressCallback) {
      progressCallback('Writing patched binary...', 80);
    }

    console.log('Writing patched binary...');
    fs.writeFileSync(clientPath, finalData);

    this.markAsPatched(clientPath);

    if (progressCallback) {
      progressCallback('Patching complete', 100);
    }

    console.log(`Successfully patched ${count} domain occurrences and ${discordCount} Discord URLs`);
    console.log('=== Patching Complete ===');

    return { success: true, patchCount: count + discordCount };
  }

  /**
   * Patch the server JAR by downloading pre-patched version
   * @param {string} serverPath - Path to the HytaleServer.jar
   * @param {function} progressCallback - Optional callback for progress updates
   * @param {string} javaPath - Path to Java executable (unused, kept for compatibility)
   * @returns {object} Result object with success status and details
   */
  async patchServer(serverPath, progressCallback, javaPath = null) {
    const newDomain = this.getNewDomain();

    console.log('=== Server Patcher TEMP SYSTEM NEED TO BE FIXED ===');
    console.log(`Target: ${serverPath}`);
    console.log(`Domain: ${newDomain}`);

    if (!fs.existsSync(serverPath)) {
      const error = `Server JAR not found: ${serverPath}`;
      console.error(error);
      return { success: false, error };
    }

    // Check if already patched
    const patchFlagFile = serverPath + '.dualauth_patched';
    if (fs.existsSync(patchFlagFile)) {
      try {
        const flagData = JSON.parse(fs.readFileSync(patchFlagFile, 'utf8'));
        if (flagData.domain === newDomain) {
          console.log(`Server already patched for ${newDomain}, skipping`);
          if (progressCallback) progressCallback('Server already patched', 100);
          return { success: true, alreadyPatched: true };
        }
      } catch (e) {
        // Flag file corrupt, re-patch
      }
    }

    // Create backup
    if (progressCallback) progressCallback('Creating backup...', 10);
    console.log('Creating backup...');
    this.backupClient(serverPath);

    // Download pre-patched JAR
    if (progressCallback) progressCallback('Downloading patched server JAR...', 30);
    console.log('Downloading pre-patched HytaleServer.jar from https://files.hytalef2p.com/jar');

    try {
      const https = require('https');
      const url = 'https://files.hytalef2p.com/jar';

      await new Promise((resolve, reject) => {
        https.get(url, (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            // Follow redirect
            https.get(response.headers.location, (redirectResponse) => {
              if (redirectResponse.statusCode !== 200) {
                reject(new Error(`Failed to download: HTTP ${redirectResponse.statusCode}`));
                return;
              }

              const file = fs.createWriteStream(serverPath);
              const totalSize = parseInt(redirectResponse.headers['content-length'], 10);
              let downloaded = 0;

              redirectResponse.on('data', (chunk) => {
                downloaded += chunk.length;
                if (progressCallback && totalSize) {
                  const percent = 30 + Math.floor((downloaded / totalSize) * 60);
                  progressCallback(`Downloading... ${(downloaded / 1024 / 1024).toFixed(2)} MB`, percent);
                }
              });

              redirectResponse.pipe(file);
              file.on('finish', () => {
                file.close();
                resolve();
              });
            }).on('error', reject);
          } else if (response.statusCode === 200) {
            const file = fs.createWriteStream(serverPath);
            const totalSize = parseInt(response.headers['content-length'], 10);
            let downloaded = 0;

            response.on('data', (chunk) => {
              downloaded += chunk.length;
              if (progressCallback && totalSize) {
                const percent = 30 + Math.floor((downloaded / totalSize) * 60);
                progressCallback(`Downloading... ${(downloaded / 1024 / 1024).toFixed(2)} MB`, percent);
              }
            });

            response.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
          } else {
            reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
          }
        }).on('error', (err) => {
          fs.unlink(serverPath, () => {});
          reject(err);
        });
      });

      console.log('  Download successful');

      // Mark as patched
      fs.writeFileSync(patchFlagFile, JSON.stringify({
        domain: newDomain,
        patchedAt: new Date().toISOString(),
        patcher: 'PrePatchedDownload',
        source: 'https://download.sanasol.ws/download/HytaleServer.jar'
      }));

      if (progressCallback) progressCallback('Server patching complete', 100);
      console.log('=== Server Patching Complete ===');
      return { success: true, patchCount: 1 };

    } catch (downloadError) {
      console.error(`Failed to download patched JAR: ${downloadError.message}`);
      
      // Restore backup on failure
      const backupPath = serverPath + '.original';
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, serverPath);
        console.log('Restored backup after download failure');
      }

      return { success: false, error: `Failed to download patched server: ${downloadError.message}` };
    }
  }

  /**
   * Find Java executable - uses bundled JRE first (same as game uses)
   * Falls back to system Java if bundled not available
   */
  findJava() {
    // 1. Try bundled JRE first (comes with the game)
    try {
      const bundled = getBundledJavaPath(JRE_DIR);
      if (bundled && fs.existsSync(bundled)) {
        console.log(`Using bundled Java: ${bundled}`);
        return bundled;
      }
    } catch (e) {
      // Bundled not available
    }

    // 2. Try javaManager's getJavaExec (handles all fallbacks)
    try {
      const javaExec = getJavaExec(JRE_DIR);
      if (javaExec && fs.existsSync(javaExec)) {
        console.log(`Using Java from javaManager: ${javaExec}`);
        return javaExec;
      }
    } catch (e) {
      // Not available
    }

    // 3. Check JAVA_HOME
    if (process.env.JAVA_HOME) {
      const javaHome = process.env.JAVA_HOME;
      const javaBin = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
      if (fs.existsSync(javaBin)) {
        console.log(`Using Java from JAVA_HOME: ${javaBin}`);
        return javaBin;
      }
    }

    // 4. Try 'java' from PATH
    try {
      execSync('java -version 2>&1', { encoding: 'utf8' });
      console.log('Using Java from PATH');
      return 'java';
    } catch (e) {
      // Not in PATH
    }

    return null;
  }

  /**
   * Download DualAuthPatcher from hytale-auth-server if not present
   */
  async ensurePatcherDownloaded(patcherDir) {
    const patcherJava = path.join(patcherDir, 'DualAuthPatcher.java');
    const patcherUrl = 'https://raw.githubusercontent.com/sanasol/hytale-auth-server/master/patcher/DualAuthPatcher.java';

    if (!fs.existsSync(patcherDir)) {
      fs.mkdirSync(patcherDir, { recursive: true });
    }

    if (!fs.existsSync(patcherJava)) {
      console.log('Downloading DualAuthPatcher from hytale-auth-server...');
      try {
        const https = require('https');
        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(patcherJava);
          https.get(patcherUrl, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
              // Follow redirect
              https.get(response.headers.location, (redirectResponse) => {
                redirectResponse.pipe(file);
                file.on('finish', () => {
                  file.close();
                  resolve();
                });
              }).on('error', reject);
            } else {
              response.pipe(file);
              file.on('finish', () => {
                file.close();
                resolve();
              });
            }
          }).on('error', (err) => {
            fs.unlink(patcherJava, () => {});
            reject(err);
          });
        });
        console.log('  Downloaded DualAuthPatcher.java');
      } catch (e) {
        console.error(`  Failed to download DualAuthPatcher: ${e.message}`);
        throw e;
      }
    }
  }

  /**
   * Download ASM libraries if not present
   */
  async ensureAsmLibraries(libDir) {
    if (!fs.existsSync(libDir)) {
      fs.mkdirSync(libDir, { recursive: true });
    }

    const libs = [
      { name: 'asm-9.6.jar', url: 'https://repo1.maven.org/maven2/org/ow2/asm/asm/9.6/asm-9.6.jar' },
      { name: 'asm-tree-9.6.jar', url: 'https://repo1.maven.org/maven2/org/ow2/asm/asm-tree/9.6/asm-tree-9.6.jar' },
      { name: 'asm-util-9.6.jar', url: 'https://repo1.maven.org/maven2/org/ow2/asm/asm-util/9.6/asm-util-9.6.jar' }
    ];

    for (const lib of libs) {
      const libPath = path.join(libDir, lib.name);
      if (!fs.existsSync(libPath)) {
        console.log(`Downloading ${lib.name}...`);
        try {
          const https = require('https');
          await new Promise((resolve, reject) => {
            const file = fs.createWriteStream(libPath);
            https.get(lib.url, (response) => {
              response.pipe(file);
              file.on('finish', () => {
                file.close();
                resolve();
              });
            }).on('error', (err) => {
              fs.unlink(libPath, () => {});
              reject(err);
            });
          });
          console.log(`  Downloaded ${lib.name}`);
        } catch (e) {
          console.error(`  Failed to download ${lib.name}: ${e.message}`);
          throw e;
        }
      }
    }
  }

  /**
   * Compile DualAuthPatcher if needed
   */
  async compileDualAuthPatcher(java, patcherDir, libDir) {
    const patcherClass = path.join(patcherDir, 'DualAuthPatcher.class');
    const patcherJava = path.join(patcherDir, 'DualAuthPatcher.java');

    // Check if already compiled and up to date
    if (fs.existsSync(patcherClass)) {
      const classTime = fs.statSync(patcherClass).mtime;
      const javaTime = fs.statSync(patcherJava).mtime;
      if (classTime > javaTime) {
        console.log('DualAuthPatcher already compiled');
        return { success: true };
      }
    }

    console.log('Compiling DualAuthPatcher...');

    const javac = java.replace(/java(\.exe)?$/, 'javac$1');
    const classpath = [
      path.join(libDir, 'asm-9.6.jar'),
      path.join(libDir, 'asm-tree-9.6.jar'),
      path.join(libDir, 'asm-util-9.6.jar')
    ].join(process.platform === 'win32' ? ';' : ':');

    try {
      // Fix PATH for packaged Electron apps on Windows
      const execOptions = {
        stdio: 'pipe',
        cwd: patcherDir,
        env: { ...process.env }
      };
      
      // Add system32 to PATH for Windows to find cmd.exe
      if (process.platform === 'win32') {
        const systemRoot = process.env.SystemRoot || 'C:\\WINDOWS';
        const systemPath = `${systemRoot}\\system32;${systemRoot};${systemRoot}\\System32\\Wbem`;
        execOptions.env.PATH = execOptions.env.PATH 
          ? `${systemPath};${execOptions.env.PATH}`
          : systemPath;
        execOptions.shell = true;
      }
      
      execSync(`"${javac}" -cp "${classpath}" -d "${patcherDir}" "${patcherJava}"`, execOptions);
      console.log('  Compilation successful');
      return { success: true };
    } catch (e) {
      const error = `Failed to compile DualAuthPatcher: ${e.message}`;
      console.error(error);
      if (e.stderr) console.error(e.stderr.toString());
      return { success: false, error };
    }
  }

  /**
   * Run DualAuthPatcher on the server JAR
   */
  async runDualAuthPatcher(java, classpath, serverPath, domain) {
    return new Promise((resolve) => {
      const args = ['-cp', classpath, 'DualAuthPatcher', serverPath];
      const env = { ...process.env, HYTALE_AUTH_DOMAIN: domain };

      console.log(`Running: java ${args.join(' ')}`);
      console.log(`  HYTALE_AUTH_DOMAIN=${domain}`);

      const proc = spawn(java, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const str = data.toString();
        stdout += str;
        console.log(str.trim());
      });

      proc.stderr.on('data', (data) => {
        const str = data.toString();
        stderr += str;
        console.error(str.trim());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, stdout });
        } else {
          resolve({ success: false, error: `Patcher exited with code ${code}: ${stderr}` });
        }
      });

      proc.on('error', (err) => {
        resolve({ success: false, error: `Failed to run patcher: ${err.message}` });
      });
    });
  }

  /**
   * Legacy server patcher (simple domain replacement, no dual auth)
   * Use patchServer() for full dual auth support
   */
  async patchServerLegacy(serverPath, progressCallback) {
    const newDomain = this.getNewDomain();
    const strategy = this.getDomainStrategy(newDomain);

    console.log('=== Legacy Server Patcher ===');
    console.log(`Target: ${serverPath}`);
    console.log(`Domain: ${newDomain} (${newDomain.length} chars)`);

    if (!fs.existsSync(serverPath)) {
      return { success: false, error: `Server JAR not found: ${serverPath}` };
    }

    if (progressCallback) progressCallback('Patching server...', 20);

    console.log('Opening server JAR...');
    const zip = new AdmZip(serverPath);
    const entries = zip.getEntries();

    let totalCount = 0;
    const oldUtf8 = this.stringToUtf8(ORIGINAL_DOMAIN);

    for (const entry of entries) {
      const name = entry.entryName;
      if (name.endsWith('.class') || name.endsWith('.properties') ||
          name.endsWith('.json') || name.endsWith('.xml') || name.endsWith('.yml')) {
        const data = entry.getData();
        if (data.includes(oldUtf8)) {
          const { buffer: patchedData, count } = this.findAndReplaceDomainUtf8(data, ORIGINAL_DOMAIN, strategy.mainDomain);
          if (count > 0) {
            zip.updateFile(entry.entryName, patchedData);
            totalCount += count;
          }
        }
      }
    }

    if (totalCount > 0) {
      zip.writeZip(serverPath);
    }

    if (progressCallback) progressCallback('Complete', 100);
    return { success: true, patchCount: totalCount };
  }

  /**
   * Find the client binary path based on platform
   */
  findClientPath(gameDir) {
    const candidates = [];

    if (process.platform === 'darwin') {
      candidates.push(path.join(gameDir, 'Client', 'Hytale.app', 'Contents', 'MacOS', 'HytaleClient'));
      candidates.push(path.join(gameDir, 'Client', 'HytaleClient'));
    } else if (process.platform === 'win32') {
      candidates.push(path.join(gameDir, 'Client', 'HytaleClient.exe'));
    } else {
      candidates.push(path.join(gameDir, 'Client', 'HytaleClient'));
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }


  findServerPath(gameDir) {
    const candidates = [
      path.join(gameDir, 'Server', 'HytaleServer.jar'),
      path.join(gameDir, 'Server', 'server.jar')
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Ensure both client and server are patched before launching
   * @param {string} gameDir - Path to the game directory
   * @param {function} progressCallback - Optional callback for progress updates
   * @param {string} javaPath - Optional path to Java executable for server patching
   */
  async ensureClientPatched(gameDir, progressCallback, javaPath = null) {
    const results = {
      client: null,
      server: null,
      success: true
    };

    const clientPath = this.findClientPath(gameDir);
    if (clientPath) {
      if (progressCallback) {
        progressCallback('Patching client binary...', 10);
      }
      results.client = await this.patchClient(clientPath, (msg, pct) => {
        if (progressCallback) {
          progressCallback(`Client: ${msg}`, pct ? pct / 2 : null);
        }
      });
    } else {
      console.warn('Could not find HytaleClient binary');
      results.client = { success: false, error: 'Client binary not found' };
    }

    const serverPath = this.findServerPath(gameDir);
    if (serverPath) {
      if (progressCallback) {
        progressCallback('Patching server JAR...', 50);
      }
      results.server = await this.patchServer(serverPath, (msg, pct) => {
        if (progressCallback) {
          progressCallback(`Server: ${msg}`, pct ? 50 + pct / 2 : null);
        }
      }, javaPath);
    } else {
      console.warn('Could not find HytaleServer.jar');
      results.server = { success: false, error: 'Server JAR not found' };
    }

    results.success = (results.client && results.client.success) || (results.server && results.server.success);
    results.alreadyPatched = (results.client && results.client.alreadyPatched) && (results.server && results.server.alreadyPatched);
    results.patchCount = (results.client ? results.client.patchCount || 0 : 0) + (results.server ? results.server.patchCount || 0 : 0);

    if (progressCallback) {
      progressCallback('Patching complete', 100);
    }

    return results;
  }
}

module.exports = new ClientPatcher();
