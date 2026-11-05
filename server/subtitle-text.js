// ASS effect generators can leave nested/unbalanced comments in converted VTT.
// Treat their contents as metadata, never as readable dialogue.
function cleanSubtitleLine(value) {
  let depth = 0, plain = '';
  for (const ch of String(value)) {
    if (ch === '{') { depth++; continue; }
    if (ch === '}') { if (depth) depth--; continue; }
    if (!depth) plain += ch;
  }
  plain = plain.replace(/\\[Nn]/g, ' ').replace(/\\h/g, ' ');
  // Orphaned override commands have already lost their braces during conversion.
  // Drop the effect line instead of trying to interpret arbitrary drawing syntax.
  if (/\\(?:an?|move|pos|org|fsc[xy]|fs|blur|bord|shad|fad|fade|[1-4]?[ac]|[1-4]vc|t|p|clip|iclip|fr[xyz]?|k[fo]?)(?:[(&\d-]|\s|$)/i.test(plain)) return '';
  return plain.replace(/<\/?font[^>]*>/gi, '').replace(/\s{2,}/g, ' ').trim();
}
module.exports = { cleanSubtitleLine };
