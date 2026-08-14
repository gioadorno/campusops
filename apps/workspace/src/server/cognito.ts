import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { mapCognitoScopes } from '@campusops/aws';
import { WorkspaceAuthenticationError, type PendingLogin } from './session.js';
import type { WorkspaceConfig } from './config.js';

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  id_token: z.string().min(1),
  expires_in: z.number().positive()
});

const accessClaimsSchema = z.object({
  sub: z.string().min(1),
  client_id: z.string().min(1),
  token_use: z.literal('access'),
  scope: z.string().default(''),
  exp: z.number().positive(),
  username: z.string().optional()
});

const idClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email().optional()
});

export interface CognitoIdentity {
  userId: string;
  displayName: string;
  scopes: ReturnType<typeof mapCognitoScopes>;
  accessToken: string;
  expiresAt: number;
}

export class CognitoOAuthClient {
  private readonly jwks;

  constructor(private readonly config: WorkspaceConfig) {
    this.jwks = createRemoteJWKSet(new URL(`${config.cognitoIssuer}/.well-known/jwks.json`));
  }

  authorizationUrl(login: PendingLogin): string {
    const authorization = new URL('/oauth2/authorize', this.config.cognitoBaseUrl);
    authorization.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.COGNITO_CLIENT_ID,
      redirect_uri: this.config.callbackUrl,
      scope: [
        'openid',
        'email',
        'campusops/policies.read',
        'campusops/services.read',
        'campusops/requests.read',
        'campusops/requests.write'
      ].join(' '),
      code_challenge: login.challenge,
      code_challenge_method: 'S256',
      state: login.state
    }).toString();
    return authorization.toString();
  }

  logoutUrl(): string {
    const logout = new URL('/logout', this.config.cognitoBaseUrl);
    logout.search = new URLSearchParams({
      client_id: this.config.COGNITO_CLIENT_ID,
      logout_uri: this.config.logoutUrl
    }).toString();
    return logout.toString();
  }

  async exchange(code: string, login: PendingLogin): Promise<CognitoIdentity> {
    const response = await fetch(`${this.config.cognitoBaseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.config.COGNITO_CLIENT_ID,
        code,
        redirect_uri: this.config.callbackUrl,
        code_verifier: login.verifier
      }),
      cache: 'no-store'
    });
    if (!response.ok) {
      throw new WorkspaceAuthenticationError(
        `Cognito token exchange failed (${response.status})`,
        400
      );
    }
    const tokens = tokenResponseSchema.parse(await response.json());
    try {
      const access = accessClaimsSchema.parse(
        (
          await jwtVerify(tokens.access_token, this.jwks, {
            issuer: this.config.cognitoIssuer
          })
        ).payload
      );
      if (access.client_id !== this.config.COGNITO_CLIENT_ID) {
        throw new Error('Unexpected Cognito client');
      }
      const identity = idClaimsSchema.parse(
        (
          await jwtVerify(tokens.id_token, this.jwks, {
            issuer: this.config.cognitoIssuer,
            audience: this.config.COGNITO_CLIENT_ID
          })
        ).payload
      );
      if (identity.sub !== access.sub) throw new Error('Cognito token subject mismatch');
      return {
        userId: access.sub,
        displayName: identity.email ?? access.username ?? 'CampusOps user',
        scopes: mapCognitoScopes(access.scope),
        accessToken: tokens.access_token,
        expiresAt: Math.min(access.exp * 1000, Date.now() + tokens.expires_in * 1000)
      };
    } catch {
      throw new WorkspaceAuthenticationError('Cognito returned invalid identity tokens', 400);
    }
  }
}
