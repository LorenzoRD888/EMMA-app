// Desktop notifications: Notification Centre on macOS, toast notifications on
// Windows. They work even when the EMMA window is closed, as long as EMMA is
// running. On other systems nothing happens.
import { execFile } from 'node:child_process';

const quote = s => '"' + String(s || '').replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 240) + '"';

// Windows: PowerShell shows a toast. Texts go through environment variables, never inside the script.
const WIN_TOAST = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$x = $t.GetElementsByTagName('text')
$null = $x.Item(0).AppendChild($t.CreateTextNode($env:EMMA_TITLE))
$null = $x.Item(1).AppendChild($t.CreateTextNode($env:EMMA_BODY))
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($t))`;
function windowsNotify(title, body, subtitle) {
  const clean = v => String(v || '').replace(/[\r\n]+/g, ' ').slice(0, 240);
  const env = { ...process.env, EMMA_TITLE: clean(title), EMMA_BODY: clean(subtitle ? `${subtitle} — ${body}` : body) };
  return new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_TOAST], { timeout: 15000, env, windowsHide: true }, err => resolve(!err)));
}

export function macNotify(title, body, { subtitle = '' } = {}) {
  if (process.platform === 'win32') return windowsNotify(title, body, subtitle);
  if (process.platform !== 'darwin') return Promise.resolve(false);
  const script = `display notification ${quote(body)} with title ${quote(title)}${subtitle ? ` subtitle ${quote(subtitle)}` : ''} sound name "Glass"`;
  return new Promise(resolve => execFile('/usr/bin/osascript', ['-e', script], { timeout: 10000 }, err => resolve(!err)));
}

// One notification per update: a single move is described, several are summarised.
export function alertMessage(items, labels) {
  if (!items.length) return null;
  if (items.length === 1) {
    const i = items[0];
    return { title: `EMMA · ${i.companyName}`, subtitle: labels[i.eventType] || 'Strategic move', body: i.kind === 'change' ? `${i.title}: ${i.change.addedCount} lines added, ${i.change.removedCount} removed.` : i.title };
  }
  const companies = [...new Set(items.map(i => i.companyName))];
  return { title: `EMMA · ${items.length} strategic moves`, subtitle: companies.slice(0, 3).join(', ') + (companies.length > 3 ? '…' : ''), body: items.slice(0, 2).map(i => `${i.companyName}: ${labels[i.eventType] || ''}`).join(' · ') + ' — open the Daily.' };
}
