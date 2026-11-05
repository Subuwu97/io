function time(value) {
  const match = /^(\d+):(\d{2}):(\d{2})[.](\d{1,3})$/.exec(value.trim());
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number('0.' + match[4]) : null;
}
function lyricWindows(script) {
  let fields = [], events = false;
  const lyrics = [];
  for (const line of String(script).split(/\r?\n/)) {
    if (line.startsWith('[')) { events = /^\[Events\]/i.test(line); continue; }
    if (!events) continue;
    if (/^Format:/i.test(line)) { fields = line.slice(line.indexOf(':') + 1).split(',').map(field => field.trim().toLowerCase()); continue; }
    if (!/^Dialogue:/i.test(line) || !fields.length) continue;
    const values = line.slice(line.indexOf(':') + 1).trim().split(',');
    const textIndex = fields.indexOf('text'); if (textIndex < 0) continue;
    const text = values.slice(textIndex).join(','); const style = values[fields.indexOf('style')] || '';
    if (!/\\(?:k[fo]?|K)\d/.test(text) && !/(?:^|[_ -])(?:karaoke|song|lyrics?|romaji|kanji|op|ed)(?:$|[_ -])/i.test(style)) continue;
    if (/\\p[1-9]/.test(text)) continue;
    const start = time(values[fields.indexOf('start')] || ''), end = time(values[fields.indexOf('end')] || '');
    const plain = require('./subtitle-text').cleanSubtitleLine(text).slice(0, 4000);
    if (start !== null && end > start && plain) lyrics.push({ start, end, text: plain });
    if (lyrics.length >= 5000) break;
  }
  return lyrics;
}
module.exports = { lyricWindows };
