// Local user accounts.
//
// Accounts are stored in the key-value store under "accounts". Passwords and PINs are
// hashed (core/crypto.js). Each account has its own home folder (/Users/<Name>) and its
// own settings document. The guest account has no password and is wiped when it signs out.
//
// Rules (like a typical desktop OS):
//  - the first account is an administrator; there is always at least one administrator
//  - names are unique (case-insensitive); "Guest" and "Public" are reserved
//  - five wrong attempts lock the account for 30 seconds (persisted across restarts)

import { DonutError } from './errors.js';
import { hashSecret, verifySecret } from './crypto.js';
import { uid as makeId } from './util.js';
import * as P from './path.js';

const KEY = 'accounts';
const LOCKOUT_KEY = 'accounts:lockout';
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;
export const GUEST_ID = 'guest';
const RESERVED = new Set(['guest', 'public', 'system', 'administrator', 'default', 'all users']);
const AVATAR_COLORS = ['#e8618c', '#f08a4b', '#e6b422', '#4cb782', '#2fa8c9', '#5b7cf0', '#9466e8', '#d45ac8'];

export class AccountError extends DonutError {
  constructor(code, message) { super(code, message); this.name = 'AccountError'; }
}

export class AccountService {
  #kv; #fs; #settings; #bus;
  #accounts = [];
  #lockout = {};

  constructor({ kv, fs, settings, bus }) {
    this.#kv = kv; this.#fs = fs; this.#settings = settings; this.#bus = bus;
  }

  async load() {
    this.#accounts = (await this.#kv.get(KEY)) || [];
    this.#lockout = (await this.#kv.get(LOCKOUT_KEY)) || {};
  }

