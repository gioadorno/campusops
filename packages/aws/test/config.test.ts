import { describe, expect, it } from 'vitest';
import { loadAwsRuntimeConfig } from '../src/index.js';

const valid = {
  CAMPUSOPS_RUNTIME: 'aws',
  AWS_REGION: 'us-west-2',
  CAMPUSOPS_TABLE_NAME: 'campusops-dev',
  CAMPUSOPS_AUDIT_TABLE_NAME: 'campusops-audit-dev',
  COGNITO_USER_POOL_ID: 'us-west-2_example',
  COGNITO_CLIENT_ID: 'example-client',
  ALLOWED_ORIGINS: 'http://localhost:3000,https://dev.example.test',
  ENVIRONMENT: 'dev'
};

describe('AWS runtime configuration', () => {
  it('requires explicit AWS mode configuration', () => {
    expect(() => loadAwsRuntimeConfig({ CAMPUSOPS_RUNTIME: 'local' })).toThrow();
    expect(loadAwsRuntimeConfig(valid).ALLOWED_ORIGINS).toEqual([
      'http://localhost:3000',
      'https://dev.example.test'
    ]);
  });

  it('rejects wildcard and malformed origins', () => {
    expect(() => loadAwsRuntimeConfig({ ...valid, ALLOWED_ORIGINS: '*' })).toThrow();
    expect(() => loadAwsRuntimeConfig({ ...valid, ALLOWED_ORIGINS: 'not-an-origin' })).toThrow();
  });
});
