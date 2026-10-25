// Sign-in screen: pick an account, enter its password or PIN, recover a forgotten one.

import { h, mount } from '../ui/h.js';
import { icon } from '../ui/icons.js';
import { avatar } from '../ui/avatar.js';
import { showMenu } from '../ui/menu.js';
import { dialog, confirmDialog } from '../ui/dialog.js';
import { paintWallpaper } from './wallpaper.js';
import { spinner } from './boot-screen.js';
import { mountStatusIcons } from './status-icons.js';
import { prefsFor, lockWallpaperOf } from './prefs.js';
import { playSound } from './sounds.js';

/**
 * opts: { kernel, preselect (uid), initialKey, lockedUid (the session that was locked),
 *         onSignedIn(account), onCancel(), power: { sleep, shutdown, restart } }
 */
export async function showSignIn(layer, opts) {
  const { kernel } = opts;
  const bg = h('div.signin-bg');
  const center = h('div.signin-center');
  const users = h('nav.signin-users', { 'aria-label': 'Accounts' });
  const tools = h('div.corner-tools');
  const el = h('div.screen.signin.entering', { role: 'dialog', 'aria-label': 'Sign in' }, bg, center, users, tools);
  layer.append(el);

  let accounts = kernel.accounts.list();
  let selected = accounts.find((a) => a.id === opts.preselect)
    || accounts.find((a) => a.id === kernel.settings.get('system.lastUser'))
    || accounts[0];
  let mode = 'password';
  let pendingKey = opts.initialKey || '';
  let lockTimer = null;
  let destroyed = false;

  const statusHost = h('span', { style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '0 8px', color: '#fff' } });
  const stopStatus2 = mountStatusIcons(statusHost, kernel.platform);
  tools.append(statusHost, h('button', { title: 'Power', 'aria-label': 'Power', onclick: (e) => openPower(e.currentTarget) }, icon('power')));

  function openPower(anchor) {
    showMenu([
      { label: 'Sleep', icon: 'sleep', onSelect: () => opts.power.sleep() },
      { label: 'Shut down', icon: 'power', onSelect: () => opts.power.shutdown() },
      { label: 'Restart', icon: 'restart', onSelect: () => opts.power.restart() },
    ], { anchor, placement: 'above' });
  }

  const onKey = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.dlg, .menu')) { e.preventDefault(); opts.onCancel?.(); }
  };
  document.addEventListener('keydown', onKey);

  async function select(account, { repaint = true } = {}) {
    selected = account;
    clearInterval(lockTimer);
    const prefs = await prefsFor(kernel, account.id);
    mode = account.hasPin && (prefs.get('lock.signInWith') === 'pin' || !account.hasPassword) ? 'pin' : 'password';
    if (repaint) paintWallpaper(bg, lockWallpaperOf(prefs, kernel), kernel.fs, 'fill');
    renderUsers();
    renderCenter();
  }

  function renderUsers() {
    if (accounts.length < 2) { users.hidden = true; return; }
    users.hidden = false;
    mount(users, accounts.map((a) => h('button', {
      'aria-current': a.id === selected.id ? 'true' : 'false',
      onclick: () => { if (a.id !== selected.id) select(a); },
    }, avatar(a, 32), h('span', a.name, kernel.sessions.has(a.id) ? h('small', a.id === opts.lockedUid ? 'Locked' : 'Signed in') : null))));
  }

  function renderCenter(message = '') {
    const a = selected;
    const signedIn = kernel.sessions.has(a.id);
    const msg = h('div.signin-msg', { role: 'status', 'aria-live': 'polite' }, message);
    const form = h('form.signin-form', { onsubmit: (e) => { e.preventDefault(); submit(); } });
    let input = null;

    const lockedFor = kernel.accounts.lockedFor(a.id);
    if (lockedFor > 0) {
      form.append(lockoutView());
    } else if (a.isGuest || (!a.hasPassword && !a.hasPin)) {
      form.append(h('button.btn.primary.block', { type: 'submit', autofocus: true }, signedIn ? 'Switch to this account' : 'Sign in'));
    } else {
      const isPin = mode === 'pin';
      input = h('input', {
        type: 'password', autocomplete: isPin ? 'off' : 'current-password', name: isPin ? 'pin' : 'password',
        placeholder: isPin ? 'PIN' : 'Password', 'aria-label': isPin ? 'PIN' : 'Password',
        inputmode: isPin ? 'numeric' : 'text', spellcheck: false, value: pendingKey && (!isPin || /\d/.test(pendingKey)) ? pendingKey : '',
      });
      pendingKey = '';
      if (isPin) input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 12); });
      const reveal = h('button', { type: 'button', title: 'Show', 'aria-label': `Show ${isPin ? 'PIN' : 'password'}`, onpointerdown: () => { input.type = 'text'; }, onpointerup: () => { input.type = 'password'; input.focus(); }, onpointerleave: () => { input.type = 'password'; } }, icon('eye', { size: 18 }));
      form.append(h('div.cred', input, reveal, h('button.go', { type: 'submit', title: 'Sign in', 'aria-label': 'Sign in' }, icon('arrowRight', { size: 18 }))));
    }

    const links = h('div.signin-links');
    if (!a.isGuest && (a.hasPassword || a.hasPin) && lockedFor <= 0) {
      links.append(h('button', { type: 'button', onclick: () => forgot(links) }, mode === 'pin' ? 'I forgot my PIN' : 'I forgot my password'));
      if (a.hasPassword && a.hasPin) {
        links.append(h('div.signin-options', { role: 'group', 'aria-label': 'Sign-in options' },
          h('button', { type: 'button', title: 'PIN', 'aria-label': 'Sign in with PIN', 'aria-pressed': String(mode === 'pin'), onclick: () => setMode('pin') }, icon('keypad', { size: 18 })),
          h('button', { type: 'button', title: 'Password', 'aria-label': 'Sign in with password', 'aria-pressed': String(mode === 'password'), onclick: () => setMode('password') }, icon('key', { size: 18 }))));
      }
    }

    mount(center,
      avatar(a, 176),
      h('div.signin-name', a.name),
      signedIn ? h('div.signin-sub', a.id === opts.lockedUid ? 'Locked' : 'Signed in') : null,
      form, msg, links);
    const focusTarget = input || form.querySelector('button');
    focusTarget?.focus();
    requestAnimationFrame(() => { if (focusTarget?.isConnected && !document.querySelector('.dlg')) focusTarget.focus(); });

    async function submit() {
      const value = input ? input.value : '';
      if (input && !value) return;
      mount(form, spinner('.busy-dots'));
      msg.textContent = '';
      let result;
      try {
        result = await kernel.accounts.verify(a.id, input ? (mode === 'pin' ? { pin: value } : { password: value }) : {});
      } catch (err) {
        renderCenter(err.message);
        return;
      }
      if (destroyed) return;
      if (result.ok) { opts.onSignedIn(a); return; }
      playSound('error', null);
      if (result.lockedFor > 0) { renderCenter(); return; }
      renderCenter(mode === 'pin' ? 'That PIN is incorrect. Try again.' : 'The password is incorrect. Try again.');
      const f = center.querySelector('.cred');
      f?.classList.add('shake');
      if (result.attemptsLeft <= 2) center.querySelector('.signin-msg').textContent += ` ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} left before a short wait.`;
    }
  }

  function setMode(m) { mode = m; renderCenter(); }

  function lockoutView() {
    const text = h('div.signin-hint.lockout');
    const tick = () => {
      const left = kernel.accounts.lockedFor(selected.id);
      if (left <= 0) { clearInterval(lockTimer); renderCenter(); return; }
      text.textContent = `Too many incorrect attempts. Try again in ${Math.ceil(left / 1000)} seconds.`;
    };
    tick();
    clearInterval(lockTimer);
    lockTimer = setInterval(tick, 500);
    return text;
  }

  function forgot(links) {
    const a = selected;
    const otherAdmins = accounts.filter((x) => x.type === 'admin' && x.id !== a.id);
    const box = h('div.signin-hint');
    if (mode === 'pin' && a.hasPassword) {
      box.append(h('div', 'You can sign in with your password instead.'), h('button.btn', { style: { marginTop: '8px' }, type: 'button', onclick: () => setMode('password') }, 'Use my password'));
    } else {
      if (a.hint) box.append(h('div', h('b', 'Password hint: '), a.hint));
      if (otherAdmins.length) box.append(h('div', { style: { marginTop: a.hint ? '8px' : 0 } }, `An administrator (${otherAdmins.map((x) => x.name).join(', ')}) can reset your password from Accounts.`));
      if (!otherAdmins.length || a.type === 'admin') {
        box.append(h('div', { style: { marginTop: '8px' } }, 'If you can’t remember it, you can erase this DonutOS and set it up again.'),
          h('button.btn', { style: { marginTop: '8px' }, type: 'button', onclick: resetDevice }, 'Reset DonutOS…'));
      }
    }
    links.replaceChildren(box);
  }

  async function resetDevice() {
    const input = h('input.input', { placeholder: 'ERASE', 'aria-label': 'Type ERASE to confirm' });
    const ok = await dialog({
      title: 'Reset DonutOS?',
      body: h('div', { style: { display: 'grid', gap: '12px' } },
        h('p', 'This permanently deletes every account, file, app and setting in this DonutOS, then starts first-time setup.'),
        h('p', 'Type ERASE to confirm.'), input),
      cancelValue: false,
      buttons: [{ label: 'Erase everything', value: true, danger: true, validate: () => input.value.trim() === 'ERASE' }, { label: 'Cancel', value: false }],
    });
    if (ok && (await confirmDialog('Last chance', 'Everything in DonutOS will be erased. This cannot be undone.', { ok: 'Erase', danger: true }))) {
      mount(center, spinner('.busy-dots'), h('div.signin-name', { style: { fontSize: '20px' } }, 'Resetting…'));
      await kernel.factoryReset();
    }
  }

  const offAccounts = kernel.bus.on('accounts:changed', () => {
    accounts = kernel.accounts.list();
    selected = accounts.find((a) => a.id === selected.id) || accounts[0];
    renderUsers();
  });

  await select(selected);

  return {
    el,
    destroy() {
      destroyed = true;
      clearInterval(lockTimer);
      document.removeEventListener('keydown', onKey);
      offAccounts();
      stopStatus2();
      el.remove();
    },
  };
}
