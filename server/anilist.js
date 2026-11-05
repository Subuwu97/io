// Thin client for AniList's public GraphQL API. Unlike MyAnimeList, this
// needs no API key/Client ID at all for search and detail lookups - it's
// a genuinely open, unauthenticated API for this kind of read - so
// AniList works immediately with zero setup, which MAL can't offer.
// See https://anilist.gitbook.io/anilist-apiv2-docs/ for the schema.
const https = require('https');

const GRAPHQL_ENDPOINT = 'https://graphql.anilist.co';

// AniList enforces 90 requests/minute (documented) and warns that
// sustained abuse can result in an outright IP block - a much worse
// outcome than requests simply running a bit slower. A per-call-site
// delay (e.g. spacing inside one worker pool) can't actually guarantee
// this, since several concurrent workers - or any other part of the
// app calling AniList at the same time, like a live search - each
// individually "spaced out" still adds up to an aggregate rate far
// past the real limit. This gate is global and serialized: every
// request, from anywhere in this module, waits its turn through the
// same queue, so the true aggregate rate is what's actually being
// limited. A 429 sets a pause that blocks every subsequent request
// until the time the API itself specifies (Retry-After), not just a
// fixed guess, and not just for whichever single request happened to
// hit the limit.
//
// Priority-aware: a large background operation (the metadata backfill,
// including the MAL<->AniList cross-reference pass) can queue up
// requests for potentially hundreds of shows - without priority, a
// foreground request triggered by someone actually using the app right
// now (opening a title page's cast or related-shows section) would
// have to wait behind literally all of them first, which is a direct,
// concrete way the app can end up feeling slow to enter a series while
// that kind of background work is active. High-priority requests
// always get served next whenever a rate-limit slot opens, ahead of
// anything still waiting in the low-priority queue - the overall rate
// limit itself (spacing and the 429 pause) is still fully respected
// across both combined, so this doesn't reopen the original
// overwhelming-the-API problem, it just stops background bulk work
// from starving foreground responsiveness while sharing the same
// budget.
const MIN_REQUEST_INTERVAL_MS = 900; // ~66/min - comfortably under the 90/min documented ceiling, leaving headroom for jitter and other concurrent callers
let lastRequestAt = 0;
let pausedUntil = 0;
const highPriorityQueue = [];
const lowPriorityQueue = [];
let processingQueue = false;

function waitForTurn(priority, taskFn) {
  return new Promise((resolve, reject) => {
    (priority === 'low' ? lowPriorityQueue : highPriorityQueue).push({ taskFn, resolve, reject });
    if (!processingQueue) { processingQueue = true; processQueue(); }
  });
}

async function processQueue() {
  const next = highPriorityQueue.shift() || lowPriorityQueue.shift();
  if (!next) { processingQueue = false; return; }
  const waitUntil = Math.max(lastRequestAt + MIN_REQUEST_INTERVAL_MS, pausedUntil);
  const now = Date.now();
  if (waitUntil > now) await new Promise((r) => setTimeout(r, waitUntil - now));
  lastRequestAt = Date.now();
  // Genuinely wait for this request to finish - success or failure -
  // before moving on to the next queued item. A 429 setting the pause
  // window below only actually protects anything still queued if it's
  // set before that next item is dispatched, not after.
  try {
    next.resolve(await next.taskFn());
  } catch (e) {
    next.reject(e);
  }
  processQueue();
}

function graphqlRequest(query, variables, priority) {
  return waitForTurn(priority, () => new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      if (res.statusCode === 429) {
        const retryAfterSec = parseInt(res.headers['retry-after'], 10);
        pausedUntil = Date.now() + (Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 60000); // fall back to a full minute (AniList's own documented penalty window) if the header's ever missing/malformed
      }
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { return reject(new Error(`AniList returned invalid JSON: ${e.message}`)); }
        if (parsed.errors && parsed.errors.length) {
          return reject(new Error(`AniList API error: ${parsed.errors.map((er) => er.message).join('; ')}`));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`AniList API error ${res.statusCode}`));
        }
        resolve(parsed.data);
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('AniList request timed out')));
    req.write(body);
    req.end();
  }));
}

