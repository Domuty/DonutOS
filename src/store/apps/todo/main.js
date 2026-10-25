// To Do — lists, My Day, Important, due dates, reminders, steps and notes.
import { h, mount, css, ui } from '@donut/sdk';

css(`
.td { height: 100%; display: grid; grid-template-columns: 230px 1fr; }
.td.with-detail { grid-template-columns: 230px 1fr 300px; }
.td-side { padding: 10px; border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: 2px; background: var(--surface-2); overflow: auto; }
.td-nav { display: flex; align-items: center; gap: 10px; border: 0; background: none; padding: 8px 10px; border-radius: var(--radius-s); text-align: left; }
.td-nav:hover { background: var(--hover); } .td-nav[aria-current] { background: var(--accent-soft); font-weight: 600; }
.td-nav span { flex: 1; } .td-nav small { color: var(--text-2); }
.td-main { display: flex; flex-direction: column; min-width: 0; }
.td-head { padding: 18px 22px 8px; } .td-head h1 { margin: 0; } .td-head small { color: var(--text-2); }
.td-list { flex: 1; overflow: auto; padding: 4px 16px; display: grid; gap: 4px; align-content: start; }
.td-task { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: var(--radius); background: var(--surface-2); border: 1px solid transparent; }
.td-task:hover { background: var(--hover); } .td-task.sel { border-color: var(--accent); }
.td-task.done .td-title { text-decoration: line-through; color: var(--text-3); }
.td-check { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--text-2); background: none; padding: 0; flex: none; display: grid; place-items: center; font-size: 11px; }
.td-task.done .td-check { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
.td-title { flex: 1; min-width: 0; } .td-meta { font-size: 12px; color: var(--text-2); }
.td-meta.late { color: var(--danger); }
.td-star { border: 0; background: none; font-size: 17px; color: var(--text-3); padding: 2px; } .td-star.on { color: #f5b400; }
.td-add { padding: 10px 16px 16px; }
.td-detail { border-left: 1px solid var(--border); padding: 14px; overflow: auto; display: grid; gap: 10px; align-content: start; background: var(--surface-2); }
.td-step { display: flex; align-items: center; gap: 8px; }
.td-section { font-size: 12px; color: var(--text-2); padding: 10px 4px 2px; }
`);

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => new Date().toISOString().slice(0, 10);

