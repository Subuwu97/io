// Talks to a Jellyfin server running locally (or on the network) to
// reuse series logo artwork it's already downloaded, rather than
// standing up a whole separate metadata source (e.g. TMDB) just for
// this one piece of art - same reasoning as the Plex version this
// replaces. Authenticates with a dedicated Jellyfin API key (created
// under Dashboard -> API Keys), which is the actual security
// advantage over Plex's approach: an API key is independently named,
// scoped to being a service credential, and can be revoked at any
// time without touching anyone's actual login session - unlike
// Plex's token, which is tied to a full account session.
//
// Everything here is read-only and best-effort: if Jellyfin doesn't
// have a match, doesn't have a logo for a match it does have, or a
// request fails for any reason, every function here returns null/false
// rather than throwing - the caller always has a safe fallback (the
// plain text title) and a Jellyfin hiccup should never be able to
// break a title page.
const http = require('http');
const https = require('https');
const { URL } = require('url');

function jellyfinRequest(serverUrl, apiKey, path) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(path, serverUrl);
    } catch (e) {
      return reject(new Error('Invalid Jellyfin server URL'));
    }
    const client = target.protocol === 'https:' ? https : http;
    const req = client.get(target, {
      headers: { Authorization: `MediaBrowser Token=${apiKey}`, Accept: 'application/json' },
      timeout: 8000,
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`Jellyfin request failed: ${res.statusCode}`));
      }
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Jellyfin returned a non-JSON response')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Jellyfin request timed out')));
    req.on('error', reject);
  });
}

// Downloads a Jellyfin-hosted image (also needs the auth header, so a
// plain <img src> pointed straight at Jellyfin wouldn't work even
// setting CSP aside) to a local file - the same pattern already used
// for cast photos and the Plex logo attempt before it.
function downloadJellyfinImage(serverUrl, apiKey, imageUrl, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const fs = require('fs');
    let target;
    try {
      target = new URL(imageUrl, serverUrl);
    } catch (e) {
      return reject(new Error('Invalid Jellyfin image URL'));
    }
    const client = target.protocol === 'https:' ? https : http;
    client.get(target, { headers: { Authorization: `MediaBrowser Token=${apiKey}` } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects downloading Jellyfin image'));
        return resolve(downloadJellyfinImage(serverUrl, apiKey, res.headers.location, destPath, redirectsLeft - 1));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`Jellyfin image download failed: ${res.statusCode}`));
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function searchShow(serverUrl, apiKey, title) {
  if (!serverUrl || !apiKey || !title) return null;
  // Recursive=true matters - without it, search only looks at the top
  // level of the library rather than within its folders, and would
  // silently miss everything.
  const data = await jellyfinRequest(serverUrl, apiKey, `/Items?IncludeItemTypes=Series&Recursive=true&SearchTerm=${encodeURIComponent(title)}`);
  const items = data.Items || [];
  console.log(`[jellyfin-logo] search "${title}" -> ${items.length} match(es)${items.length ? ': ' + items.map((i) => i.Name).join(', ') : ''}`);
  if (items.length === 0) return null;
  // Prefer an exact (case-insensitive) title match over Jellyfin's own
  // relevance ranking - a loose match is exactly the kind of thing
  // that could quietly attach the wrong show's logo to this one.
  const lower = title.trim().toLowerCase();
  const exact = items.find((i) => (i.Name || '').trim().toLowerCase() === lower);
  if (!exact) console.log(`[jellyfin-logo] no exact title match for "${title}" - using closest result "${items[0].Name}" instead`);
  return (exact || items[0]).Id || null;
}

// Combines search + logo download - the one function callers actually
// need. Every failure mode (no match, matched but no logo, Jellyfin
// unreachable, unexpected response) resolves to false rather than
// throwing, so a Jellyfin hiccup can never be the reason a title page
// fails to load.
async function fetchLogoForTitle(serverUrl, apiKey, title, destPath) {
  try {
    const itemId = await searchShow(serverUrl, apiKey, title);
    if (!itemId) {
      console.log(`[jellyfin-logo] "${title}" - no match found in Jellyfin, skipping (this is the most common reason a logo doesn't appear - a title naming difference between the two libraries)`);
      return false;
    }
    console.log(`[jellyfin-logo] "${title}" -> Jellyfin item ${itemId}, fetching its Logo image...`);
    await downloadJellyfinImage(serverUrl, apiKey, `/Items/${encodeURIComponent(itemId)}/Images/Logo`, destPath);
    console.log(`[jellyfin-logo] "${title}" - logo downloaded successfully`);
    return true;
  } catch (e) {
    console.error(`[jellyfin-logo] "${title}" - request failed: ${e.message} (this usually means the server couldn't reach Jellyfin at all, the API key is wrong, or the matched item genuinely has no Logo image set in Jellyfin)`);
    return false;
  }
}

module.exports = { fetchLogoForTitle };