// AniList's description field can contain light HTML (<br>, <i>, <b>) -
// strip it down to plain text, matching MAL's synopsis field shape.
function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
}

function mapSearchNode(m) {
  return {
    id: m.id,
    title: (m.title && (m.title.english || m.title.romaji)) || (m.title && m.title.romaji),
    englishTitle: (m.title && m.title.english) || null,
    japaneseTitle: (m.title && m.title.native) || null,
    synonyms: m.synonyms || [],
    image: (m.coverImage && (m.coverImage.large || m.coverImage.medium)) || null,
    year: (m.startDate && m.startDate.year) || null,
    score: m.averageScore != null ? m.averageScore / 10 : null, // AniList uses 0-100, normalized to MAL's 0-10 scale
    episodes: m.episodes || null,
    chapters: m.chapters || null,
    mediaType: m.format || null,
  };
}

const SEARCH_FIELDS = `id title { romaji english native } synonyms coverImage { large medium } startDate { year } averageScore genres episodes chapters format`;
const DETAIL_FIELDS = `id title { romaji english } description(asHtml: false) startDate { year } genres isAdult coverImage { extraLarge large } bannerImage studios(isMain: true) { nodes { name } }`;

// Voice actors + key staff (director, writer, composer, etc.) for the
// Cast & Production section - the same kind of factual credit listing
// any media database (IMDB, TMDB, AniList's own site) shows, sourced
// from AniList's public API like the rest of this app's metadata.
// Real per-episode titles, sourced from AniList's streamingEpisodes
// field (which aggregates data streaming partners provide) - the same
// legitimate public API already used for everything else in this
// integration. Deliberately doesn't attempt a per-episode overview/
// synopsis: AniList's public API has no such field, and that kind of
// editorial writing is specific to licensed streaming platforms with
// their own content deals - there's no legitimate free API to source
// that from, so this only surfaces what's actually real.
async function getStreamingEpisodeTitles(id) {
  const gqlQuery = `query ($id: Int) { Media(id: $id) { streamingEpisodes { title thumbnail } } }`;
  const data = await graphqlRequest(gqlQuery, { id: parseInt(id, 10) });
  const episodes = (data.Media && data.Media.streamingEpisodes) || [];
  // Titles usually look like "Episode 12 - The Actual Title" - this
  // pulls out just the number and the part after the dash, so the
  // frontend can match by episode number and show a clean title
  // without the redundant "Episode N -" prefix repeated next to the
  // number it's already displaying.
  return episodes.map((ep) => {
    const match = (ep.title || '').match(/^Episode\s+(\d+)\s*-\s*(.+)$/i);
    return match ? { number: parseInt(match[1], 10), title: match[2].trim(), thumbnail: ep.thumbnail || null } : null;
  }).filter(Boolean);
}

async function getCastAndStaff(id, priority = 'high') {
  const gqlQuery = `query ($id: Int) {
    Media(id: $id) {
      characters(sort: ROLE, perPage: 10) {
        edges {
          role
          node { name { full } }
          voiceActors(language: JAPANESE, sort: RELEVANCE) { id name { full } image { medium } }
        }
      }
      staff(sort: RELEVANCE, perPage: 6) {
        edges { role node { id name { full } image { medium } } }
      }
    }
  }`;
  const data = await graphqlRequest(gqlQuery, { id: parseInt(id, 10) }, priority);
  const media = data.Media;
  if (!media) return { cast: [], staff: [] };
  const cast = (media.characters.edges || [])
    .filter((e) => e.voiceActors && e.voiceActors[0])
    .map((e) => ({ personId: e.voiceActors[0].id, name: e.voiceActors[0].name.full, image: e.voiceActors[0].image ? e.voiceActors[0].image.medium : null, role: e.node.name.full }));
  const staff = (media.staff.edges || [])
    .map((e) => ({ personId: e.node.id, name: e.node.name.full, image: e.node.image ? e.node.image.medium : null, role: e.role }));
  return { cast, staff };
}

