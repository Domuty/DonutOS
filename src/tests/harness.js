// A small test harness: test(name, fn), assertions, and a runner that renders results,
// exposes them to automation (window.__DONUT_TESTS__) and reports to Electron in --tests mode.

const tests = [];
export const test = (name, fn) => tests.push({ name, fn });

export class AssertionError extends Error {}
const fmt = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };

export const assert = {
  ok(v, msg = 'expected a truthy value') { if (!v) throw new AssertionError(msg); },
  equal(a, b, msg) { if (a !== b) throw new AssertionError(msg || `expected ${fmt(b)}, got ${fmt(a)}`); },
  deepEqual(a, b, msg) { if (fmt(a) !== fmt(b)) throw new AssertionError(msg || `expected ${fmt(b)}, got ${fmt(a)}`); },
  async rejects(promiseOrFn, code, msg) {
    try { await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn); }
    catch (err) {
      if (code && err.code !== code && err.name !== code) throw new AssertionError(msg || `expected error ${code}, got ${err.code || err.name}: ${err.message}`);
      return err;
    }
    throw new AssertionError(msg || `expected rejection${code ? ` with ${code}` : ''}`);
  },
  throws(fn, code) {
    try { fn(); } catch (err) {
      if (code && err.code !== code && err.name !== code) throw new AssertionError(`expected ${code}, got ${err.code || err.name}`);
      return err;
    }
    throw new AssertionError(`expected an exception${code ? ` ${code}` : ''}`);
  },
};

export async function run({ platform, teardown }) {
  const list = document.getElementById('results');
  const results = [];
  for (const t of tests) {
    const li = document.createElement('li');
    const t0 = performance.now();
    try {
      await Promise.race([t.fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 10 s')), 10_000))]);
      results.push({ name: t.name, ok: true });
      li.className = 'ok';
      li.innerHTML = `<span class="ms">${(performance.now() - t0).toFixed(0)} ms</span>`;
      li.prepend(t.name);
    } catch (err) {
      results.push({ name: t.name, ok: false, error: `${err.message}` });
      li.className = 'fail';
      li.textContent = t.name;
      const small = document.createElement('small');
      small.textContent = err.stack || err.message;
      li.append(small);
    }
    list.append(li);
  }
  try { await teardown?.(); } catch (err) { results.push({ name: 'teardown', ok: false, error: err.message }); }
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const summary = document.getElementById('summary');
  summary.textContent = `${passed} passed, ${failed} failed · ${platform}`;
  summary.style.color = failed ? 'var(--danger)' : 'var(--ok)';
  const report = { platform, passed, failed, tests: results };
  globalThis.__DONUT_TESTS__ = report;
  globalThis.donutNative?.reportTests?.(report);
  return report;
}
