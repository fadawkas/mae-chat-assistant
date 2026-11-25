/* global chrome */
const address = document.getElementById('address');
const status = document.getElementById('status');
const save = document.getElementById('save');
const disconnect = document.getElementById('disconnect');
let current;

chrome.storage.local.get('maeOrigin').then(({ maeOrigin }) => {
  current = maeOrigin;
  address.value = current || '';
});

function hostPermission(value) {
  const url = new URL(value);
  return `${url.protocol}//${url.hostname}/*`;
}

document.querySelector('form').addEventListener('submit', async event => {
  event.preventDefault();
  save.disabled = disconnect.disabled = true;
  try {
    const url = new URL(address.value.trim());
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Enter the Mae origin without a path or credentials. Use HTTPS, or HTTP on localhost.');
    }
    const permission = hostPermission(url.origin);
    if (!await chrome.permissions.request({ origins: [permission] })) throw new Error('Mae address permission was denied.');
    const previous = current && hostPermission(current);
    await chrome.storage.local.set({ maeOrigin: url.origin });
    current = url.origin;
    if (previous && previous !== permission) await chrome.permissions.remove({ origins: [previous] });
    status.textContent = 'Connected. Return to the tab you want to share.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    save.disabled = disconnect.disabled = false;
  }
});

disconnect.addEventListener('click', async () => {
  save.disabled = disconnect.disabled = true;
  try {
    if (current) await chrome.permissions.remove({ origins: [hostPermission(current)] });
    await chrome.storage.local.remove('maeOrigin');
    current = undefined;
    address.value = '';
    status.textContent = 'Disconnected. No Mae address is configured.';
  } catch {
    status.textContent = 'Could not disconnect. Check this extension’s permissions in Chromium.';
  } finally {
    save.disabled = disconnect.disabled = false;
  }
});
