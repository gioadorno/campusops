import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryAuditSink } from '@campusops/audit';
import type { Principal } from '@campusops/auth';
import {
  createSupportRequestInput,
  listSupportRequestsInput,
  searchPoliciesInput
} from '@campusops/contracts';
import { CampusOpsService, createDependencies, type Dependencies } from '../src/application.js';
import { IdempotencyConflictError, OwnershipError } from '../src/errors.js';

const alex: Principal = {
  userId: 'user-alex',
  sessionId: 'session-alex',
  scopes: ['policies:read', 'services:read', 'requests:read', 'requests:write']
};

describe('CampusOps application security', () => {
  let audit: InMemoryAuditSink;
  let dependencies: Dependencies;
  let service: CampusOpsService;

  beforeEach(() => {
    audit = new InMemoryAuditSink();
    dependencies = createDependencies(audit);
    service = new CampusOpsService(dependencies);
  });

  it('validates and normalizes tool input', () => {
    expect(searchPoliciesInput.parse({ query: ' MFA ' })).toEqual({ query: 'MFA', limit: 10 });
    expect(listSupportRequestsInput.parse({})).toEqual({ limit: 20 });
  });

  it('rejects malformed arguments', () => {
    expect(searchPoliciesInput.safeParse({ query: '', limit: 0 }).success).toBe(false);
    expect(
      createSupportRequestInput.safeParse({
        category: 'network',
        title: 'x',
        description: 'y',
        idempotencyKey: ''
      }).success
    ).toBe(false);
  });

  it('enforces required scopes and audits the denial', async () => {
    const readOnly: Principal = { ...alex, scopes: ['requests:read'] };
    await expect(
      service.createSupportRequest(
        { principal: readOnly, traceId: 'trace-denied' },
        createSupportRequestInput.parse({
          category: 'network',
          title: 'Cannot connect',
          description: 'Test network is unavailable.',
          idempotencyKey: 'denied-1'
        })
      )
    ).rejects.toMatchObject({ name: 'AuthorizationError' });
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      traceId: 'trace-denied',
      authorizationDecision: 'deny',
      result: 'denied',
      denialReason: 'scope',
      requiredScopes: ['requests:write']
    });
  });

  it('prevents cross-user support request access', async () => {
    await expect(
      service.getSupportRequest({ principal: alex }, 'req-blair-001')
    ).rejects.toBeInstanceOf(OwnershipError);
    expect(audit.events[0]).toMatchObject({
      result: 'denied',
      authorizationDecision: 'deny',
      denialReason: 'ownership'
    });
  });

  it('uses user-scoped idempotency and does not duplicate a request', async () => {
    const input = createSupportRequestInput.parse({
      category: 'software',
      title: 'Editor install',
      description: 'Need the fictional lab editor installed.',
      severity: 'low',
      idempotencyKey: 'install-editor-1'
    });
    const first = await service.createSupportRequest({ principal: alex }, input);
    const second = await service.createSupportRequest({ principal: alex }, input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.request.id).toBe(first.request.id);
    expect(dependencies.support.countForUser(alex.userId)).toBe(2);
  });

  it('rejects idempotency-key reuse with a different canonical payload', async () => {
    const original = createSupportRequestInput.parse({
      category: 'software',
      title: 'Editor install',
      description: 'Install the fictional editor.',
      severity: 'low',
      idempotencyKey: 'payload-bound-1'
    });
    await service.createSupportRequest({ principal: alex }, original);
    await expect(
      service.createSupportRequest(
        { principal: alex },
        { ...original, description: 'A different operation must not reuse this key.' }
      )
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(dependencies.support.countForUser(alex.userId)).toBe(2);
  });

  it('loads every MCP resource through application and repository boundaries', async () => {
    await expect(service.getPolicyCatalog({ principal: alex })).resolves.toHaveLength(3);
    await expect(
      service.getPoliciesByCategory({ principal: alex }, 'security')
    ).resolves.toHaveLength(1);
    await expect(service.getServiceCatalog({ principal: alex })).resolves.toHaveLength(2);
    await expect(service.getSupportCategories({ principal: alex })).resolves.toContain('network');
    await expect(service.getPlatformCapabilities({ principal: alex })).resolves.toMatchObject({
      tools: 6,
      resources: 5,
      prompts: 2
    });
  });

  it('emits a complete audit event without sensitive arguments', async () => {
    await service.searchPolicies(
      { principal: alex, traceId: 'trace-search' },
      searchPoliciesInput.parse({ query: 'security' })
    );
    const event = audit.events[0];
    expect(event).toMatchObject({
      traceId: 'trace-search',
      userId: 'user-alex',
      sessionId: 'session-alex',
      action: 'read',
      tool: 'search_policies',
      authorizationDecision: 'allow',
      requiredScopes: ['policies:read'],
      result: 'success'
    });
    expect(event?.eventId).toEqual(expect.stringMatching(/.+/));
    expect(event?.durationMs).toBeGreaterThanOrEqual(0);
    expect(event?.timestamp).toEqual(expect.stringMatching(/.+/));
    expect(JSON.stringify(event)).not.toContain('security');
  });
});
