import { describe, expect, it } from 'vitest';
import { AuthenticationError, bearerToken, LocalJwtAuth } from '../src/index.js';

describe('local JWT-compatible authentication', () => {
  it('issues and verifies signed JWTs', async () => {
    const auth = new LocalJwtAuth('a-local-test-secret-with-at-least-32-characters');
    const token = await auth.issue({
      userId: 'user-alex',
      sessionId: 'session-1',
      scopes: ['requests:read']
    });
    await expect(auth.verify(token)).resolves.toEqual({
      userId: 'user-alex',
      sessionId: 'session-1',
      scopes: ['requests:read']
    });
  });

  it('rejects missing bearer credentials', () => {
    expect(() => bearerToken(null)).toThrow(AuthenticationError);
    expect(() => bearerToken('Basic abc')).toThrow(AuthenticationError);
  });
});
