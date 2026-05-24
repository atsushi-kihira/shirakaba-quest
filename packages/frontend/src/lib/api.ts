// =============================================================
// API クライアント — fetch ラッパー
// =============================================================

const BASE_URL = "/api";

function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
};

async function request<T>(
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

  delete: <T>(path: string) =>
    request<T>(path, { method: "DELETE" }),
};