  get count() { return this.#accounts.length; }

  /** Public information about every account (never hashes). Guest is included when enabled. */
  list({ includeGuest = true } = {}) {
    const out = this.#accounts.map((a) => this.#public(a));
    if (includeGuest && this.guestEnabled()) out.push(this.guest());
    return out;
  }

  get(id) {
    if (id === GUEST_ID) return this.guestEnabled() ? this.guest() : null;
    const a = this.#accounts.find((x) => x.id === id);
    return a ? this.#public(a) : null;
  }

  guestEnabled() { return this.#settings.get('system.guestEnabled'); }

  guest() {
    return {
      id: GUEST_ID, name: 'Guest', type: 'guest', isGuest: true, home: '/Users/Guest',
      avatar: { type: 'initials', color: '#6b6475' }, hasPassword: false, hasPin: false, hint: '',
      createdAt: 0, lastSignIn: 0,
    };
  }

  /** Creates an account. Returns its public record. */
  async create({ name, password = '', pin = '', hint = '', type, avatar } = {}) {
    name = this.#validName(name);
    if (pin) this.#validPin(pin);
    if (hint && password && hint.toLowerCase().includes(password.toLowerCase())) {
      throw new AccountError('EHINT', 'The password hint cannot contain the password');
    }
    const isFirst = this.#accounts.length === 0;
    const home = await this.#homeFor(name);
    const a = {
      id: makeId('u'),
      name,
      type: isFirst ? 'admin' : type === 'admin' ? 'admin' : 'standard',
      home,
      avatar: avatar || { type: 'initials', color: AVATAR_COLORS[this.#accounts.length % AVATAR_COLORS.length] },
      password: password ? await hashSecret(password) : null,
      pin: pin ? await hashSecret(pin) : null,
      hint: String(hint || '').slice(0, 100),
      createdAt: Date.now(),
      lastSignIn: 0,
    };
    this.#accounts.push(a);
    await this.#save();
    this.#bus.emit('accounts:changed', { id: a.id, op: 'create' });
    return this.#public(a);
  }

  /**
   * Checks a password or PIN. Returns { ok, lockedFor (ms), attemptsLeft }.
   * Accounts with neither a password nor a PIN accept an empty password.
   */
  async verify(id, { password, pin } = {}) {
    if (id === GUEST_ID) return { ok: this.guestEnabled(), lockedFor: 0, attemptsLeft: MAX_ATTEMPTS };
    const a = this.#find(id);
    const lockedFor = this.lockedFor(id);
    if (lockedFor > 0) return { ok: false, lockedFor, attemptsLeft: 0 };
    let ok;
    if (pin !== undefined) ok = !!a.pin && (await verifySecret(String(pin), a.pin));
    else if (!a.password && !a.pin) ok = !password;
    else ok = !!a.password && (await verifySecret(String(password ?? ''), a.password));
    const rec = this.#lockout[id] || { count: 0, until: 0 };
    if (ok) {
      delete this.#lockout[id];
      a.lastSignIn = Date.now();
      await this.#save();
    } else {
      rec.count += 1;
      if (rec.count >= MAX_ATTEMPTS) { rec.until = Date.now() + LOCKOUT_MS; rec.count = 0; }
      this.#lockout[id] = rec;
    }
    await this.#kv.set(LOCKOUT_KEY, this.#lockout);
    return { ok, lockedFor: this.lockedFor(id), attemptsLeft: ok ? MAX_ATTEMPTS : MAX_ATTEMPTS - (this.#lockout[id]?.count || 0) };
  }

  lockedFor(id) {
    const until = this.#lockout[id]?.until || 0;
    return Math.max(0, until - Date.now());
  }

  /** Changes the password. `current` is required unless `asAdmin` (an administrator resetting it). */
  async setPassword(id, { current, next, hint, asAdmin = false }) {
    const a = this.#find(id);
    if (!asAdmin && a.password && !(await verifySecret(String(current ?? ''), a.password))) {
      throw new AccountError('EAUTH', 'The current password is incorrect');
    }
    if (hint !== undefined && next && hint.toLowerCase().includes(next.toLowerCase())) {
      throw new AccountError('EHINT', 'The password hint cannot contain the password');
    }
    a.password = next ? await hashSecret(next) : null;
    if (hint !== undefined) a.hint = String(hint).slice(0, 100);
    if (!next) a.hint = '';
    await this.#save();
    this.#bus.emit('accounts:changed', { id, op: 'password' });
  }

  async setPin(id, pin) {
    const a = this.#find(id);
    if (pin) this.#validPin(pin);
    a.pin = pin ? await hashSecret(pin) : null;
    await this.#save();
    this.#bus.emit('accounts:changed', { id, op: 'pin' });
  }

  async rename(id, name) {
    const a = this.#find(id);
    a.name = this.#validName(name, id);
    await this.#save();
    this.#bus.emit('accounts:changed', { id, op: 'rename' });
  }

  async setAvatar(id, avatar) {
    const a = this.#find(id);
    if (avatar?.type === 'image' && !(typeof avatar.data === 'string' && avatar.data.startsWith('data:image/') && avatar.data.length < 400_000)) {
      throw new AccountError('EINVAL', 'The picture must be an image under 300 KB');
    }
    if (avatar?.type === 'initials' && !/^#[0-9a-f]{6}$/i.test(avatar.color)) throw new AccountError('EINVAL', 'Invalid colour');
    a.avatar = avatar;
    await this.#save();
    this.#bus.emit('accounts:changed', { id, op: 'avatar' });
  }

  async setType(id, type) {
    const a = this.#find(id);
    if (!['admin', 'standard'].includes(type)) throw new AccountError('EINVAL', 'Type must be admin or standard');
    if (a.type === 'admin' && type !== 'admin' && this.#admins().length === 1) {
      throw new AccountError('ELASTADMIN', 'There must be at least one administrator');
    }
    a.type = type;
    await this.#save();
    this.#bus.emit('accounts:changed', { id, op: 'type' });
  }

  /** Removes an account, its settings and (optionally) its files. */
  async remove(id, { deleteFiles = true } = {}) {
    const a = this.#find(id);
    if (a.type === 'admin' && this.#admins().length === 1) throw new AccountError('ELASTADMIN', 'The last administrator cannot be removed');
    if (this.#settings.isLoaded(id)) throw new AccountError('EBUSY', `${a.name} is signed in. Sign them out first.`);
    this.#accounts = this.#accounts.filter((x) => x.id !== id);
    delete this.#lockout[id];
    await this.#save();
    await this.#kv.set(LOCKOUT_KEY, this.#lockout);
    await this.#settings.deleteUser(id);
    if (deleteFiles && (await this.#fs.exists(a.home))) await this.#fs.remove(a.home, { recursive: true });
    this.#bus.emit('accounts:changed', { id, op: 'remove' });
  }

  /** Erases everything the guest left behind. */
  async wipeGuest() {
    if (await this.#fs.exists('/Users/Guest')) await this.#fs.remove('/Users/Guest', { recursive: true });
    if (!this.#settings.isLoaded(GUEST_ID)) await this.#settings.deleteUser(GUEST_ID);
  }

  #admins() { return this.#accounts.filter((a) => a.type === 'admin'); }

  #find(id) {
    const a = this.#accounts.find((x) => x.id === id);
    if (!a) throw new AccountError('ENOENT', 'That account does not exist');
    return a;
  }

  #validName(name, selfId) {
    name = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (!name) throw new AccountError('EINVAL', 'Enter a name');
    if (name.length > 32) throw new AccountError('EINVAL', 'Names can be at most 32 characters');
    if (/[\\/:*?"<>|\u0000-\u001f]/.test(name) || /^[. ]|[. ]$/.test(name)) throw new AccountError('EINVAL', 'Names cannot contain \\ / : * ? " < > | or start/end with a dot');
    if (RESERVED.has(name.toLowerCase())) throw new AccountError('EINVAL', `"${name}" is reserved`);
    if (this.#accounts.some((a) => a.id !== selfId && a.name.toLowerCase() === name.toLowerCase())) throw new AccountError('EEXIST', 'An account with that name already exists');
    return name;
  }

  #validPin(pin) {
    if (!/^\d{4,12}$/.test(String(pin))) throw new AccountError('EINVAL', 'A PIN must be 4 to 12 digits');
  }

  async #homeFor(name) {
    const base = name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim() || 'User';
    let candidate = base, n = 2;
    while (RESERVED.has(candidate.toLowerCase()) || (await this.#fs.exists(P.join('/Users', candidate)))) candidate = `${base}${n++}`;
    return P.join('/Users', candidate);
  }

  #public(a) {
    return {
      id: a.id, name: a.name, type: a.type, isGuest: false, home: a.home, avatar: a.avatar,
      hasPassword: !!a.password, hasPin: !!a.pin, hint: a.hint, createdAt: a.createdAt, lastSignIn: a.lastSignIn,
    };
  }

  async #save() { await this.#kv.set(KEY, this.#accounts); }
}
