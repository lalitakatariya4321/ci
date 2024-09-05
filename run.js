const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const winston = require('winston');

// Set up logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} - ${level.toUpperCase()} - ${message}`)
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// Constants
const CHANNELS_URL = "https://babel-in.xyz/babel-469c814cea6a2f626809c9b6f1f966a4/tata/channels";
const HMAC_URL = "https://babel-in.xyz/babel-469c814cea6a2f626809c9b6f1f966a4/tata/hmac";
const KEY_URL = "";
const RETRIES = 3;
const CACHE_DIR = "_cache_";
const CACHE_TIME = 60; // 1 minute for manifest and key caching
const M3U_CACHE_TIME = 7200; // 2 hours for M3U caching

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

async function fetchApi(url, retries) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      logger.error(`Error fetching API data (attempt ${attempt + 1}/${retries}): ${error.message}`);
      if (attempt < retries - 1) {
        continue;
      } else {
        return null;
      }
    }
  }
}

async function fetchAndCache(url, cacheFile, cacheTime) {
  if (fs.existsSync(cacheFile) && (Date.now() - fs.statSync(cacheFile).mtimeMs) < cacheTime * 1000) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }

  const data = await fetchApi(url, RETRIES);
  if (data) {
    fs.writeFileSync(cacheFile, JSON.stringify(data));
    return data;
  }

  return null;
}

async function generateManifest(id) {
  const cacheFile = path.join(CACHE_DIR, `TP-${id}.mpd`);

  if (fs.existsSync(cacheFile) && (Date.now() - fs.statSync(cacheFile).mtimeMs) < CACHE_TIME * 1000) {
    return fs.readFileSync(cacheFile, 'utf8');
  }

  const data = await fetchApi(`${KEY_URL}${id}`, RETRIES);
  if (!data) return null;

  const initialUrl = data[0].data.initialUrl;
  const psshSet = data[0].data.psshSet;
  const kid = data[0].data.kid;
  let bssh = initialUrl.replace('bpweb', 'bpprod').replace('akamaized-staging', 'akamaized');

  let manifestContent = await fetchApi(bssh, RETRIES);
  if (!manifestContent) return null;

  manifestContent = manifestContent
    .replace('<BaseURL>dash/</BaseURL>', `<BaseURL>${bssh.replace("toxicify.mpd", "dash/")}</BaseURL>`)
    .replace(/\b(init.*?\.dash|media.*?\.m4s)(\?idt=[^"&]*)?("|\b)(\?decryption_key=[^"&]*)?("|\b)(&idt=[^&"]*(&|$))?/g, "$1$3$5$6$7")
    .replace(/<ContentProtection\s+schemeIdUri="(urn:[^"]+)"\s+value="Widevine"\/>/, `<ContentProtection schemeIdUri="$1"><cenc:pssh>${psshSet}</cenc:pssh></ContentProtection>`)
    .replace('xmlns="urn:mpeg:dash:schema:mpd:2011"', 'xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:cenc="urn:mpeg:cenc:2013"');
  const newContent = `<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="${kid}"/>`;
  manifestContent = manifestContent.replace('<ContentProtection value="cenc" schemeIdUri="urn:mpeg:dash:mp4protection:2011"/>', newContent);

  fs.writeFileSync(cacheFile, manifestContent);
  return manifestContent;
}

async function generateKeys(id) {
  const cacheFile = path.join(CACHE_DIR, `TP-${id}.json`);

  if (fs.existsSync(cacheFile) && (Date.now() - fs.statSync(cacheFile).mtimeMs) < CACHE_TIME * 1000) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }

  const data = await fetchApi(`${KEY_URL}${id}`, RETRIES);
  if (!data) return null;

  const kid = data[0].data.licence1;
  const key = data[0].data.licence2;

  const binaryKid = Buffer.from(kid, 'hex');
  const binaryKey = Buffer.from(key, 'hex');

  const encodedKid = binaryKid.toString('base64url');
  const encodedKey = binaryKey.toString('base64url');

  const response = {
    keys: [
      {
        kty: "oct",
        k: encodedKey,
        kid: encodedKid
      }
    ],
    type: "temporary"
  };

  fs.writeFileSync(cacheFile, JSON.stringify(response));
  return response;
}

async function generateM3U8(channelsData, hmacData) {
  let m3u8Content = `#EXTM3U x-tvg-url="https://raw.githubusercontent.com/mitthu786/tvepg/main/tataplay/epg.xml.gz"\n\n`;

  for (const channel of channelsData.data) {
    if (channel.base64 && typeof channel.base64 === 'object' && Array.isArray(channel.base64.keys) && channel.base64.keys.length > 0) {
      const clearkey = channel.base64;
      const userAgent = hmacData.userAgent;
      const cookie = hmacData.data.hdntl;

      m3u8Content += `#EXTINF:-1 tvg-id="${channel.id}" group-title="${channel.genre}" tvg-logo="${channel.logo}", ${channel.title}\n`;
      m3u8Content += `#KODIPROP:inputstream.adaptive.license_type=clearkey\n`;
      m3u8Content += `#KODIPROP:inputstream.adaptive.license_key=${JSON.stringify(clearkey)}\n`;
      m3u8Content += `#EXTVLCOPT:http-user-agent=${userAgent}\n`;
      m3u8Content += `#EXTHTTP:{"cookie":"${cookie}"}\n`;
      m3u8Content += `${channel.initialUrl}|cookie:${cookie}\n\n`;
    }
  }

  return m3u8Content;
}

async function main() {
  const channelsData = await fetchAndCache(CHANNELS_URL, path.join(CACHE_DIR, 'channels.json'), M3U_CACHE_TIME);
  const hmacData = await fetchAndCache(HMAC_URL, path.join(CACHE_DIR, 'hmac.json'), M3U_CACHE_TIME);

  if (channelsData && hmacData) {
    const m3u8Content = await generateM3U8(channelsData, hmacData);
    fs.writeFileSync('ts.m3u', m3u8Content);
    logger.info("M3U8 playlist generated and saved to ts.m3u");
  } else {
    logger.error("Failed to fetch data from API");
  }
}

main();
