import { describe, expect, it } from 'vitest';
import { authorizeWorkspaceRequest } from '../src/server/request-auth.js';
import { InMemoryWorkspaceAuthStore, WorkspaceAuthenticationError } from '../src/server/session.js';
import { loadWorkspaceConfig } from '../src/server/config.js';
import { validateCognitoClaims } from '../src/server/cognito.js';

describe('workspace Cognito session boundary', () => {
  it('rejects an ID token payload with the wrong token_use', () => {
    const access = {
      sub: 'user-alex',
      client_id: 'workspace-client',
      token_use: 'access',
      scope: 'campusops/services.read',
      exp: 2_000
    };
    expect(() =>
      validateCognitoClaims(
        access,
        { sub: 'user-alex', token_use: 'access', email: 'alex@example.test' },
        'workspace-client'
      )
    ).toThrow();
    expect(
      validateCognitoClaims(
        access,
        { sub: 'user-alex', token_use: 'id', email: 'alex@example.test' },
        'workspace-client'
      ).identity.token_use
    ).toBe('id');
  });

  it('enforces one-time OAuth state matching', () => {
    const store = new InMemoryWorkspaceAuthStore();
    const login = store.beginLogin();
    expect(() => store.consumeLogin(login.id, 'wrong-state')).toThrow(WorkspaceAuthenticationError);
    expect(() => store.consumeLogin(login.id, login.state)).toThrow(WorkspaceAuthenticationError);
  });

  it('rejects unauthenticated and expired sessions', () => {
    let now = 1_000;
    const store = new InMemoryWorkspaceAuthStore(() => now);
    expect(() => authorizeWorkspaceRequest(store, {})).toThrow(WorkspaceAuthenticationError);
    const session = store.createSession({
      userId: 'user-alex',
      displayName: 'Alex',
      scopes: ['requests:read'],
      accessToken: 'memory-only-token',
      expiresAt: 2_000
    });
    now = 2_001;
    expect(() => authorizeWorkspaceRequest(store, { sessionId: session.id })).toThrow(
      WorkspaceAuthenticationError
    );
  });

  it('requires the session-bound CSRF token for state-changing workspace APIs', () => {
    const store = new InMemoryWorkspaceAuthStore(() => 1_000);
    const session = store.createSession({
      userId: 'user-alex',
      displayName: 'Alex',
      scopes: ['requests:read'],
      accessToken: 'memory-only-token',
      expiresAt: 2_000
    });
    expect(() =>
      authorizeWorkspaceRequest(store, {
        sessionId: session.id,
        csrfToken: 'wrong',
        requireCsrf: true
      })
    ).toThrow('CSRF');
    expect(
      authorizeWorkspaceRequest(store, {
        sessionId: session.id,
        csrfToken: session.csrfToken,
        requireCsrf: true
      }).userId
    ).toBe('user-alex');
  });

  it('fails closed on non-TLS production workspace endpoints', () => {
    expect(() =>
      loadWorkspaceConfig({
        NODE_ENV: 'production',
        AWS_REGION: 'us-west-2',
        WORKSPACE_BASE_URL: 'http://localhost:3000',
        COGNITO_USER_POOL_ID: 'pool',
        COGNITO_CLIENT_ID: 'client',
        COGNITO_DOMAIN: 'campusops-dev',
        MCP_ENDPOINT: 'https://api.example.test/mcp'
      })
    ).toThrow('HTTPS');
  });
});
