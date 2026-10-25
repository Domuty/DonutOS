// Error types used across the core. Codes are stable and safe to switch on.

export class DonutError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.name = 'DonutError';
    this.code = code;
    if (details) this.details = details;
  }
}

export const FS_CODES = Object.freeze({
  ENOENT: 'No such file or folder',
  EEXIST: 'A file or folder with that name already exists',
  ENOTDIR: 'Not a folder',
  EISDIR: 'Is a folder',
  ENOTEMPTY: 'Folder is not empty',
  EACCES: 'Access denied',
  EINVAL: 'Invalid operation',
  ENOSPC: 'Not enough storage space',
  EIO: 'Input/output error',
});

export class FsError extends DonutError {
  constructor(code, path, message) {
    super(code, `${message || FS_CODES[code] || code}${path ? `: ${path}` : ''}`);
    this.name = 'FsError';
    this.path = path;
  }
}

export class PermissionError extends DonutError {
  constructor(appId, permission) {
    super('EPERM', `App "${appId}" does not have permission "${permission}"`);
    this.name = 'PermissionError';
    this.appId = appId;
    this.permission = permission;
  }
}

export class SettingsError extends DonutError {
  constructor(key, message) {
    super('ESETTING', `Setting "${key}": ${message}`);
    this.name = 'SettingsError';
    this.key = key;
  }
}

export class ProcessError extends DonutError {
  constructor(code, message) {
    super(code, message);
    this.name = 'ProcessError';
  }
}
