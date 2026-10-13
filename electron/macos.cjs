function createMacOSController({ clipboard, execFile, Notification }) {
  function pasteText(text) {
    clipboard.writeText(text);
    return new Promise((resolve) => {
      execFile('osascript', [
        '-e',
        'tell application "System Events" to keystroke "v" using {command down}'
      ], (error) => {
        if (error) {
          return resolve({
            ok: false,
            error: { code: 'PASTE_FAILED', message: error.message || 'Unable to paste transcript' }
          });
        }
        resolve({ ok: true });
      });
    });
  }

  function showNotification(title, body) {
    const NotificationConstructor = Notification || require('electron').Notification;
    const notification = new NotificationConstructor({ title, body });
    notification.show();
  }

  return { pasteText, showNotification };
}

module.exports = { createMacOSController };
