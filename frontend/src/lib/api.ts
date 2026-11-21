export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type AuthTokens = { accessToken: string; refreshToken: string };
const accessTokenKey = "playpulse.accessToken";
const refreshTokenKey = "playpulse.refreshToken";
let refreshInFlight: Promise<boolean> | null = null;

export function saveAuthTokens(tokens: AuthTokens): void {
  sessionStorage.setItem(accessTokenKey, tokens.accessToken);
  sessionStorage.setItem(refreshTokenKey, tokens.refreshToken);
}

export function clearAuthTokens(): void {
  sessionStorage.removeItem(accessTokenKey);
  sessionStorage.removeItem(refreshTokenKey);
}

export function getRefreshToken(): string | null {
  return sessionStorage.getItem(refreshTokenKey);
}

function isAuthRequest(path: string): boolean {
  return ["/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/logout"].includes(path);
}

async function refreshAuthTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  refreshInFlight = (async () => {
    const response = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      clearAuthTokens();
      return false;
    }

    const body = await response.json() as { data?: Partial<AuthTokens> };
    if (!body.data?.accessToken || !body.data.refreshToken) {
      clearAuthTokens();
      throw new Error("The session refresh response did not contain valid tokens");
    }
    saveAuthTokens({ accessToken: body.data.accessToken, refreshToken: body.data.refreshToken });
    return true;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const send = (accessToken: string | null) => {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (accessToken && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${accessToken}`);
    return fetch(path, { ...init, credentials: "same-origin", headers });
  };
  let response = await send(sessionStorage.getItem(accessTokenKey));
  if (response.status === 401 && !isAuthRequest(path) && await refreshAuthTokens()) {
    response = await send(sessionStorage.getItem(accessTokenKey));
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorBody = body as { error?: { message?: string } } | null;
    throw new ApiRequestError(errorBody?.error?.message ?? `Request failed (${response.status})`, response.status);
  }
  return body as T;
}

export type ApiEnvelope<T> = { success: boolean; data: T };
