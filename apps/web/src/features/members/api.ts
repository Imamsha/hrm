import type {
  InvitationItem,
  MemberListItem,
  PermissionCatalogItem,
  RoleDetails,
} from '@hrm/shared-types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface MemberQuery {
  page: number;
  pageSize: number;
  sortBy?: string | undefined;
  sortDir: 'asc' | 'desc';
  search?: string | undefined;
  status?: 'ACTIVE' | 'SUSPENDED' | undefined;
}

export function useMembersPage(query: MemberQuery) {
  return useQuery({
    queryKey: ['members', query],
    queryFn: ({ signal }) =>
      api.getPage<MemberListItem>('/members', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleDetails[]>('/roles') });
}

export function usePermissionCatalog() {
  return useQuery({
    queryKey: ['permissions'],
    queryFn: () => api.get<PermissionCatalogItem[]>('/permissions'),
    staleTime: Infinity,
  });
}

export function usePendingInvitations(enabled: boolean) {
  return useQuery({
    queryKey: ['invitations'],
    queryFn: () => api.get<InvitationItem[]>('/invitations'),
    enabled,
  });
}
