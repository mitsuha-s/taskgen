import { useQuery } from '@tanstack/react-query';
import { APIError, api } from './api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    retry: false,
    throwOnError: false,
  });
}

export function isUnauthorized(error: unknown) {
  return error instanceof APIError && error.status === 401;
}
