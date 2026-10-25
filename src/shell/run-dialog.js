// The Run dialog (Win+R): type an app, a file or folder path, or a web address.

import { h } from '../ui/h.js';
import { dialog } from '../ui/dialog.js';
import { launchApp, openPath } from './apps.js';
import * as P from '../core/path.js';

export async function runDialog(kernel, session) {
  const s = session.settings;
  const history = s.get('run.history');
  const list = h('datalist#run-history', history.map((v) => h('option', { value: v })));
  const input = h('input.input', { value: history[0] || '', list: 'run-history', 'aria-label': 'Open', autocomplete: 'off', spellcheck: false });
  const err = h('div.error-text', { role: 'alert' });
  const ok = await dialog({
    title: 'Run',
    width: 440,
    body: h('div', { style: { display: 'grid', gap: '12px' } },
      h('p', 'Type the name of an app, folder, document, or website, and DonutOS will open it for you.'),
      h('div.field', h('label', 'Open:'), input, list), err),
    cancelValue: false,
    buttons: [{ label: 'OK', value: true, primary: true, validate: async () => {
      const problem = await resolve(kernel, session, input.value.trim());
      err.textContent = problem || '';
      return !problem;
    } }, { label: 'Cancel', value: false }],
    onOpen: () => input.select(),
  });
  if (ok) s.set('run.history', [input.value.trim(), ...history.filter((x) => x !== input.value.trim())].slice(0, 12));
}

/** Opens the target; returns an error message when it can't be found. */
async function resolve(kernel, session, text) {
  if (!text) return 'Type something to open.';
  if (/^(https?:\/\/|www\.)/i.test(text)) {
    const url = text.startsWith('www.') ? `https://${text}` : text;
    if (kernel.registry.has('browser')) launchApp(kernel, 'browser', { url }); else kernel.platform.host.openExternal(url);
    return null;
  }
  const aliases = { cmd: 'terminal', shell: 'terminal', control: 'settings', 'ms-settings': 'settings', calc: 'calculator', mspaint: 'paint', taskmgr: 'taskmanager', snippingtool: 'snipping' };
  const lower = text.toLowerCase();
  const [first, ...rest] = lower.split(/\s+/);
  const settingsPage = /^settings:(\w+)$/.exec(lower);
  if (settingsPage) { launchApp(kernel, 'settings', { page: settingsPage[1] }); return null; }
  const app = kernel.registry.get(aliases[first] || first) || kernel.registry.list({ includeHidden: true }).find((a) => a.name.toLowerCase() === lower || a.id === lower);
  if (app) { launchApp(kernel, app.id, rest.length ? { argv: text.split(/\s+/).slice(1) } : {}); return null; }
  const home = session.user.home;
  const path = text.startsWith('~') ? P.join(home, text.slice(1)) : P.resolve(home, text);
  if (await kernel.fs.exists(path)) { openPath(kernel, path); return null; }
  return `DonutOS can’t find “${text}”. Make sure you typed the name correctly, and then try again.`;
}
