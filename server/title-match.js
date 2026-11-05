// Picks the best MAL search result for a local folder name, instead of
// blindly trusting whichever result MAL's own search ranks first. This
// matters a lot for anything with a common title, an alternate
// romanization, or ambiguous season naming ("Show Name" vs "Show Name
// 2nd Season" vs "Show Name: Season 2") - MAL's own ranking doesn't
// always put the actual right match first, and picking blindly either
// tags a title with the WRONG show's poster/synopsis, or looks like the
// real match got "skipped" when it just scored too low silently.
function normalize(title) {
  return (title || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Simple word-overlap similarity (Jaccard-like), 0-1. Cheap, and works
// well for title matching where word order/minor phrasing varies more
// than the actual set of meaningful words.
function wordOverlapScore(a, b) {
  const wordsA = new Set(normalize(a).split(' ').filter(Boolean));
  const wordsB = new Set(normalize(b).split(' ').filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const w of wordsA) if (wordsB.has(w)) shared++;
  return shared / Math.max(wordsA.size, wordsB.size);
}

function titleScore(localTitle, candidate) {
  const normLocal = normalize(localTitle);
  const candidateTitles = [candidate.title, candidate.englishTitle, candidate.japaneseTitle, ...(candidate.synonyms || [])].filter(Boolean);
  let best = 0;
  for (const t of candidateTitles) {
    const normCandidate = normalize(t);
    if (normLocal === normCandidate) return 1; // exact match, short-circuit
    let score = wordOverlapScore(localTitle, t);
    // A local title that's fully contained in (or fully contains) the
    // candidate's title is a strong signal even if word-overlap is
    // partial (e.g. "Show Name" inside "Show Name: The Movie").
    if (normCandidate.includes(normLocal) || normLocal.includes(normCandidate)) {
      score = Math.max(score, 0.75);
    }
    if (score > best) best = score;
  }
  return best;
}

// Returns the best-scoring candidate, or null if nothing scores well
// enough to be confident about - better to skip a title (leave it for
// manual "Import from MAL") than confidently attach the wrong show's
// poster and synopsis to it.
const MIN_CONFIDENT_SCORE = 0.5;
function pickBestMatch(localTitle, candidates) {
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = titleScore(localTitle, c);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (best && bestScore >= MIN_CONFIDENT_SCORE) return { match: best, score: bestScore };
  return null;
}

module.exports = { normalize, titleScore, pickBestMatch };
