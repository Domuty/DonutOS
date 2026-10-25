// Which icon to show for a file, folder or app.

const base = new URL('../assets/icons/', import.meta.url).href;
const CODE = new Set(['.js', '.mjs', '.json', '.html', '.htm', '.css', '.xml', '.yml', '.yaml', '.py', '.c', '.cpp', '.java', '.ts', '.sh', '.dsh']);

export const fileIconUrl = (name) => `${base}files/${name}.svg`;
export const appIconUrl = (name) => `${base}apps/${name}.svg`;

export function iconForEntry(entry, { open = false } = {}) {
  if (entry.type === 'dir') return fileIconUrl(open ? 'folder-open' : 'folder');
  if (CODE.has(entry.ext)) return fileIconUrl('code');
  if (entry.ext === '.pdf') return fileIconUrl('pdf');
  if (entry.ext === '.ddoc') return fileIconUrl('document');
  const k = entry.kind;
  if (['text', 'image', 'audio', 'video', 'archive', 'app'].includes(k)) return fileIconUrl(k);
  return fileIconUrl('generic');
}

const TYPE_NAMES = {
  folder: 'File folder', text: 'Text document', image: 'Image', audio: 'Audio file', video: 'Video file',
  archive: 'Compressed (zipped) folder', document: 'Document', app: 'DonutOS app package', shortcut: 'Shortcut', binary: 'File',
};

export function typeName(entry) {
  if (entry.type === 'dir') return TYPE_NAMES.folder;
  const ext = entry.ext ? entry.ext.slice(1).toUpperCase() : '';
  if (entry.kind === 'binary') return ext ? `${ext} file` : 'File';
  return `${TYPE_NAMES[entry.kind] || 'File'}${ext ? ` (${ext})` : ''}`;
}
