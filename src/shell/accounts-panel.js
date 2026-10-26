// Account management: your picture, name, password and PIN; and, for administrators,
// adding, changing and removing other accounts and the guest account.
// Rendered in a dialog for now; Settings › Accounts (phase 5) embeds it too.

import { h, mount } from '../ui/h.js';
import { icon } from '../ui/icons.js';
import { avatar, imageToAvatar } from '../ui/avatar.js';
import { dialog, confirmDialog, alertDialog } from '../ui/dialog.js';
import { showMenu } from '../ui/menu.js';

const COLORS = ['#e8618c', '#f08a4b', '#e6b422', '#4cb782', '#2fa8c9', '#5b7cf0', '#9466e8', '#d45ac8', '#6b6475'];

/** A small form dialog. `fields`: [{ key, label, type, hint, value }]. `submit(values)` may throw to show an error. */
async function formDialog(title, fields, submit, { ok = 'Save', intro } = {}) {
  const inputs = {};
  const err = h('div.error-text', { role: 'alert' });
  const body = h('div', { style: { display: 'grid', gap: '12px' } },
    intro ? h('p', intro) : null,
    fields.map((f) => {
      const id = `f-${f.key}-${Math.random().toString(36).slice(2, 6)}`;
      let el;
      if (f.type === 'select') el = h('select.input', { id }, f.options.map(([v, l]) => h('option', { value: v, selected: v === f.value }, l)));
      else el = h('input.input', { id, type: f.type || 'text', value: f.value || '', inputmode: f.numeric ? 'numeric' : undefined, maxlength: f.maxlength, autocomplete: f.type === 'password' ? 'new-password' : 'off',
        oninput: f.numeric ? (e) => { e.target.value = e.target.value.replace(/\D/g, ''); } : undefined });
      inputs[f.key] = el;
      return h('div.field', h('label', { for: id }, f.label), el, f.hint ? h('div.hint', f.hint) : null);
    }), err);
  const result = await dialog({
    title, body, cancelValue: false,
    buttons: [{ label: ok, value: true, primary: true, validate: async () => {
      const values = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
      try { await submit(values); return true; } catch (e) { err.textContent = e.message; return false; }
    } }, { label: 'Cancel', value: false }],
  });
  return result;
}

