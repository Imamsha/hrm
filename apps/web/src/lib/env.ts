/** Browser-exposed configuration. Only `VITE_*` variables are available here. */
export const env = {
  apiBaseUrl:
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3100/api/v1',
} as const;
