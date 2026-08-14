import type { Scope } from '@campusops/contracts';

export const cognitoScopeMap: Readonly<Record<string, Scope>> = {
  'campusops/policies.read': 'policies:read',
  'campusops/services.read': 'services:read',
  'campusops/requests.read': 'requests:read',
  'campusops/requests.write': 'requests:write',
  'campusops/admin.audit': 'admin:audit'
};

export const mapCognitoScopes = (scope: string): Scope[] => [
  ...new Set(
    scope
      .split(/\s+/)
      .filter(Boolean)
      .map((value) => cognitoScopeMap[value])
      .filter((value): value is Scope => value !== undefined)
  )
];