// Sequels, prequels, side stories, and spin-offs - AniList's relations
// data, filtered to anime-to-anime relationships only (excluding manga/
// light novel source material, which isn't directly relevant for "more
// like this" in an anime player) and the relation types that actually
// mean "another anime worth watching related to this one" - excludes
// things like ADAPTATION (the source manga) or CHARACTER (a loose,
// often-unrelated character cameo) that would be confusing here.
const RELEVANT_RELATION_TYPES = new Set(['SEQUEL', 'PREQUEL', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'SUMMARY', 'PARENT']);

async function getRelations(id) {
  const gqlQuery = `query ($id: Int) {
    Media(id: $id) {
      relations {
        edges {
          relationType
          node { id type format title { romaji english } coverImage { large medium } startDate { year } episodes }
        }
      }
    }
  }`;
  const data = await graphqlRequest(gqlQuery, { id: parseInt(id, 10) });
  const edges = (data.Media && data.Media.relations && data.Media.relations.edges) || [];
  return edges
    .filter((e) => e.node.type === 'ANIME' && RELEVANT_RELATION_TYPES.has(e.relationType))
    .map((e) => ({
      anilistId: e.node.id,
      relationType: e.relationType,
      title: (e.node.title && (e.node.title.english || e.node.title.romaji)) || null,
      coverUrl: (e.node.coverImage && (e.node.coverImage.large || e.node.coverImage.medium)) || null,
      year: (e.node.startDate && e.node.startDate.year) || null,
      format: e.node.format || null,
      episodes: e.node.episodes || null,
    }));
}

// Airing status + next-episode timing for many shows at once, batched
// via AniList's id_in filter rather than one request per show - a
// profile following a reasonable number of ongoing shows could easily
// mean dozens of individual requests otherwise, which is both slow and
// an easy way to get rate-limited for no good reason when one request
// covers the same ground.
const AIRING_BATCH_SIZE = 50;
async function getAiringSchedules(anilistIds) {
  const uniqueIds = [...new Set(anilistIds)].filter(Boolean).map((id) => parseInt(id, 10));
  const results = {};
  for (let i = 0; i < uniqueIds.length; i += AIRING_BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + AIRING_BATCH_SIZE);
    const gqlQuery = `query ($ids: [Int]) {
      Page(perPage: ${AIRING_BATCH_SIZE}) {
        media(id_in: $ids, type: ANIME) {
          id status episodes
          nextAiringEpisode { airingAt episode }
        }
      }
    }`;
    const data = await graphqlRequest(gqlQuery, { ids: batch });
    const mediaList = (data.Page && data.Page.media) || [];
    for (const m of mediaList) {
      results[m.id] = {
        status: m.status || null,
        totalEpisodes: m.episodes || null,
        nextAiringEpisode: m.nextAiringEpisode ? { airingAt: m.nextAiringEpisode.airingAt, episode: m.nextAiringEpisode.episode } : null,
      };
    }
  }
  return results;
}

// A person's full body of work - queried as both a voice actor and as
// staff (some people do both, e.g. a director who also voices a
// character), combined and deduplicated by media id. The caller then
// matches results against the local library the same way related
// shows does, since AniList knows nothing about which of these titles
// someone actually has.
async function getPersonCredits(personId) {
  const gqlQuery = `query ($id: Int) {
    Staff(id: $id) {
      name { full }
      characterMedia(perPage: 25, sort: POPULARITY_DESC) { edges { node { id type title { romaji english } coverImage { large medium } } } }
      staffMedia(perPage: 25, sort: POPULARITY_DESC) { edges { node { id type title { romaji english } coverImage { large medium } } } }
    }
  }`;
  const data = await graphqlRequest(gqlQuery, { id: parseInt(personId, 10) });
  const staffNode = data.Staff;
  if (!staffNode) return { name: null, credits: [] };
  const seen = new Map();
  const allEdges = [...(staffNode.characterMedia.edges || []), ...(staffNode.staffMedia.edges || [])];
  for (const e of allEdges) {
    if (e.node.type !== 'ANIME' || seen.has(e.node.id)) continue;
    seen.set(e.node.id, {
      anilistId: e.node.id,
      title: (e.node.title && (e.node.title.english || e.node.title.romaji)) || null,
      coverUrl: (e.node.coverImage && (e.node.coverImage.large || e.node.coverImage.medium)) || null,
    });
  }
  return { name: staffNode.name ? staffNode.name.full : null, credits: [...seen.values()] };
}

