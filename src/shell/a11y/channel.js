// Messages between accessibility features and the places that feed them, inside DonutOS's
// page: sandboxed app frames report pointer moves and what Narrator should say, and the
// on-screen keyboard hands keys to a frame. (Store apps' ctx has no kernel bus.)
//   'pointer' { x, y } · 'say' { text, interrupt } · 'key' { frame, key, code, mods }

const handlers = new Map();

export const a11yChannel = {
  on(name, fn) {
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name).add(fn);
    return () => handlers.get(name)?.delete(fn);
  },
  emit(name, data) { for (const fn of handlers.get(name) || []) { try { fn(data); } catch (err) { console.error(err); } } },
};
