// =============================================================
// API クライアント — fetch ラッパー
// =============================================================

// 開発環境: Vite のプロキシ経由（/api → localhost:8787）
// 本番環境: Cloudflare Workers の直接 URL
export const API_BASE_URL = import.meta.env.DEV
  ? "/api"
  : "https://shirakaba-quest-api.a-kihira.workers.dev/api";

const BASE_URL = API_BASE_URL;

function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
};

export async function request<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, signal } = options;
  const token = getToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({
      error: { code: "unknown", message: "エラーが発生しました" },
    }));
    throw new ApiError(res.status, err.error?.code ?? "unknown", err.error?.message ?? "エラーが発生しました");
  }

  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(
    status: number,
    code: string,
    message: string
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ApiError";
  }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>(path, { method: "GET", signal }),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body }),

  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", body }),
};
