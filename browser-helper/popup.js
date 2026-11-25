/* global chrome */
const get = id => document.getElementById(id);
const status = get('status');
let selection;
let busy = false;
let maeOrigin;
chrome.storage.local.get('maeOrigin').then(({ maeOrigin: origin }) => {
  maeOrigin = origin;
  get('address').textContent = origin ? `Sending to: ${origin}` : 'No Mae address configured.';
});
get('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

function pageTables(index) {
  if (!['http:', 'https:'].includes(location.protocol)) throw new Error('Only ordinary web pages are supported.');
  const visible = node => node.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const tables = [...document.querySelectorAll('table')].filter(visible);
  const url = location.origin + location.pathname;
  if (index === null) {
    return {
      url,
      tables: tables.slice(0, 20).map((table, i) => {
        const first = [...table.rows].find(visible);
        return { label: (table.caption && visible(table.caption) ? table.caption.innerText : first?.innerText || '')
          .replace(/\s+/g, ' ').trim().slice(0, 80) || `Table ${i + 1}` };
      }),
    };
  }
  const table = tables[index];
  if (!table) throw new Error('That table is gone. List the tables again.');
  const rows = [];
  for (const row of table.rows) {
    if (!visible(row)) continue;
    const cells = [...row.cells].filter(visible);
    if (!cells.length) continue;
    if (rows.length >= 151 || cells.length > 20) throw new Error('Choose a table with at most 151 rows and 20 columns.');
    if (cells.some(cell => cell.rowSpan !== 1 || cell.colSpan !== 1 || cell.querySelector('table'))) {
      throw new Error('Tables with merged cells or nested tables are not supported.');
    }
    const values = cells.map(cell => cell.innerText.trim());
    if (values.some(value => value.length > 256)) throw new Error('One or more cells exceed 256 characters.');
    rows.push(values);
  }
  if (rows.length < 2) throw new Error('Select a table with at least two visible rows.');
  const data = { url, title: document.title.slice(0, 200), rows };
  if (new TextEncoder().encode(JSON.stringify(data)).length > 32_000) throw new Error('The selected table exceeds 32 KB.');
  return data;
}

async function inspect() {
  if (busy) return;
  busy = true;
  selection = undefined;
  get('share').disabled = true;
  get('selection').hidden = true;
  get('preview').hidden = true;
  status.textContent = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Open the helper on the tab you want to share.');
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: pageTables, args: [null],
    });
    if (!result?.tables?.length) throw new Error('No visible HTML tables found in this tab.');
    selection = { tabId: tab.id, url: result.url };
    get('tables').replaceChildren(...result.tables.map(({ label }, index) => new Option(label, index)));
    get('selection').hidden = false;
    get('preview').hidden = false;
    get('preview').textContent = `Source: ${result.url}`;
    get('share').disabled = false;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    busy = false;
  }
}

async function send(method) {
  if (busy || (method === 'PUT' && !selection)) return;
  status.textContent = '';
  busy = true;
  try {
    if (!maeOrigin) throw new Error('Set up the Mae connection first.');
    const address = new URL(maeOrigin);
    if (!await chrome.permissions.contains({ origins: [`${address.protocol}//${address.hostname}/*`] })) {
      throw new Error('Mae address access is unavailable. Set up the connection again.');
    }
    const code = get('code').value.trim();
    if (!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('Enter the code copied from the active Mae run.');
    const runId = code.split('.')[0];
    let body;
    if (method === 'PUT') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== selection.tabId) throw new Error('The active tab changed. List tables again.');
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: selection.tabId }, func: pageTables, args: [Number(get('tables').value)],
      });
      if (!result || result.url !== selection.url) throw new Error('The page changed. List tables again.');
      body = JSON.stringify(result);
    }
    const response = await fetch(`${address.origin}/api/browser-grants/${runId}`, {
      method, redirect: 'error', credentials: 'omit',
      headers: { Authorization: `Bearer ${code}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body, signal: AbortSignal.timeout(10000),
    });
    if (response.status === 404 || response.status === 409) throw new Error('The code is invalid, already used, or the run has ended.');
    if (!response.ok) throw new Error(`Mae rejected the request (HTTP ${response.status}).`);
    status.textContent = method === 'PUT' ? 'Table shared. Mae has no further access to this tab.' : 'Run access revoked.';
    selection = undefined;
    get('share').disabled = true;
    if (method === 'DELETE') get('code').value = '';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    busy = false;
  }
}

get('inspect').addEventListener('click', inspect);
get('share').addEventListener('click', () => send('PUT'));
get('revoke').addEventListener('click', () => send('DELETE'));
