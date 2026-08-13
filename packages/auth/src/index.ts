import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { scopeSchema, type Scope } from '@campusops/contracts';

export interface Principal {
  userId: string;
  sessionId: string;
  scopes: readonly Scope[];
}

export interface TokenVerifier {
  verify(token: string): Promise<Principal>;
}

export class AuthenticationError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  constructor(public readonly requiredScopes: readonly Scope[]) {
    super(`Missing required scope: ${requiredScopes.join(', ')}`);
    this.name = 'AuthorizationError';
  }
}

const claimsSchema = z.object({
  sub: z.string().min(1),
  sid: z.string().min(1),
  scopes: z.array(scopeSchema)
});

export class LocalJwtAuth implements TokenVerifier {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly issuer = 'campusops-local'
  ) {
    if (secret.length < 32) throw new Error('JWT secret must be at least 32 characters');
    this.key = new TextEncoder().encode(secret);
  }

  async issue(principal: Principal, expiresIn = '1h'): Promise<string> {
    return new SignJWT({ sid: principal.sessionId, scopes: [...principal.scopes] })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(principal.userId)
      .setIssuer(this.issuer)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(this.key);
  }

  async verify(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: this.issuer });
      const claims = claimsSchema.parse(payload);
      return { userId: claims.sub, sessionId: claims.sid, scopes: claims.scopes };
    } catch {
      throw new AuthenticationError('Invalid or expired bearer token');
    }
  }
}

export function authorize(principal: Principal, requiredScopes: readonly Scope[]): void {
  if (!requiredScopes.every((scope) => principal.scopes.includes(scope))) {
    throw new AuthorizationError(requiredScopes);
  }
}

export function bearerToken(header: string | null): string {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!match?.[1]) throw new AuthenticationError();
  return match[1];
}
