// Reads song details from audio files: ID3v2 (MP3), Vorbis comments (FLAC, Ogg) and the
// MP4 'ilst' atoms (M4A). Returns { title, artist, album, year, track, cover: Blob | null }.

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');
const utf16 = new TextDecoder('utf-16');
const utf16be = new TextDecoder('utf-16be');

export function readTags(bytes) {
  try {
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return id3(bytes);
    if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) return flac(bytes);
    if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return ogg(bytes);
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return mp4(bytes);
  } catch { /* damaged or unusual file: fall back to the file name */ }
  return {};
}

const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
const be32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const le32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | ((b[o + 3] << 24) >>> 0);

function text(enc, b) {
  const s = enc === 0 ? latin1.decode(b) : enc === 1 ? utf16.decode(b) : enc === 2 ? utf16be.decode(b) : utf8.decode(b);
  return s.replace(/\0+$/, '').replace(/\0/g, ' / ').trim();
}

function id3(b) {
  const ver = b[3];
  const flags = b[5];
  const size = syncsafe(b, 6);
  let o = 10;
  if (flags & 0x40) o += ver === 4 ? syncsafe(b, o) : be32(b, o) + 4; // extended header
  const end = Math.min(b.length, 10 + size);
  const out = {};
  const idLen = ver === 2 ? 3 : 4;
  while (o + idLen + 4 < end) {
    const id = latin1.decode(b.subarray(o, o + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const len = ver === 2 ? (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5] : ver === 4 ? syncsafe(b, o + 4) : be32(b, o + 4);
    const head = ver === 2 ? 6 : 10;
    const data = b.subarray(o + head, o + head + len);
    o += head + len;
    if (!len) continue;
    const t = (key) => { out[key] = text(data[0], data.subarray(1)); };
    if (id === 'TIT2' || id === 'TT2') t('title');
    else if (id === 'TPE1' || id === 'TP1') t('artist');
    else if (id === 'TALB' || id === 'TAL') t('album');
    else if (id === 'TYER' || id === 'TDRC' || id === 'TYE') { t('year'); out.year = out.year.slice(0, 4); }
    else if (id === 'TRCK' || id === 'TRK') { t('track'); out.track = parseInt(out.track, 10) || null; }
    else if ((id === 'APIC' || id === 'PIC') && !out.cover) {
      const enc = data[0];
      let p = 1, mime;
      if (id === 'PIC') { mime = `image/${latin1.decode(data.subarray(1, 4)).toLowerCase().replace('jpg', 'jpeg')}`; p = 4; }
      else { const z = data.indexOf(0, 1); mime = latin1.decode(data.subarray(1, z)) || 'image/jpeg'; p = z + 1; }
      p += 1; // picture type
      // Skip the description (terminated by 0 or 00 00 for UTF-16).
      if (enc === 1 || enc === 2) { while (p + 1 < data.length && (data[p] || data[p + 1])) p += 2; p += 2; } else { while (p < data.length && data[p]) p++; p++; }
      out.cover = new Blob([data.slice(p)], { type: mime.includes('/') ? mime : `image/${mime}` });
    }
  }
  return out;
}

function vorbisComments(b, o, out) {
  const vendorLen = le32(b, o); o += 4 + vendorLen;
  const n = le32(b, o); o += 4;
  for (let i = 0; i < n && o < b.length; i++) {
    const len = le32(b, o); o += 4;
    const s = utf8.decode(b.subarray(o, o + len)); o += len;
    const eq = s.indexOf('=');
    const k = s.slice(0, eq).toUpperCase(), v = s.slice(eq + 1);
    if (k === 'TITLE') out.title = v; else if (k === 'ARTIST') out.artist = v; else if (k === 'ALBUM') out.album = v;
    else if (k === 'DATE') out.year = v.slice(0, 4); else if (k === 'TRACKNUMBER') out.track = parseInt(v, 10) || null;
  }
}

function flac(b) {
  const out = {};
  let o = 4;
  for (let last = false; !last && o + 4 < b.length;) {
    last = !!(b[o] & 0x80);
    const type = b[o] & 0x7f;
    const len = (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    const start = o + 4;
    if (type === 4) vorbisComments(b, start, out);
    if (type === 6 && !out.cover) {
      let p = start + 4;
      const ml = be32(b, p); p += 4;
      const mime = latin1.decode(b.subarray(p, p + ml)); p += ml;
      const dl = be32(b, p); p += 4 + dl + 16;
      const size = be32(b, p); p += 4;
      out.cover = new Blob([b.slice(p, p + size)], { type: mime });
    }
    o = start + len;
  }
  return out;
}

function ogg(b) {
  // The comment header is in the second Ogg packet: "\x03vorbis" or "OpusTags".
  const out = {};
  const s = latin1.decode(b.subarray(0, Math.min(b.length, 65536)));
  let i = s.indexOf('\x03vorbis');
  if (i >= 0) vorbisComments(b, i + 7, out);
  else if ((i = s.indexOf('OpusTags')) >= 0) vorbisComments(b, i + 8, out);
  return out;
}

function mp4(b) {
  const out = {};
  const walk = (start, end, path) => {
    let o = start;
    while (o + 8 <= end) {
      let size = be32(b, o);
      const type = latin1.decode(b.subarray(o + 4, o + 8));
      if (size < 8) size = end - o;
      const body = o + 8;
      if (['moov', 'udta', 'ilst'].includes(type)) walk(body, o + size, [...path, type]);
      else if (type === 'meta') walk(body + 4, o + size, [...path, type]);
      else if (path[path.length - 1] === 'ilst') {
        const dataAt = body;
        const dlen = be32(b, dataAt);
        const payload = b.subarray(dataAt + 16, dataAt + dlen);
        const str = () => utf8.decode(payload);
        if (type === '©nam') out.title = str(); else if (type === '©ART') out.artist = str(); else if (type === '©alb') out.album = str();
        else if (type === '©day') out.year = str().slice(0, 4); else if (type === 'trkn') out.track = (payload[2] << 8) | payload[3];
        else if (type === 'covr' && !out.cover) out.cover = new Blob([payload.slice()], { type: b[dataAt + 11] === 14 ? 'image/png' : 'image/jpeg' });
      }
      o += size;
    }
  };
  walk(0, b.length, []);
  return out;
}