export function renderAccounts(container, { kernel, uid, onChanged = () => {} }) {
  const changed = () => { kernel.refreshSessionUser(uid); onChanged(); render(); };

  async function changePicture(anchor, me) {
    showMenu([
      { label: 'Browse files…', icon: 'image', onSelect: async () => {
        const [f] = await kernel.platform.host.importFiles({ multiple: false, accept: 'image/*' });
        if (!f) return;
        try {
          await kernel.accounts.setAvatar(me.id, { type: 'image', data: await imageToAvatar(f.data, f.type || 'image/png') });
          changed();
        } catch (e) { alertDialog('Couldn’t use that picture', e.message); }
      } },
      { label: 'Use a colour…', icon: 'palette', onSelect: () => pickColor(me) },
      ...(me.avatar?.type === 'image' ? [{ label: 'Remove picture', icon: 'trash', onSelect: async () => { await kernel.accounts.setAvatar(me.id, { type: 'initials', color: COLORS[0] }); changed(); } }] : []),
    ], { anchor });
  }

  async function pickColor(me) {
    let chosen = me.avatar?.color || COLORS[0];
    const preview = h('div', { style: { display: 'grid', justifyItems: 'center', gap: '16px' } });
    const paint = () => mount(preview, avatar({ ...me, avatar: { type: 'initials', color: chosen } }, 96),
      h('div.swatches', COLORS.map((c) => h('button.swatch', { type: 'button', 'aria-label': c, 'aria-pressed': String(c === chosen), style: { background: c }, onclick: () => { chosen = c; paint(); } }))));
    paint();
    if (await dialog({ title: 'Choose a colour', body: preview, cancelValue: false, buttons: [{ label: 'Save', value: true, primary: true }, { label: 'Cancel', value: false }] })) {
      await kernel.accounts.setAvatar(me.id, { type: 'initials', color: chosen });
      changed();
    }
  }

  const rename = (me) => formDialog('Change your name', [{ key: 'name', label: 'Name', value: me.name, maxlength: 32 }],
    async ({ name }) => { await kernel.accounts.rename(me.id, name); changed(); });

  const changePassword = (me) => formDialog(me.hasPassword ? 'Change your password' : 'Add a password', [
    ...(me.hasPassword ? [{ key: 'current', label: 'Current password', type: 'password' }] : []),
    { key: 'next', label: 'New password', type: 'password', hint: me.hasPassword ? 'Leave empty to remove your password.' : '' },
    { key: 'confirm', label: 'Confirm password', type: 'password' },
    { key: 'hint', label: 'Password hint', value: me.hint, maxlength: 100 },
  ], async ({ current, next, confirm, hint }) => {
    if (next !== confirm) throw new Error('The passwords don’t match.');
    if (!next && !me.hasPassword) throw new Error('Enter a password.');
    if (!next && !me.hasPin && !(await confirmDialog('Remove your password?', 'Anyone using this device will be able to open your account.', { ok: 'Remove' }))) throw new Error('Kept your password.');
    await kernel.accounts.setPassword(me.id, { current, next, hint });
    changed();
  });

  const changePin = (me) => formDialog(me.hasPin ? 'Change your PIN' : 'Set up a PIN', [
    ...(me.hasPassword ? [{ key: 'password', label: 'Confirm it’s you: password', type: 'password' }] : []),
    { key: 'pin', label: 'New PIN', type: 'password', numeric: true, maxlength: 12, hint: '4 to 12 digits' },
    { key: 'confirm', label: 'Confirm PIN', type: 'password', numeric: true, maxlength: 12 },
  ], async ({ password, pin, confirm }) => {
    if (me.hasPassword) {
      const r = await kernel.accounts.verify(me.id, { password });
      if (!r.ok) throw new Error(r.lockedFor ? 'Too many attempts. Wait a moment and try again.' : 'The password is incorrect.');
    }
    if (pin !== confirm) throw new Error('The PINs don’t match.');
    await kernel.accounts.setPin(me.id, pin);
    changed();
  });

  const removePin = async (me) => {
    if (await confirmDialog('Remove your PIN?', me.hasPassword ? 'You’ll sign in with your password.' : 'You’ll sign in without a PIN or password.', { ok: 'Remove' })) {
      await kernel.accounts.setPin(me.id, '');
      changed();
    }
  };

  const addAccount = () => formDialog('Add an account', [
    { key: 'name', label: 'Name', maxlength: 32 },
    { key: 'password', label: 'Password (optional)', type: 'password' },
    { key: 'confirm', label: 'Confirm password', type: 'password' },
    { key: 'hint', label: 'Password hint', maxlength: 100 },
    { key: 'type', label: 'Account type', type: 'select', value: 'standard', options: [['standard', 'Standard user'], ['admin', 'Administrator']] },
  ], async ({ name, password, confirm, hint, type }) => {
    if (password !== confirm) throw new Error('The passwords don’t match.');
    await kernel.accounts.create({ name, password, hint: password ? hint : '', type });
    changed();
  }, { ok: 'Add', intro: 'The new person gets their own files, apps and settings.' });

  const resetPassword = (other) => formDialog(`Reset ${other.name}’s password`, [
    { key: 'next', label: 'New password', type: 'password', hint: 'Leave empty to remove the password.' },
    { key: 'confirm', label: 'Confirm password', type: 'password' },
  ], async ({ next, confirm }) => {
    if (next !== confirm) throw new Error('The passwords don’t match.');
    await kernel.accounts.setPassword(other.id, { next, asAdmin: true });
    await kernel.accounts.setPin(other.id, '');
    changed();
  }, { ok: 'Reset', intro: `${other.name}’s PIN will also be removed. Tell them the new password.` });

  const changeType = (other) => formDialog(`Change account type`, [
    { key: 'type', label: other.name, type: 'select', value: other.type, options: [['standard', 'Standard user'], ['admin', 'Administrator']] },
  ], async ({ type }) => { await kernel.accounts.setType(other.id, type); changed(); }, { ok: 'OK' });

  const removeAccount = async (other) => {
    if (kernel.sessions.has(other.id)) { await alertDialog('Signed in', `${other.name} is signed in. They need to sign out before their account can be removed.`); return; }
    const choice = await dialog({
      title: `Remove ${other.name}?`,
      body: h('p', `Removing this account deletes ${other.name}’s settings. Their files in ${other.home} can be deleted too, or kept for an administrator to recover.`),
      cancelValue: null,
      buttons: [{ label: 'Delete account and files', value: 'all', danger: true }, { label: 'Keep files', value: 'keep' }, { label: 'Cancel', value: null }],
    });
    if (!choice) return;
    try { await kernel.accounts.remove(other.id, { deleteFiles: choice === 'all' }); changed(); }
    catch (e) { alertDialog('Couldn’t remove the account', e.message); }
  };

  function render() {
    const me = kernel.accounts.get(uid);
    if (!me) { mount(container, h('p', 'This account no longer exists.')); return; }
    const isAdmin = me.type === 'admin';
    const typeLabel = { admin: 'Administrator', standard: 'Standard user', guest: 'Guest' }[me.type];
    const picBtn = h('button.btn', { type: 'button', onclick: (e) => changePicture(e.currentTarget, me), disabled: me.isGuest }, icon('image', { size: 16 }), 'Change picture');

    const rows = [
      h('div.me', avatar(me, 80), h('div', h('h2', me.name), h('p', `${typeLabel} · ${me.home}`))),
    ];
    if (me.isGuest) {
      rows.push(h('div.row', icon('info'), h('div.grow', h('div.t', 'You’re using the guest account'), h('div.d', 'Everything you do here is erased when you sign out.'))));
      mount(container, rows);
      return;
    }
    rows.push(
      h('div.row', icon('user'), h('div.grow', h('div.t', 'Your picture and name')), picBtn, h('button.btn', { type: 'button', onclick: () => rename(me) }, 'Rename')),
      h('div.section-title', 'Sign-in options'),
      h('div.row', icon('key'), h('div.grow', h('div.t', 'Password'), h('div.d', me.hasPassword ? 'Your account is protected with a password' : 'No password — anyone can open your account')),
        h('button.btn', { type: 'button', onclick: () => changePassword(me) }, me.hasPassword ? 'Change' : 'Add')),
      h('div.row', icon('keypad'), h('div.grow', h('div.t', 'PIN'), h('div.d', me.hasPin ? 'Sign in quickly with a PIN' : 'Set up a 4–12 digit PIN')),
        me.hasPin ? h('button.btn', { type: 'button', onclick: () => removePin(me) }, 'Remove') : null,
        h('button.btn', { type: 'button', onclick: () => changePin(me) }, me.hasPin ? 'Change' : 'Set up')),
    );
    if (me.hasPassword && me.hasPin) {
      const s = kernel.settings.forUser(uid);
      rows.push(h('div.row', icon('lock'), h('div.grow', h('div.t', 'Sign in with')),
        h('select.input', { style: { width: '140px' }, 'aria-label': 'Default sign-in option', onchange: (e) => s.set('lock.signInWith', e.target.value) },
          h('option', { value: 'pin', selected: s.get('lock.signInWith') === 'pin' }, 'PIN'), h('option', { value: 'password', selected: s.get('lock.signInWith') === 'password' }, 'Password'))));
    }

    rows.push(h('div.section-title', 'Other people'));
    if (isAdmin) {
      for (const o of kernel.accounts.list({ includeGuest: false }).filter((a) => a.id !== uid)) {
        rows.push(h('div.row', avatar(o, 36), h('div.grow', h('div.t', o.name), h('div.d', `${o.type === 'admin' ? 'Administrator' : 'Standard user'}${kernel.sessions.has(o.id) ? ' · Signed in' : ''}`)),
          h('button.btn.icon', { type: 'button', title: 'More', 'aria-label': `Options for ${o.name}`, onclick: (e) => showMenu([
            { label: 'Change account type', icon: 'admin', onSelect: () => changeType(o) },
            { label: 'Reset password', icon: 'key', onSelect: () => resetPassword(o) },
            { separator: true },
            { label: 'Remove', icon: 'trash', onSelect: () => removeAccount(o) },
          ], { anchor: e.currentTarget }) }, icon('chevronDown', { size: 16 }))));
      }
      rows.push(h('div.row', icon('users'), h('div.grow', h('div.t', 'Add someone else to this device')), h('button.btn.primary', { type: 'button', onclick: addAccount }, icon('plus', { size: 16 }), 'Add account')));
      const guest = h('input', { type: 'checkbox', checked: kernel.settings.get('system.guestEnabled'), 'aria-label': 'Guest account',
        onchange: async (e) => {
          if (!e.target.checked && kernel.sessions.has('guest')) { e.target.checked = true; await alertDialog('Guest is signed in', 'Sign the guest out before turning the guest account off.'); return; }
          kernel.settings.set('system.guestEnabled', e.target.checked); changed();
        } });
      rows.push(h('div.row', icon('user'), h('div.grow', h('div.t', 'Guest account'), h('div.d', 'Lets someone use this device without an account. Their files are erased when they sign out.')), h('label.toggle', guest, h('span'))));
    } else {
      rows.push(h('div.row', icon('info'), h('div.grow', h('div.t', 'Only administrators can add, change or remove accounts.'))));
    }
    mount(container, rows);
  }

  render();
  return kernel.bus.on('accounts:changed', render);
}
