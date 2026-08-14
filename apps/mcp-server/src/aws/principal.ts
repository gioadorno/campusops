import { AuthenticationError, type Principal } from '@campusops/auth';
import { mapCognitoScopes } from '@campusops/aws';

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
  const scopes = mapCognitoScopes(typeof claims.scope === 'string' ? claims.scope : '');
  return { userId: claims.sub, sessionId: requestId, scopes };
}
