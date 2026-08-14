import { describe, expect, it } from 'vitest';
import { createPkce, validateAppClient } from '../../../scripts/auth-smoke-aws.js';
import { safeErrorMessage } from '../../../scripts/aws-smoke-lib.js';

describe('authenticated AWS smoke helpers', () => {
  it('generates an RFC 7636-compatible verifier and challenge', () => {
    const first = createPkce();
    const second = createPkce();
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toEqual(second);
  });

  it('accepts the required public authorization-code client configuration', () => {
    expect(() =>
      validateAppClient({
        HasClientSecret: false,
        AllowedOAuthFlowsUserPoolClient: true,
        AllowedOAuthFlows: ['code'],
        AllowedOAuthScopes: [
          'campusops/policies.read',
          'campusops/services.read',
          'campusops/requests.read',
          'campusops/requests.write'
        ],
        CallbackURLs: ['http://localhost:3000/callback'],
        SupportedIdentityProviders: ['COGNITO']
      })
    ).not.toThrow();
  });

  it('rejects callback and scope drift', () => {
    expect(() =>
      validateAppClient({
        AllowedOAuthFlowsUserPoolClient: true,
        AllowedOAuthFlows: ['code'],
        AllowedOAuthScopes: [],
        CallbackURLs: ['http://localhost:4000/callback'],
        SupportedIdentityProviders: ['COGNITO']
      })
    ).toThrow('callback mismatch');
  });

  it('rejects a client missing a required CampusOps scope', () => {
    expect(() =>
      validateAppClient({
        AllowedOAuthFlowsUserPoolClient: true,
        AllowedOAuthFlows: ['code'],
        AllowedOAuthScopes: ['campusops/policies.read'],
        CallbackURLs: ['http://localhost:3000/callback'],
        SupportedIdentityProviders: ['COGNITO']
      })
    ).toThrow('missing scopes');
  });

  it('redacts OAuth and bearer secret material from diagnostics', () => {
    const jwt = 'eyJheader.payload.signature';
    const message = safeErrorMessage(
      new Error(`Bearer ${jwt} https://example.test/callback?code=secret&state=secret`)
    );
    expect(message).not.toContain(jwt);
    expect(message).not.toContain('code=secret');
    expect(message).not.toContain('state=secret');
  });
});
