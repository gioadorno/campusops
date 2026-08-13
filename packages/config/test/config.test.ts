import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_JWT_SECRET, loadConfig } from '../src/index.js';

describe('JWT configuration', () => {
  it('allows the local fallback in development and test', () => {
    expect(loadConfig({}).CAMPUSOPS_RUNTIME).toBe('local');
    expect(loadConfig({ NODE_ENV: 'development' }).JWT_SECRET).toBe(DEVELOPMENT_JWT_SECRET);
    expect(loadConfig({ NODE_ENV: 'test' }).JWT_SECRET).toBe(DEVELOPMENT_JWT_SECRET);
  });

  it('fails closed when production JWT_SECRET is missing', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
      'Production requires an explicit non-development JWT_SECRET'
    );
  });

  it('rejects the explicit development fallback in production', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', JWT_SECRET: DEVELOPMENT_JWT_SECRET })
    ).toThrow('Production requires an explicit non-development JWT_SECRET');
  });

  it('accepts an explicit strong production secret', () => {
    expect(
      loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'production-only-secret-with-at-least-32-characters'
      }).NODE_ENV
    ).toBe('production');
  });
});
