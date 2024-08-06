const fetch = require('node-fetch');
const fs = require('fs');
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
const CHANNELS_URL = "https://fox.toxic-gang.xyz/tata/channels";
const HMAC_URL = "https://fox.toxic-gang.xyz/tata/hmac";
const KEY_URL = "https://fox.toxic-gang.xyz/tata/key/";
const RETRIES = 3;

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

function generateM3U8(channelsData, hmacData) {
  let m3u8Content = `#EXTM3U x-tvg-url="https://raw.githubusercontent.com/mitthu786/tvepg/main/tataplay/epg.xml.gz"\n\n`;

  for (const channel of channelsData.data) {
    if (channel.base64 && typeof channel.base64 === 'object' && Array.isArray(channel.base64.keys) && channel.base64.keys.length > 0) {
      const clearkey = channel.base64;
      const userAgent = hmacData.userAgent;
      const cookie = hmacData.data.hdntl;

      m3u8Content += `#EXTINF:-1 tvg-id="${channel.id}" group-title="${channel.genre}", tvg-logo="${channel.logo}", ${channel.title}\n`;
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
  const channelsData = await fetchApi(CHANNELS_URL, RETRIES);
  const hmacData = await fetchApi(HMAC_URL, RETRIES);

  if (channelsData && hmacData) {
    const m3u8Content = generateM3U8(channelsData, hmacData);
    fs.writeFileSync('ts.m3u', m3u8Content);
    logger.info("M3U8 playlist generated and saved to ts.m3u");
  } else {
    logger.error("Failed to fetch data from API");
  }
}

main();
