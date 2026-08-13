import { AuthenticationError, type Principal } from '@campusops/auth';
import type { Scope } from '@campusops/contracts';

export const cognitoScopeMap: Readonly<Record<string, Scope>> = {
  'campusops/policies.read': 'policies:read',
  'campusops/services.read': 'services:read',
  'campusops/requests.read': 'requests:read',
  'campusops/requests.write': 'requests:write',
  'campusops/admin.audit': 'admin:audit'
};

export interface ApiGatewayClaims {
  sub?: unknown;
  scope?: unknown;
}

export function principalFromApiGatewayClaims(
  claims: ApiGatewayClaims,
  requestId: string
): Principal {
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new AuthenticationError('Authenticated request is missing a valid subject');
  }
  if (claims.scope !== undefined && typeof claims.scope !== 'string') {
    throw new AuthenticationError('Authenticated request contains malformed scopes');
  }
  const external =
    typeof claims.scope === 'string' ? claims.scope.split(/\s+/).filter(Boolean) : [];
  const scopes = [
    ...new Set(
      external
        .map((scope) => cognitoScopeMap[scope])
        .filter((scope): scope is Scope => scope !== undefined)
    )
  ];
  return { userId: claims.sub, sessionId: requestId, scopes };
}
