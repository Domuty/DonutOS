// Local mail: real delivery between the accounts on this DonutOS device. Each account has
// an address (name@device.local) and a mailbox stored in the key-value store, so mail
// reaches people who aren't signed in. Folders: inbox, drafts, sent, archive, deleted.

import { DonutError } from './errors.js';
import { uid as makeId } from './util.js';

const boxKey = (uid) => `mail:box:${uid}`;
export const FOLDERS = ['inbox', 'drafts', 'sent', 'archive', 'deleted'];
const MAX_ATTACH = 15 * 1024 * 1024;
const slug = (s, sep = '.') => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, sep).replace(/^[.-]+|[.-]+$/g, '') || 'user';

export class MailService {
  #kv; #accounts; #settings; #bus; #notifications;
  #cache = new Map();
  #queue = Promise.resolve();

  constructor({ kv, accounts, settings, bus, notifications }) {
    this.#kv = kv; this.#accounts = accounts; this.#settings = settings; this.#bus = bus; this.#notifications = notifications;
  }

  domain() { return `${slug(this.#settings.get('system.deviceName'), '-')}.local`; }
  addressOf(account) { return `${slug(account.name)}@${this.domain()}`; }

  /** Every local account with its address, for the address book. */
  directory() {
    return this.#accounts.list({ includeGuest: false }).map((a) => ({ uid: a.id, name: a.name, address: this.addressOf(a), avatar: a.avatar }));
  }

  /** The local account an address belongs to, or null for outside addresses. */
  resolve(address) {
    const a = String(address).trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, '$1');
    return this.directory().find((d) => d.address === a) || null;
  }

  async #load(uid) {
    if (!this.#cache.has(uid)) this.#cache.set(uid, (await this.#kv.get(boxKey(uid))) || []);
    return this.#cache.get(uid);
  }
  // Writes are queued so two deliveries can't overwrite each other.
  #save(uid, list) {
    this.#cache.set(uid, list);
    this.#queue = this.#queue.then(() => this.#kv.set(boxKey(uid), list)).catch(() => {});
    this.#bus.emit('mail:changed', { uid });
    return this.#queue;
  }

  async list(uid, folder) {
    const all = await this.#load(uid);
    return all.filter((m) => !folder || m.folder === folder).sort((a, b) => b.date - a.date);
  }
  async get(uid, id) { return (await this.#load(uid)).find((m) => m.id === id) || null; }
  async unread(uid) { return (await this.#load(uid)).filter((m) => m.folder === 'inbox' && !m.read).length; }

  async update(uid, id, patch) {
    const all = await this.#load(uid);
    const next = all.map((m) => (m.id === id ? { ...m, ...patch, id: m.id } : m));
    await this.#save(uid, next);
    return next.find((m) => m.id === id);
  }

  async remove(uid, id) {
    const all = await this.#load(uid);
    const m = all.find((x) => x.id === id);
    if (!m) return;
    // Deleting from Deleted removes it for good; otherwise it moves to Deleted.
    if (m.folder === 'deleted' || m.folder === 'drafts') await this.#save(uid, all.filter((x) => x.id !== id));
    else await this.#save(uid, all.map((x) => (x.id === id ? { ...x, folder: 'deleted', fromFolder: x.folder } : x)));
  }

  async emptyDeleted(uid) { await this.#save(uid, (await this.#load(uid)).filter((m) => m.folder !== 'deleted')); }

  async saveDraft(uid, draft) {
    const all = await this.#load(uid);
    const m = { ...draft, id: draft.id || makeId('m'), folder: 'drafts', date: Date.now(), read: true };
    await this.#save(uid, all.some((x) => x.id === m.id) ? all.map((x) => (x.id === m.id ? m : x)) : [...all, m]);
    return m;
  }

  /** Adds messages (e.g. imported .eml files) to a folder. */
  async addMessages(uid, messages, folder = 'inbox') {
    const all = await this.#load(uid);
    await this.#save(uid, [...all, ...messages.map((m) => ({ read: false, flagged: false, attachments: [], ...m, id: makeId('m'), folder }))]);
  }

  /**
   * Sends a message from `uid`. Local recipients receive it immediately; others are returned
   * in `external` for the caller to hand to the computer's email app.
   */
  async send(uid, { to = [], cc = [], subject = '', html = '', text = '', attachments = [], draftId = null, inReplyTo = null }) {
    const me = this.#accounts.get(uid);
    if (!me) throw new DonutError('EACCES', 'Only signed-in accounts can send mail');
    const size = attachments.reduce((n, a) => n + (a.size || 0), 0);
    if (size > MAX_ATTACH) throw new DonutError('E2BIG', 'Attachments can be up to 15 MB in total');
    const all = [...to, ...cc].map((x) => String(x).trim()).filter(Boolean);
    if (!all.length) throw new DonutError('EINVAL', 'Add at least one recipient');
    const bad = all.find((a) => !/^[^\s@<>]+@[^\s@<>]+$/.test(a.replace(/^.*<([^>]+)>.*$/, '$1')));
    if (bad) throw new DonutError('EINVAL', `“${bad}” isn’t an email address`);
    const from = { name: me.name, address: this.addressOf(me) };
    const base = { from, to, cc, subject, html, text, attachments, date: Date.now(), threadId: inReplyTo || null, flagged: false };
    const local = [], external = [];
    for (const addr of all) { const r = this.resolve(addr); if (r) { if (!local.some((x) => x.uid === r.uid)) local.push(r); } else external.push(addr); }
    for (const r of local) {
      const box = await this.#load(r.uid);
      await this.#save(r.uid, [...box, { ...base, id: makeId('m'), folder: 'inbox', read: false }]);
      if (r.uid !== uid && this.#settings.isLoaded(r.uid)) {
        this.#notifications.post({ appId: 'mail', appName: 'Mail', icon: 'assets/icons/apps/mail.svg', uid: r.uid, title: from.name, body: subject || '(No subject)', data: { mail: true } });
      }
    }
    const mine = await this.#load(uid);
    const sent = { ...base, id: makeId('m'), folder: 'sent', read: true, external };
    await this.#save(uid, [...mine.filter((m) => m.id !== draftId), sent]);
    return { sent, delivered: local.length, external };
  }

  /** Removes a deleted account's mailbox. */
  async dropMailbox(uid) { this.#cache.delete(uid); await this.#kv.delete(boxKey(uid)); }
}
