// System sounds, synthesised with WebAudio (no audio files to ship).
// Volume follows Quick Settings; nothing plays when muted or sounds are off.

let ctx = null;
const audio = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());

function tone(ac, out, { f, t, d, type = 'sine', g = 0.25 }) {
  const o = ac.createOscillator(), v = ac.createGain();
  o.type = type; o.frequency.value = f;
  v.gain.setValueAtTime(0, ac.currentTime + t);
  v.gain.linearRampToValueAtTime(g, ac.currentTime + t + 0.02);
  v.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + d);
  o.connect(v).connect(out);
  o.start(ac.currentTime + t); o.stop(ac.currentTime + t + d + 0.05);
}

const SOUNDS = {
  startup: [{ f: 523.25, t: 0, d: 1.2 }, { f: 659.25, t: 0.12, d: 1.2 }, { f: 783.99, t: 0.24, d: 1.3 }, { f: 1046.5, t: 0.36, d: 1.6, g: 0.18 }],
  unlock: [{ f: 880, t: 0, d: 0.25, g: 0.15 }, { f: 1318.5, t: 0.07, d: 0.35, g: 0.12 }],
  notify: [{ f: 987.77, t: 0, d: 0.3, g: 0.18 }, { f: 1479.98, t: 0.09, d: 0.45, g: 0.14 }],
  error: [{ f: 330, t: 0, d: 0.25, type: 'triangle', g: 0.25 }, { f: 262, t: 0.12, d: 0.35, type: 'triangle', g: 0.25 }],
  shutdown: [{ f: 783.99, t: 0, d: 1 }, { f: 659.25, t: 0.14, d: 1 }, { f: 523.25, t: 0.28, d: 1.4 }],
};

export function playSound(name, settings) {
  try {
    if (settings) {
      if (!settings.get('sound.enabled') || settings.get('qs.muted')) return;
    }
    const volume = settings ? settings.get('qs.volume') / 100 : 0.7;
    if (volume <= 0) return;
    const ac = audio();
    if (ac.state === 'suspended') ac.resume();
    const master = ac.createGain();
    master.gain.value = volume * 0.5;
    master.connect(ac.destination);
    for (const t of SOUNDS[name] || []) tone(ac, master, t);
  } catch { /* audio unavailable (no device): stay silent */ }
}