export default function main(app) {
  let lists = app.storage.get('lists', [{ id: 'tasks', name: 'Tasks' }]);
  let tasks = app.storage.get('tasks', []);
  let view = app.storage.get('view', 'myday');
  let selected = null;
  let showDone = app.storage.get('showDone', true);

  const save = () => { app.storage.set('tasks', tasks); app.storage.set('lists', lists); };
  const root = h('div.td');
  mount(app.root, root);

  const VIEWS = { myday: ['☀️', 'My Day'], important: ['⭐', 'Important'], planned: ['📅', 'Planned'], all: ['∞', 'All'] };
  const inView = (t) => (view === 'myday' ? t.myDay === today() : view === 'important' ? t.important : view === 'planned' ? !!t.due : view === 'all' ? true : t.list === view);
  const due = (t) => {
    if (!t.due) return null;
    const d = new Date(`${t.due}T00:00`), diff = Math.round((d - new Date(`${today()}T00:00`)) / 86400000);
    return { text: diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }), late: diff < 0 && !t.done };
  };

  function render() {
    root.classList.toggle('with-detail', !!selected);
    const count = (fn) => tasks.filter((t) => !t.done && fn(t)).length;
    const side = h('aside.td-side',
      Object.entries(VIEWS).map(([id, [ic, label]]) => h('button.td-nav', { type: 'button', 'aria-current': view === id ? 'true' : null, onclick: () => go(id) }, ic, h('span', label),
        h('small', String(count((t) => (id === 'myday' ? t.myDay === today() : id === 'important' ? t.important : id === 'planned' ? !!t.due : true)) || '')))),
      h('hr'),
      lists.map((l) => h('button.td-nav', { type: 'button', 'aria-current': view === l.id ? 'true' : null, onclick: () => go(l.id),
        oncontextmenu: (e) => { e.preventDefault(); listMenu(l, e); } }, '☰', h('span', l.name), h('small', String(count((t) => t.list === l.id) || '')))),
      h('button.td-nav', { type: 'button', onclick: newList }, '＋', h('span', 'New list')));
    const listName = VIEWS[view]?.[1] || lists.find((l) => l.id === view)?.name || 'Tasks';
    const shown = tasks.filter(inView).sort((a, b) => (a.done - b.done) || ((b.important ? 1 : 0) - (a.important ? 1 : 0)) || (a.due || '9').localeCompare(b.due || '9') || a.created - b.created);
    const open = shown.filter((t) => !t.done), done = shown.filter((t) => t.done);
    const input = h('input.input', { placeholder: 'Add a task', 'aria-label': 'Add a task', onkeydown: (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      const t = { id: uid(), title: input.value.trim(), done: false, created: Date.now(), list: lists.some((l) => l.id === view) ? view : 'tasks', important: view === 'important', myDay: view === 'myday' ? today() : null, due: view === 'planned' ? today() : null, steps: [], notes: '', remind: null };
      tasks = [...tasks, t]; save(); input.value = ''; render(); setTimeout(() => root.querySelector('.td-add input')?.focus());
    } });
    const main = h('main.td-main',
      h('div.td-head', h('div.row', h('h1.grow', listName), view !== 'all' && !VIEWS[view] ? null : null,
        h('button.btn.subtle', { type: 'button', onclick: () => { showDone = !showDone; app.storage.set('showDone', showDone); render(); } }, showDone ? 'Hide completed' : 'Show completed')),
      h('small', view === 'myday' ? new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : `${open.length} to do`)),
      h('div.td-list', open.map(taskRow), done.length && showDone ? [h('div.td-section', `Completed (${done.length})`), done.map(taskRow)] : null,
        !shown.length ? h('div.empty', view === 'myday' ? 'Focus on your day. Add a task below.' : 'Nothing here yet.') : null),
      h('div.td-add', input));
    mount(root, side, main, selected ? detail(tasks.find((t) => t.id === selected)) : null);
  }

  function taskRow(t) {
    const d = due(t);
    return h('div.td-task', { class: [t.done && 'done', selected === t.id && 'sel'], onclick: () => { selected = t.id; render(); } },
      h('button.td-check', { type: 'button', 'aria-label': t.done ? 'Mark as not done' : 'Mark as done', onclick: (e) => { e.stopPropagation(); update(t.id, { done: !t.done, doneAt: Date.now() }); } }, t.done ? '✓' : ''),
      h('div.td-title', h('div', t.title), h('div.td-meta', { class: d?.late && 'late' }, [d && `📅 ${d.text}`, t.steps.length && `${t.steps.filter((s) => s.done).length} of ${t.steps.length}`, t.remind && `⏰ ${new Date(t.remind).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`, t.notes && '📝', view !== t.list && lists.find((l) => l.id === t.list)?.name].filter(Boolean).join('  ·  '))),
      h('button.td-star', { type: 'button', class: t.important && 'on', 'aria-label': t.important ? 'Remove importance' : 'Mark as important', onclick: (e) => { e.stopPropagation(); update(t.id, { important: !t.important }); } }, t.important ? '★' : '☆'));
  }

  function detail(t) {
    if (!t) { selected = null; return null; }
    const title = h('input.input', { value: t.title, 'aria-label': 'Task', onchange: (e) => update(t.id, { title: e.target.value.trim() || t.title }) });
    const step = h('input.input', { placeholder: 'Add a step', 'aria-label': 'Add a step', onkeydown: (e) => { if (e.key === 'Enter' && step.value.trim()) { update(t.id, { steps: [...t.steps, { id: uid(), text: step.value.trim(), done: false }] }); } } });
    const pad = (n) => String(n).padStart(2, '0');
    const local = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    return h('aside.td-detail',
      h('div.row', h('button.td-check', { type: 'button', onclick: () => update(t.id, { done: !t.done }) }, t.done ? '✓' : ''), title),
      t.steps.map((s) => h('div.td-step', h('input', { type: 'checkbox', checked: s.done, 'aria-label': s.text, onchange: () => update(t.id, { steps: t.steps.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) }) }), h('span.grow', s.text),
        h('button.btn.subtle.icon', { type: 'button', 'aria-label': 'Remove step', onclick: () => update(t.id, { steps: t.steps.filter((x) => x.id !== s.id) }) }, '✕'))),
      step,
      h('button.btn', { type: 'button', onclick: () => update(t.id, { myDay: t.myDay === today() ? null : today() }) }, t.myDay === today() ? '☀️ Remove from My Day' : '☀️ Add to My Day'),
      h('label.field', h('label', 'Due date'), h('input.input', { type: 'date', value: t.due || '', onchange: (e) => update(t.id, { due: e.target.value || null }) })),
      h('label.field', h('label', 'Remind me'), h('input.input', { type: 'datetime-local', value: t.remind ? local(t.remind) : '', onchange: (e) => update(t.id, { remind: e.target.value ? new Date(e.target.value).getTime() : null, reminded: false }) })),
      h('label.field', h('label', 'List'), h('select.input', { onchange: (e) => update(t.id, { list: e.target.value }) }, lists.map((l) => h('option', { value: l.id, selected: l.id === t.list }, l.name)))),
      h('label.field', h('label', 'Notes'), h('textarea.input', { rows: 5, onchange: (e) => update(t.id, { notes: e.target.value }) }, t.notes)),
      h('small.muted', `Created ${new Date(t.created).toLocaleString()}`),
      h('div.row', h('button.btn.subtle', { type: 'button', onclick: () => { selected = null; render(); } }, 'Close'), h('div.grow'),
        h('button.btn.danger', { type: 'button', onclick: async () => { if (await ui.confirm('Delete task?', `“${t.title}” will be deleted.`, { ok: 'Delete', danger: true })) { tasks = tasks.filter((x) => x.id !== t.id); selected = null; save(); render(); } } }, 'Delete')));
  }

  function update(id, patch) { tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)); save(); render(); }
  function go(v) { view = v; selected = null; app.storage.set('view', v); render(); }
  async function newList() {
    const name = await ui.prompt('New list', { label: 'List name', value: 'Untitled list' });
    if (!name?.trim()) return;
    const l = { id: uid(), name: name.trim() };
    lists = [...lists, l]; save(); go(l.id);
  }
  async function listMenu(l, e) {
    const choice = await ui.menu([{ id: 'rename', label: 'Rename list' }, ...(l.id === 'tasks' ? [] : [{ id: 'delete', label: 'Delete list', danger: true }])], e);
    if (choice === 'rename') { const n = await ui.prompt('Rename list', { value: l.name }); if (n?.trim()) { lists = lists.map((x) => (x.id === l.id ? { ...x, name: n.trim() } : x)); save(); render(); } }
    if (choice === 'delete' && (await ui.confirm(`Delete “${l.name}”?`, 'Its tasks will be deleted too.', { ok: 'Delete', danger: true }))) { tasks = tasks.filter((t) => t.list !== l.id); lists = lists.filter((x) => x.id !== l.id); save(); go('myday'); }
  }

  // Reminders (while To Do is open).
  setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const t of tasks) if (t.remind && !t.reminded && !t.done && t.remind <= now) { t.reminded = true; changed = true; app.notify({ title: 'Reminder', body: t.title, actions: [{ id: 'done', label: 'Mark as done' }], data: { id: t.id } }); }
    if (changed) { save(); render(); }
  }, 15000);
  app.onNotification(({ actionId, data }) => { if (actionId === 'done' && data?.id) update(data.id, { done: true }); });
  addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); app.root.querySelector('.td-add input')?.focus(); } });
  render();
}
