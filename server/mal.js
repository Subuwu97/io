// Thin client for the public MyAnimeList API v2. All endpoints used here are
// unauthenticated GET requests that only require a Client ID header (no
// OAuth/login needed) - see https://myanimelist.net/apiconfig for how a
// user obtains one for their own app.
const https = require('https');

const API_BASE = 'https://api.myanimelist.net/v2';

function apiGet(pathAndQuery, clientId, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const url = pathAndQuery.startsWith('http') ? pathAndQuery : `${API_BASE}${pathAndQuery}`;
    const req = https.get(url, {
      headers: { 'X-MAL-CLIENT-ID': clientId },
    }, (res) => {
      // MyAnimeList's API sits behind infrastructure that can issue plain
      // HTTP redirects (e.g. 307) rather than always answering directly.
      // https.get() does not follow these on its own, so without this the
      // caller would see the redirect's raw HTML body as an "API error".
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); // discard body
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects from MyAnimeList API'));
        const nextUrl = new URL(res.headers.location, url).toString();
        return resolve(apiGet(nextUrl, clientId, redirectsLeft - 1));
      }
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`MyAnimeList API error ${res.statusCode}: ${body.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('MyAnimeList request timed out')));
  });
}

function downloadImage(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const fs = require('fs');
    https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects downloading image'));
        const nextUrl = new URL(res.headers.location, url).toString();
        return resolve(downloadImage(nextUrl, destPath, redirectsLeft - 1));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`Image download failed: ${res.statusCode}`));
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function searchByType(mediaType, query, clientId, limit = 12) {
  // manga has no num_episodes; anime has no num_volumes/num_chapters, but
  // asking for both fields is harmless (MAL just omits whichever doesn't apply).
  const fields = 'id,title,main_picture,alternative_titles,start_date,mean,genres,num_episodes,num_volumes,num_chapters,media_type';
  const data = await apiGet(`/${mediaType}?q=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`, clientId);
  return (data.data || []).map((d) => ({
    id: d.node.id,
    title: d.node.title,
    englishTitle: (d.node.alternative_titles && d.node.alternative_titles.en) || null,
    // Japanese title and any known fan/alternate names - not shown in the
    // UI, but used as extra matching signal (see title-match.js) for
    // local folders named after an alternate title rather than the
    // primary or English one.
    japaneseTitle: (d.node.alternative_titles && d.node.alternative_titles.ja) || null,
    synonyms: (d.node.alternative_titles && d.node.alternative_titles.synonyms) || [],
    image: d.node.main_picture ? (d.node.main_picture.large || d.node.main_picture.medium) : null,
    year: d.node.start_date ? parseInt(d.node.start_date.slice(0, 4), 10) : null,
    score: d.node.mean || null,
    episodes: d.node.num_episodes || null,
    chapters: d.node.num_chapters || null,
    mediaType: d.node.media_type || null,
  }));
}

async function getDetailsByType(mediaType, malId, clientId) {
  const fields = 'id,title,main_picture,alternative_titles,start_date,synopsis,mean,genres,num_episodes,num_volumes,num_chapters,rating,pictures,background,studios';
  const d = await apiGet(`/${mediaType}/${malId}?fields=${fields}`, clientId);
  return {
    id: d.id,
    title: d.title,
    englishTitle: (d.alternative_titles && d.alternative_titles.en) || null,
    description: d.synopsis || '',
    year: d.start_date ? parseInt(d.start_date.slice(0, 4), 10) : null,
    genres: (d.genres || []).map((g) => g.name),
    studios: (d.studios || []).map((s) => s.name),
    rating: d.rating ? d.rating.toUpperCase().replace('_', '-') : null,
    coverUrl: d.main_picture ? (d.main_picture.large || d.main_picture.medium) : null,
    // Pick the largest extra picture (if any) as a wide banner candidate.
    bannerUrl: d.pictures && d.pictures.length ? (d.pictures[d.pictures.length - 1].large || d.pictures[d.pictures.length - 1].medium) : null,
  };
}

// Fetches one entry by its MAL id and returns it shaped exactly like a
// search result, so the "found matches" UI can render it unchanged.
// Lets people paste an id (or a myanimelist.net URL) when name search
// keeps landing on the wrong entry - the id is unambiguous.
async function lookupByIdByType(mediaType, malId, clientId) {
  const fields = 'id,title,main_picture,alternative_titles,start_date,mean,genres,num_episodes,num_volumes,num_chapters,media_type';
  const d = await apiGet(`/${mediaType}/${malId}?fields=${fields}`, clientId);
  if (!d || !d.id) return [];
  return [{
    id: d.id,
    title: d.title,
    englishTitle: (d.alternative_titles && d.alternative_titles.en) || null,
    japaneseTitle: (d.alternative_titles && d.alternative_titles.ja) || null,
    synonyms: (d.alternative_titles && d.alternative_titles.synonyms) || [],
    image: d.main_picture ? (d.main_picture.large || d.main_picture.medium) : null,
    year: d.start_date ? parseInt(d.start_date.slice(0, 4), 10) : null,
    score: d.mean || null,
    episodes: d.num_episodes || null,
    chapters: d.num_chapters || null,
    mediaType: d.media_type || null,
  }];
}

function search(query, clientId, limit = 12) { return searchByType('anime', query, clientId, limit); }
function getDetails(malId, clientId) { return getDetailsByType('anime', malId, clientId); }
function searchManga(query, clientId, limit = 12) { return searchByType('manga', query, clientId, limit); }
function getMangaDetails(malId, clientId) { return getDetailsByType('manga', malId, clientId); }

function lookupById(malId, clientId) { return lookupByIdByType('anime', malId, clientId); }
function lookupMangaById(malId, clientId) { return lookupByIdByType('manga', malId, clientId); }

module.exports = { search, getDetails, searchManga, getMangaDetails, downloadImage, lookupById, lookupMangaById };
