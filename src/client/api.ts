export interface ApiErrorPayload {
  ok?: boolean;
  code?: string;
  message?: string;
  error?: string;
  retryAfterSeconds?: number;
}

export async function apiFetch<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const headers = new Headers(init.headers);
  headers.set('X-Requested-With', 'RealAuction26');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers,
  });

  let data = {} as T;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = { message: text } as T;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}
