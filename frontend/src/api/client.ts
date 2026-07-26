export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const csrf = document.cookie.match(/(?:^|; )mae_csrf=([^;]+)/)?.[1];
  const headers = new Headers(init.headers);
  if (init.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase()) && csrf) headers.set('X-CSRF-Token', decodeURIComponent(csrf));
  const response = await fetch(input, { ...init, credentials: 'same-origin', headers });
  if (response.status === 401) window.dispatchEvent(new Event('mae:auth-expired'));
  return response;
}

export function apiError(response: Response, fallback: string) {
  return response.text().then(text => new Error(text || `${fallback}: ${response.status}`));
}
