// One signed-in user's screen: wallpaper, desktop icons, windows, taskbar and flyouts.

import { Scheduler } from './scheduler.js';
import { h } from '../ui/h.js';
import { paintWallpaper } from './wallpaper.js';
import { WindowManager } from '../wm/window-manager.js';
import { FlyoutHost } from './flyout.js';
import { Taskbar } from './taskbar.js';
import { StartMenu } from './start-menu.js';
import { Search } from './search.js';
import { QuickSettings } from './quick-settings.js';
import { NotificationCenter } from './notification-center.js';
import { Toasts } from './toasts.js';
import { Widgets } from './widgets.js';
import { Weather } from './weather.js';
import { Desktop } from './desktop.js';
import { ClipboardPanel } from './clipboard-panel.js';
import { VirtualDesktops } from '../wm/virtual-desktops.js';
import { TaskView } from '../wm/task-view.js';
import { AltTab } from '../wm/alt-tab.js';

export class SessionView {
  constructor(shell, user) {
    this.shell = shell;
    this.kernel = shell.kernel;
    this.uid = user.id;
    this.settings = this.kernel.settings.forUser(user.id);
    this.disposers = [];

    this.wp = h('div.wp');
    this.desktopLayer = h('div.desktop-layer');
    this.windowsLayer = h('div.windows-layer');
    this.flyoutLayer = h('div.flyout-layer');
    this.el = h('div.screen.session.appear', { 'aria-label': `${user.name}’s desktop` }, this.wp, this.desktopLayer, this.windowsLayer, this.flyoutLayer);
    shell.sessions.append(this.el);

    this.flyouts = new FlyoutHost(this.flyoutLayer);
    this.weather = new Weather(this.kernel, this.uid);
    this.scheduler = new Scheduler(this.kernel, this.uid);
    this.wm = new WindowManager({
      kernel: this.kernel, uid: this.uid, layer: this.windowsLayer,
      hooks: {
        taskbarTarget: (win) => this.taskbar?.targetFor(win),
        taskbarHidden: () => this.taskbar?.hidden(),
        flash: (win) => this.taskbar?.flash(win),
      },
    });
    this.desktops = new VirtualDesktops({ wm: this.wm, settings: this.settings, layer: this.el, onWallpaper: () => this.paint() });
    this.taskView = new TaskView(this);
    this.altTab = new AltTab(this);
    // Flyouts must exist before the taskbar wires its buttons to them.
    this.start = new StartMenu(this);
    this.search = new Search(this);
    this.qs = new QuickSettings(this);
    this.nc = new NotificationCenter(this);
    this.widgets = new Widgets(this);
    this.clipboard = new ClipboardPanel(this);
    this.taskbar = new Taskbar(this);
    this.toasts = new Toasts(this);
    this.desktop = new Desktop(this);

    this.flyoutLayer.addEventListener('flyout-opening', () => this.taskView.close());
    this.disposers.push(
      this.settings.watch('appearance.wallpaper', () => this.paint()),
      this.settings.watch('appearance.wallpaperFit', () => this.paint()),
      this.settings.watch('appearance.transparency', () => this.paint()),
      this.kernel.bus.on('session:userUpdated', ({ user: u }) => { if (u.id === this.uid) this.start.render(); }),
    );
    this.paint();
    this.weather.refresh();
  }

  get user() { return this.kernel.sessions.get(this.uid)?.user; }

  async paint() {
    // A virtual desktop can have its own background.
    const spec = this.desktops?.wallpaper() || this.settings.get('appearance.wallpaper');
    const res = await paintWallpaper(this.wp, spec, this.kernel.fs, this.settings.get('appearance.wallpaperFit'));
    this.makeMica(res);
  }

  /** Mica: a soft, blurred copy of the wallpaper that windows show through their tint. */
  async makeMica(res) {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 90;
    const g = c.getContext('2d');
    if (res.url) {
      const img = new Image();
      img.src = res.url;
      try { await img.decode(); } catch { return; }
      g.filter = 'blur(6px) saturate(1.3)';
      const r = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight);
      g.drawImage(img, (c.width - img.naturalWidth * r) / 2, (c.height - img.naturalHeight * r) / 2, img.naturalWidth * r, img.naturalHeight * r);
    } else {
      g.fillStyle = res.color || '#000';
      g.fillRect(0, 0, c.width, c.height);
    }
    c.toBlob((b) => {
      if (!b) return;
      if (this.micaUrl) URL.revokeObjectURL(this.micaUrl);
      this.micaUrl = URL.createObjectURL(b);
      this.el.style.setProperty('--mica', `url("${this.micaUrl}")`);
    });
  }

  hide() { this.flyouts.close(); this.taskView.close(); this.altTab.cancel(); this.el.hidden = true; this.el.inert = true; }
  show() { this.el.hidden = false; this.el.inert = false; this.el.classList.remove('appear'); void this.el.offsetWidth; this.el.classList.add('appear'); }
  setInert(on) { this.el.inert = on; if (on) { this.flyouts.close(); this.taskView.close(); this.altTab.cancel(); } }

  destroy() {
    for (const d of this.disposers) d();
    for (const part of [this.taskbar, this.toasts, this.desktop, this.qs, this.nc, this.widgets, this.clipboard, this.weather, this.scheduler, this.flyouts, this.wm]) part?.destroy?.();
    if (this.micaUrl) URL.revokeObjectURL(this.micaUrl);
    this.el.remove();
  }
}
