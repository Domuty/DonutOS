// Focus sessions: do-not-disturb for a chosen number of minutes. The shell ends them and
// posts "Focus session complete" when the time is up.

export function toggleFocus(settings) {
  if (settings.get('qs.focus')) {
    settings.set('qs.focus', false);
    settings.set('qs.focusUntil', 0);
    return false;
  }
  settings.set('qs.focusUntil', Date.now() + settings.get('qs.focusMinutes') * 60_000);
  settings.set('qs.focus', true);
  return true;
}
