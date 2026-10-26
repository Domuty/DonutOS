// First-run setup: name the device, create the first (administrator) account with an
// optional password and PIN, and choose a look. Everything chosen here is saved.

import { h, mount } from '../ui/h.js';
import { BUILTIN_WALLPAPERS, builtinUrl, paintWallpaper } from './wallpaper.js';
import { applyTheme } from './theme.js';
import { spinner } from './boot-screen.js';
import { icon } from '../ui/icons.js';
import { openAccessibilityMenu } from './a11y/menu.js';

export const ACCENTS = ['#e8618c', '#f08a4b', '#e6b422', '#4cb782', '#2fa8c9', '#5b7cf0', '#9466e8', '#d45ac8', '#8a8a8a'];

export async function showOobe(layer, { kernel, onDone }) {
  const bg = h('div.oobe-bg');
  const steps = h('div.oobe-steps', { 'aria-hidden': 'true' });
  const page = h('div.oobe-page');
  const foot = h('div.oobe-foot');
  const main = h('div.oobe-main', steps, page, foot);
  const card = h('div.oobe-card', { role: 'dialog', 'aria-label': 'Set up DonutOS' },
    h('div.oobe-art', h('img', { src: 'assets/brand/logo.svg', alt: '' })), main);
  // Narrator, Magnifier, the on-screen keyboard… are available during setup too.
  const tools = h('div.corner-tools', h('button', { type: 'button', title: 'Accessibility', 'aria-label': 'Accessibility', 'aria-haspopup': 'menu', onclick: (e) => openAccessibilityMenu(kernel, e.currentTarget) }, icon('accessibility')));
  const el = h('div.screen.oobe', bg, card, tools);
  layer.append(el);
  paintWallpaper(bg, 'builtin:glaze', kernel.fs);

  const data = {
    device: kernel.settings.get('system.deviceName'),
    name: '', password: '', password2: '', hint: '', pin: '', pin2: '',
    theme: 'dark', accent: ACCENTS[0], wallpaper: 'builtin:glaze',
  };
  // Live preview of the chosen look on the setup screen itself.
  const look = () => ({ 'appearance.theme': data.theme, 'appearance.accent': data.accent, 'appearance.transparency': true, 'appearance.animations': true, 'a11y.reduceMotion': false, 'appearance.font': 'system', 'appearance.textScale': 100 });
  // Anything else (the sign-in screen's accessibility choices) comes from the real settings.
  const preview = () => applyTheme({ get: (k) => (k in look() ? look()[k] : kernel.settings.get(k)) });
  preview();
  const stopA11yWatch = kernel.settings.watch('a11y.signin', () => setTimeout(preview));

  const field = (label, input, hint) => h('div.field', h('label', { for: input.id }, label), input, hint ? h('div.hint', hint) : null);
  const err = h('div.error-text', { role: 'alert' });
  let id = 0;
  const inp = (props) => h('input.input', { id: `oobe-${++id}`, ...props });

  const STEPS = [
    {
      title: 'Welcome to DonutOS',
      lead: 'Let’s get a few things set up. It only takes a minute.',
      body: () => {
        const device = inp({ value: data.device, maxlength: 15, oninput: (e) => { data.device = e.target.value; } });
        return [field('Name this device', device, 'Letters, numbers and hyphens, up to 15 characters. Other people see this name.')];
      },
      validate: () => (/^[A-Za-z0-9-]{1,15}$/.test(data.device.trim()) ? null : 'Use 1–15 letters, numbers or hyphens.'),
    },
    {
      title: 'Who’s going to use this device?',
      lead: 'This will be the first account. It can manage the device and add other people later.',
      body: () => [field('Your name', inp({ value: data.name, maxlength: 32, autocomplete: 'name', oninput: (e) => { data.name = e.target.value; } }))],
      validate: () => {
        const n = data.name.trim();
        if (!n) return 'Enter a name.';
        if (/[\\/:*?"<>|]/.test(n)) return 'A name can’t contain \\ / : * ? " < > |';
        if (['guest', 'public', 'system', 'administrator', 'default'].includes(n.toLowerCase())) return 'That name is reserved. Choose another.';
        return null;
      },
    },
    {
      title: 'Create a password',
      lead: 'A password keeps other people out of your account. You can skip this and add one later.',
      body: () => [
        field('Password', inp({ type: 'password', value: data.password, autocomplete: 'new-password', oninput: (e) => { data.password = e.target.value; } })),
        field('Confirm password', inp({ type: 'password', value: data.password2, autocomplete: 'new-password', oninput: (e) => { data.password2 = e.target.value; } })),
        field('Password hint', inp({ value: data.hint, maxlength: 100, oninput: (e) => { data.hint = e.target.value; } }), 'Shown if you forget your password. Don’t include the password itself.'),
      ],
      skippable: () => { data.password = data.password2 = data.hint = ''; },
      validate: () => {
        if (!data.password) return 'Enter a password, or choose Skip.';
        if (data.password !== data.password2) return 'The passwords don’t match.';
        if (data.hint && data.hint.toLowerCase().includes(data.password.toLowerCase())) return 'The hint can’t contain the password.';
        return null;
      },
    },
    {
      title: 'Create a PIN',
      lead: 'A PIN is a quick way to sign in. Use 4 to 12 digits.',
      body: () => [
        field('PIN', inp({ type: 'password', inputmode: 'numeric', value: data.pin, maxlength: 12, oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, ''); data.pin = e.target.value; } })),
        field('Confirm PIN', inp({ type: 'password', inputmode: 'numeric', value: data.pin2, maxlength: 12, oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, ''); data.pin2 = e.target.value; } })),
      ],
      skippable: () => { data.pin = data.pin2 = ''; },
      validate: () => {
        if (!/^\d{4,12}$/.test(data.pin)) return 'A PIN must be 4 to 12 digits, or choose Skip.';
        if (data.pin !== data.pin2) return 'The PINs don’t match.';
        return null;
      },
    },
    {
      title: 'Make it yours',
      lead: 'Pick a look. You can change all of this later in Personalize.',
      body: () => {
        const themes = h('div.choices', { role: 'radiogroup', 'aria-label': 'Theme' }, [['dark', 'Dark', '#2b2431'], ['light', 'Light', '#ffffff']].map(([v, label, pv]) =>
          h('button.choice', { type: 'button', role: 'radio', 'aria-checked': String(data.theme === v), 'aria-pressed': String(data.theme === v), onclick: () => { data.theme = v; if (v === 'light' && data.wallpaper === 'builtin:glaze') data.wallpaper = 'builtin:mint'; if (v === 'dark' && data.wallpaper === 'builtin:mint') data.wallpaper = 'builtin:glaze'; preview(); render(); } },
            h('div.theme-choice', h('div.preview', { style: { backgroundImage: `url(${builtinUrl(v === 'dark' ? 'glaze' : 'mint', true)})`, '--pv-bg': pv } }), label))));
        const swatches = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Accent colour' }, ACCENTS.map((c) =>
          h('button.swatch', { type: 'button', role: 'radio', 'aria-label': c, 'aria-checked': String(data.accent === c), 'aria-pressed': String(data.accent === c), style: { background: c }, onclick: () => { data.accent = c; preview(); render(); } })));
        const walls = h('div.wp-grid', { role: 'radiogroup', 'aria-label': 'Wallpaper' }, BUILTIN_WALLPAPERS.map((w) =>
          h('button.choice', { type: 'button', role: 'radio', title: w.name, 'aria-label': w.name, 'aria-checked': String(data.wallpaper === w.id), 'aria-pressed': String(data.wallpaper === w.id), onclick: () => { data.wallpaper = w.id; paintWallpaper(bg, w.id, kernel.fs); render(); } },
            h('img', { src: builtinUrl(w.id.slice(8), true), alt: '' }))));
        return [h('div.label', 'Theme'), themes, h('div.label', 'Accent colour'), swatches, h('div.label', 'Wallpaper'), walls];
      },
    },
  ];

  let index = 0;
  let direction = 'fwd';

  function render() {
    const s = STEPS[index];
    mount(steps, STEPS.map((_, i) => h('i', { class: i <= index && 'on' })));
    page.className = `oobe-page${direction === 'back' ? ' back' : ''}`;
    err.textContent = '';
    mount(page, h('h1', s.title), h('p.oobe-lead', s.lead), s.body(), err);
    mount(foot,
      index > 0 ? h('button.btn', { type: 'button', onclick: back }, 'Back') : h('span'),
      h('div', { style: { display: 'flex', gap: '8px' } },
        s.skippable ? h('button.btn', { type: 'button', onclick: () => { s.skippable(); next(true); } }, 'Skip') : null,
        h('button.btn.primary', { type: 'button', onclick: () => next(false) }, index === STEPS.length - 1 ? 'Finish' : 'Next')));
  }

  function back() { direction = 'back'; index--; render(); }
  function next(skipped) {
    const s = STEPS[index];
    const problem = !skipped && s.validate?.();
    if (problem) { err.textContent = problem; return; }
    direction = 'fwd';
    if (index === STEPS.length - 1) { finish(); return; }
    index++;
    render();
    page.querySelector('input')?.focus();
  }
  // Enter moves on; the current page's buttons are re-rendered so delegate on the card.
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); next(false); }
  });

  async function finish() {
    mount(page, h('h1', 'Getting things ready for you'), h('p.oobe-lead', 'Creating your account and folders…'), spinner(), err);
    mount(foot);
    mount(steps);
    const t0 = performance.now();
    try {
      kernel.settings.set('system.deviceName', data.device.trim());
      const account = await kernel.accounts.create({ name: data.name, password: data.password, pin: data.pin, hint: data.hint });
      // Accessibility features turned on during setup stay on for the new account.
      const a11y = Object.fromEntries(Object.entries(kernel.settings.get('a11y.signin')).map(([k, v]) => [`a11y.${k}`, v]));
      await kernel.settings.pokeUser(account.id, {
        ...a11y,
        'appearance.theme': data.theme, 'appearance.accent': data.accent,
        'appearance.wallpaper': data.wallpaper, 'appearance.lockWallpaper': data.wallpaper,
        'lock.signInWith': data.pin ? 'pin' : 'password',
      });
      kernel.settings.set('system.firstRunDone', true);
      const wait = 1600 - (performance.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      stopA11yWatch();
      onDone(account);
    } catch (e) {
      err.textContent = e.message;
      index = 1;
      render();
      err.textContent = e.message;
    }
  }

  render();
  page.querySelector('input')?.focus();
  return { el, destroy: () => el.remove() };
}
