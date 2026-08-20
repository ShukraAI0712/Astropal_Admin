import { supabase } from './supabase.client';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getAuthHeaders(): Promise<HeadersInit | null> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) return null;

  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) throw new ApiError('Not authenticated', 401);

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...opts,
    headers: { ...(headers as Record<string, string>), ...(opts?.headers as Record<string, string> ?? {}) },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.detail ?? res.statusText, res.status);
  }

  return res.json();
}
