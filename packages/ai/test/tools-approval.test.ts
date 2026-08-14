import { describe, expect, it } from 'vitest';
import {
  ApprovalError,
  InMemoryApprovalStore,
  approvalFingerprint,
  classifyTool,
  safeErrorMessage,
  safeErrorMetadata,
  safeErrorType,
  toModelToolDefinition,
  validateToolProposal,
  getToolDefinition
} from '../src/index.js';

const proposal = {
  userId: 'user-alex',
  sessionId: 'session-1',
  conversationId: 'conversation-1',
  toolUseId: 'tool-use-1',
  tool: 'create_support_request' as const,
  args: {
    category: 'network',
    title: 'VPN unavailable',
    description: 'Cannot connect to the fictional VPN.',
    severity: 'medium',
    idempotencyKey: 'proposal-1'
  }
};

describe('CampusOps AI tool policy', () => {
  it('classifies the exact read and write tool boundary', () => {
    expect(classifyTool('search_policies')).toBe('read');
    expect(classifyTool('get_service_status')).toBe('read');
    expect(classifyTool('list_support_requests')).toBe('read');
    expect(classifyTool('get_support_request')).toBe('read');
    expect(classifyTool('create_support_request')).toBe('write');
    expect(classifyTool('cancel_support_request')).toBe('write');
  });

  it('translates the existing Zod schema into a Bedrock-compatible JSON schema', () => {
    const definition = getToolDefinition('get_service_status');
    expect(definition).toBeDefined();
    const translated = toModelToolDefinition(definition!);
    expect(translated.name).toBe('get_service_status');
    expect(translated.inputSchema.type).toBe('object');
    expect(translated.inputSchema.required).toEqual(['serviceId']);
    const properties = translated.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(properties.serviceId?.type).toBe('string');
  });

  it('validates proposals and safely rejects malformed or unknown tools', () => {
    expect(validateToolProposal('get_service_status', { serviceId: 'learning-hub' }).args).toEqual({
      serviceId: 'learning-hub'
    });
    expect(() => validateToolProposal('get_service_status', {})).toThrow('Malformed');
    expect(() => validateToolProposal('delete_everything', {})).toThrow('Unknown');
  });

  it('creates a server-controlled idempotency key that is not delegated to the model', () => {
    const definition = getToolDefinition('create_support_request');
    const modelTool = toModelToolDefinition(definition!);
    expect(
      (modelTool.inputSchema.properties as Record<string, unknown>).idempotencyKey
    ).toBeUndefined();
    const { args } = validateToolProposal('create_support_request', {
      category: 'network',
      title: 'VPN unavailable',
      description: 'Cannot connect.',
      severity: 'medium'
    });
    expect(args.idempotencyKey).toMatch(/^workspace-/);
    const injected = validateToolProposal('create_support_request', {
      category: 'network',
      title: 'VPN unavailable',
      description: 'Cannot connect.',
      severity: 'medium',
      idempotencyKey: 'model-controlled-key'
    });
    expect(injected.args.idempotencyKey).toMatch(/^workspace-/);
    expect(injected.args.idempotencyKey).not.toBe('model-controlled-key');
  });
});

describe('single-use approval store', () => {
  it('binds the fingerprint to the exact tool and canonical arguments', () => {
    expect(approvalFingerprint(proposal)).toBe(
      approvalFingerprint({ ...proposal, args: { ...proposal.args } })
    );
    expect(approvalFingerprint(proposal)).not.toBe(
      approvalFingerprint({
        ...proposal,
        args: { ...proposal.args, description: 'Different payload' }
      })
    );
  });

  it('is user/session-bound and single-use', () => {
    const store = new InMemoryApprovalStore();
    const approval = store.create(proposal);
    expect(() => store.claim(approval.id, 'other-user', proposal.sessionId)).toThrow(ApprovalError);
    expect(() => store.claim(approval.id, proposal.userId, 'other-session')).toThrow(ApprovalError);
    expect(store.claim(approval.id, proposal.userId, proposal.sessionId).args).toEqual(
      proposal.args
    );
    expect(() => store.claim(approval.id, proposal.userId, proposal.sessionId)).toThrow(
      ApprovalError
    );
    store.finish(approval.id, 'completed');
    expect(store.inspect(approval.id)?.status).toBe('completed');
  });

  it('expires and rejects approvals without allowing later execution', () => {
    let now = 1_000;
    const store = new InMemoryApprovalStore(500, () => now);
    const expired = store.create(proposal);
    now = 1_501;
    expect(() => store.claim(expired.id, proposal.userId, proposal.sessionId)).toThrow(
      ApprovalError
    );

    now = 2_000;
    const rejected = store.create(proposal);
    expect(store.reject(rejected.id, proposal.userId, proposal.sessionId).status).toBe('rejected');
    expect(() => store.claim(rejected.id, proposal.userId, proposal.sessionId)).toThrow(
      ApprovalError
    );
  });
});

describe('safe AI diagnostics', () => {
  it('redacts tokens, OAuth callback values, and authorization data', () => {
    const jwt = 'eyJheader.payload.signature';
    const message = safeErrorMessage(
      new Error(
        `Bearer ${jwt} callback?code=secret&state=secret access_token=${jwt} authorization=${jwt}`
      )
    );
    expect(message).not.toContain(jwt);
    expect(message).not.toContain('code=secret');
    expect(message).not.toContain('state=secret');
    expect(
      safeErrorType(Object.assign(new Error('secret'), { name: 'AccessDeniedException' }))
    ).toBe('AccessDeniedException');
    expect(safeErrorType(Object.assign(new Error('secret'), { name: 'SecretInternalError' }))).toBe(
      'UnexpectedError'
    );
    expect(
      safeErrorMetadata(
        Object.assign(new Error('secret'), {
          name: 'McpClientError',
          httpStatus: 403,
          requestId: 'safe-request-id',
          accessToken: jwt
        })
      )
    ).toEqual({ errorType: 'McpClientError', httpStatus: 403, requestId: 'safe-request-id' });
  });
});
