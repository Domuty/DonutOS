// Prints a document through the host's print dialog (which also offers "Save as PDF"),
// using an invisible frame so only the document is printed, not the desktop.

export function printDocument({ title = 'Document', html, css = '' }) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', opacity: '0' });
    document.body.append(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
      body { font: 12pt/1.5 system-ui, sans-serif; margin: 0; color: #000; }
      @page { margin: 18mm; }
      ${css}</style></head><body>${html}</body></html>`);
    doc.close();
    const done = () => { setTimeout(() => frame.remove(), 500); resolve(); };
    const go = () => {
      frame.contentWindow.addEventListener('afterprint', done, { once: true });
      frame.contentWindow.focus();
      frame.contentWindow.print();
      // Some hosts don't fire afterprint; clean up anyway once the dialog returns.
      setTimeout(done, 60000);
    };
    const imgs = [...doc.images];
    if (!imgs.length) setTimeout(go, 50);
    else Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))).then(go);
  });
}

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