async function searchByType(mediaType, query, limit = 12) {
  const gqlQuery = `query ($search: String, $type: MediaType, $perPage: Int) {
    Page(perPage: $perPage) { media(search: $search, type: $type, sort: SEARCH_MATCH) { ${SEARCH_FIELDS} } }
  }`;
  const data = await graphqlRequest(gqlQuery, { search: query, type: mediaType, perPage: limit });
  return ((data.Page && data.Page.media) || []).map(mapSearchNode);
}

async function getDetailsByType(id, priority = 'high') {
  const gqlQuery = `query ($id: Int) { Media(id: $id) { ${DETAIL_FIELDS} } }`;
  const data = await graphqlRequest(gqlQuery, { id: parseInt(id, 10) }, priority);
  const d = data.Media;
  if (!d) throw new Error('Not found on AniList');
  return {
    id: d.id,
    title: (d.title && (d.title.romaji || d.title.english)) || null,
    englishTitle: (d.title && d.title.english) || null,
    description: stripHtml(d.description),
    year: (d.startDate && d.startDate.year) || null,
    genres: d.genres || [],
    studios: (d.studios && d.studios.nodes) ? d.studios.nodes.map((n) => n.name) : [],
    rating: d.isAdult ? 'R+' : null, // matches the same mature-content keyword the app already checks for MAL ratings
    coverUrl: (d.coverImage && (d.coverImage.extraLarge || d.coverImage.large)) || null,
    bannerUrl: d.bannerImage || null,
  };
}

async function lookupByIdByType(mediaType, id) {
  const gqlQuery = `query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { ${SEARCH_FIELDS} } }`;
  const data = await graphqlRequest(gqlQuery, { id: parseInt(id, 10), type: mediaType });
  if (!data.Media) return [];
  return [mapSearchNode(data.Media)];
}

// AniList can look up its own entry directly by MAL id (idMal) - the
// most reliable cross-reference available (no fuzzy title matching
// needed, which risks a wrong match between similarly-named titles).
// This is what lets a show matched via MAL become eligible for cast
// data too, since Cast & Production strictly requires an AniList id,
// and a MAL-sourced import never sets one on its own - MAL and
// AniList use entirely separate ID spaces for the same shows.
async function lookupAnilistIdByMalId(malId, mediaType, priority = 'low') {
  const gqlQuery = `query ($idMal: Int, $type: MediaType) { Media(idMal: $idMal, type: $type) { id } }`;
  const data = await graphqlRequest(gqlQuery, { idMal: parseInt(malId, 10), type: mediaType }, priority);
  return data.Media ? data.Media.id : null;
}

function search(query, limit = 12) { return searchByType('ANIME', query, limit); }
function getDetails(id, priority) { return getDetailsByType(id, priority); }
function searchManga(query, limit = 12) { return searchByType('MANGA', query, limit); }
function getMangaDetails(id) { return getDetailsByType(id); }
function lookupById(id) { return lookupByIdByType('ANIME', id); }
function lookupMangaById(id) { return lookupByIdByType('MANGA', id); }

// Image downloading has nothing AniList-specific about it - reuse the
// same well-tested implementation mal.js already has (handles redirects,
// which AniList/Cloudflare-fronted cover images do sometimes issue).
const { downloadImage } = require('./mal');

module.exports = { search, getDetails, searchManga, getMangaDetails, downloadImage, lookupById, lookupMangaById, getCastAndStaff, getStreamingEpisodeTitles, getRelations, getAiringSchedules, getPersonCredits, lookupAnilistIdByMalId };
