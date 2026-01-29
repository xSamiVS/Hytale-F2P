const axios = require('axios');

async function getLatestClientVersion(branch = 'release') {
  try {
    console.log(`Fetching latest client version from API (branch: ${branch})...`);
    const response = await axios.get('https://files.hytalef2p.com/api/version_client', {
      params: { branch },
      timeout: 40000, // fixed from 5000 to 40000 to make sure the client trying to connect on the server with slow internet
      headers: {
        'User-Agent': 'Hytale-F2P-Launcher'
      }
    });

    if (response.data && response.data.client_version) {
      const version = response.data.client_version;
      console.log(`Latest client version for ${branch}: ${version}`);
      return version;
    } else {
      console.log('Warning: Invalid API response, falling back to latest known version (7.pwr - 2026-01-29)'); // added latest version fallback and latest known version as per today 
      return '7.pwr';
    }
  } catch (error) {
    console.error('Error fetching client version:', error.message);
    console.log('Warning: API unavailable, falling back to latest known version (7.pwr - 2026-01-29)');
    return '7.pwr';
  }
}

module.exports = {
  getLatestClientVersion
};
