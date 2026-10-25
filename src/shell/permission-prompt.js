// Asks the user whether an app may use a permission (installed into the kernel).

import { h } from '../ui/h.js';
import { dialog } from '../ui/dialog.js';

export function installPermissionPrompt(kernel) {
  kernel.permissions.setPrompter(async ({ appName, appIcon, info, uid }) => {
    // Apps of a user who isn't on screen can't ask now; they'll be asked when visible.
    if (uid !== kernel.session.user?.id) return 'dismiss';
    const answer = await dialog({
      title: `Let ${appName} ${info.label.charAt(0).toLowerCase()}${info.label.slice(1)}?`,
      body: h('div', { style: { display: 'flex', gap: '14px', alignItems: 'flex-start' } },
        h('img', { src: appIcon, alt: '', style: { width: '40px', height: '40px' } }),
        h('p', `${info.description} You can change this any time in Settings › Privacy.`)),
      cancelValue: 'dismiss',
      buttons: [
        { label: 'Allow', value: 'granted', primary: true },
        { label: 'Allow once', value: 'once' },
        { label: 'Don’t allow', value: 'denied' },
      ],
    });
    return answer;
  });
}
