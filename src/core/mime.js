// Maps file extensions to MIME types and broad kinds used by icons and associations.

const TYPES = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.log': 'text/plain', '.csv': 'text/csv',
  '.json': 'application/json', '.xml': 'application/xml', '.yml': 'text/yaml', '.yaml': 'text/yaml',
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain', '.css': 'text/css',
  '.html': 'text/html', '.htm': 'text/html', '.ini': 'text/plain', '.sh': 'text/x-shellscript',
  '.py': 'text/x-python', '.c': 'text/plain', '.cpp': 'text/plain', '.java': 'text/plain',
  '.dsh': 'text/x-donut-script', '.ddoc': 'application/x-donut-document',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.m4a': 'audio/mp4',
  '.flac': 'audio/flac', '.aac': 'audio/aac', '.weba': 'audio/webm',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.ics': 'text/calendar', '.eml': 'message/rfc822', '.opus': 'audio/ogg', '.m4v': 'video/mp4',
  '.dapp': 'application/x-donut-app', '.lnk': 'application/x-donut-shortcut',
};

export function mimeFor(ext) {
  return TYPES[(ext || '').toLowerCase()] || 'application/octet-stream';
}

/** Broad category: text | image | audio | video | archive | document | app | shortcut | binary */
export function kindFor(ext) {
  const m = mimeFor(ext);
  if (m === 'application/zip') return 'archive';
  if (m === 'application/x-donut-app') return 'app';
  if (m === 'application/x-donut-shortcut') return 'shortcut';
  if (m === 'application/pdf' || m === 'application/x-donut-document') return 'document';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/xml') return 'text';
  return 'binary';
}

export const isTextExt = (ext) => kindFor(ext) === 'text';
