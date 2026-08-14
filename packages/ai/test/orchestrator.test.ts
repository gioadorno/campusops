import { describe, expect, it } from 'vitest';
import {
  ApprovalError,
  CampusOpsOrchestrator,
  InMemoryApprovalStore,
  InMemoryConversationStore,
  InMemoryDiagnosticSink,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type ToolExecutionContext,
  type ToolExecutor,
  type UserContext
} from '../src/index.js';

class QueueModel implements ModelProvider {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly responses: ModelResponse[]) {}
  converse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    const response = this.responses.shift();
    if (!response) throw new Error('No fake model response');
    return Promise.resolve(response);
  }
}

class RecordingExecutor implements ToolExecutor {
  readonly calls: Array<{
    name: string;
    args: Record<string, unknown>;
    context: ToolExecutionContext;
  }> = [];
  execute(name: string, args: Record<string, unknown>, context: ToolExecutionContext) {
    this.calls.push({ name, args: structuredClone(args), context: { ...context } });
    return Promise.resolve({ ok: true, tool: name });
  }
}

const context: UserContext = {
  userId: 'user-alex',
  sessionId: 'session-alex',
  scopes: ['policies:read', 'services:read', 'requests:read', 'requests:write'],
  accessToken: 'not-a-real-token'
};

const text = (value: string): ModelResponse => ({
  message: { role: 'assistant', content: [{ type: 'text', text: value }] }
});

const tool = (name: string, input: unknown, id = 'tool-use-1'): ModelResponse => ({
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }
});

const createHarness = (responses: ModelResponse[]) => {
  const model = new QueueModel(responses);
  const executor = new RecordingExecutor();
  const approvals = new InMemoryApprovalStore();
  const conversations = new InMemoryConversationStore();
  const diagnostics = new InMemoryDiagnosticSink();
  const orchestrator = new CampusOpsOrchestrator(
    model,
    executor,
    conversations,
    approvals,
    diagnostics
  );
  return { model, executor, approvals, conversations, diagnostics, orchestrator };
};

describe('governed model tool orchestration', () => {
  it('automatically executes a valid read-only tool and continues the model turn', async () => {
    const harness = createHarness([
      tool('get_service_status', { serviceId: 'learning-hub' }),
      text('The learning hub is operational.')
    ]);
    const result = await harness.orchestrator.chat(context, 'Is the learning hub working?');
    expect(harness.executor.calls).toHaveLength(1);
    expect(harness.executor.calls[0]).toMatchObject({
      name: 'get_service_status',
      args: { serviceId: 'learning-hub' }
    });
    expect(result.assistantText).toBe('The learning hub is operational.');
    expect(result.approval).toBeUndefined();
    expect(harness.model.requests[1]?.messages.at(-1)).toMatchObject({
      role: 'user',
      content: [expect.objectContaining({ type: 'tool_result', status: 'success' })]
    });
  });

  it('executes a model batch only when every requested tool is authorized and read-only', async () => {
    const harness = createHarness([
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'service-1',
              name: 'get_service_status',
              input: { serviceId: 'learning-hub' }
            },
            {
              type: 'tool_use',
              id: 'service-2',
              name: 'get_service_status',
              input: { serviceId: 'campus-wifi' }
            }
          ]
        }
      },
      text('Campus Wi-Fi is degraded; Learning Hub is operational.')
    ]);
    const result = await harness.orchestrator.chat(context, 'Are any services having problems?');
    expect(harness.executor.calls.map(({ name }) => name)).toEqual([
      'get_service_status',
      'get_service_status'
    ]);
    expect(harness.model.requests[1]?.messages.at(-1)?.content).toHaveLength(2);
    expect(result.assistantText).toContain('degraded');

    const blocked = createHarness([
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'read-1',
              name: 'get_service_status',
              input: { serviceId: 'learning-hub' }
            },
            {
              type: 'tool_use',
              id: 'write-1',
              name: 'cancel_support_request',
              input: { requestId: 'req-alex-001' }
            }
          ]
        }
      },
      text('I must request the change separately.')
    ]);
    const blockedResult = await blocked.orchestrator.chat(context, 'Check and cancel');
    expect(blocked.executor.calls).toHaveLength(0);
    expect(blockedResult.approval).toBeUndefined();
  });

  it('stops a write tool for approval and executes only the stored proposal after approval', async () => {
    const args = {
      category: 'network',
      title: 'VPN unavailable',
      description: 'I cannot connect to the VPN.',
      severity: 'high',
      idempotencyKey: 'vpn-approval-1'
    };
    const harness = createHarness([
      tool('create_support_request', args),
      text('Your support request was created successfully.')
    ]);
    const pending = await harness.orchestrator.chat(context, 'Create a VPN support request');
    expect(pending.approval).toMatchObject({
      tool: 'create_support_request',
      args: {
        category: args.category,
        title: args.title,
        description: args.description,
        severity: args.severity
      }
    });
    expect(pending.approval?.args).not.toHaveProperty('idempotencyKey');
    expect(harness.executor.calls).toHaveLength(0);

    const completed = await harness.orchestrator.approve(context, pending.approval!.id);
    expect(harness.executor.calls).toHaveLength(1);
    expect(harness.executor.calls[0]?.args).toMatchObject({
      category: args.category,
      title: args.title,
      description: args.description,
      severity: args.severity
    });
    const idempotencyKey = harness.executor.calls[0]?.args.idempotencyKey;
    expect(typeof idempotencyKey).toBe('string');
    expect(idempotencyKey).toMatch(/^workspace-/);
    expect(idempotencyKey).not.toBe(args.idempotencyKey);
    expect(completed.assistantText).toContain('created successfully');
    await expect(harness.orchestrator.approve(context, pending.approval!.id)).rejects.toThrow(
      ApprovalError
    );
    expect(harness.executor.calls).toHaveLength(1);
  });

  it('returns rejection to the model and never executes the proposed write', async () => {
    const harness = createHarness([tool('cancel_support_request', { requestId: 'req-alex-001' })]);
    const pending = await harness.orchestrator.chat(context, 'Cancel my request');
    const rejected = await harness.orchestrator.reject(context, pending.approval!.id);
    expect(rejected.assistantText).toBe('Cancelled. No changes were made to CampusOps.');
    expect(harness.executor.calls).toHaveLength(0);
    expect(harness.model.requests).toHaveLength(1);
  });

  it('does not consume an approval when the conversation pending ID mismatches', async () => {
    const harness = createHarness([
      tool('create_support_request', {
        category: 'network',
        title: 'VPN unavailable',
        description: 'I cannot connect to the VPN.',
        severity: 'high'
      }),
      text('Your support request was created successfully.')
    ]);
    const pending = await harness.orchestrator.chat(context, 'Create a VPN support request');
    const conversation = harness.conversations.get(
      pending.conversationId,
      context.userId,
      context.sessionId
    );
    conversation.pendingApprovalId = 'stale-approval-id';
    harness.conversations.save(conversation);

    await expect(harness.orchestrator.approve(context, pending.approval!.id)).rejects.toThrow(
      ApprovalError
    );
    expect(harness.executor.calls).toHaveLength(0);
    expect(
      harness.approvals.validatePending(pending.approval!.id, context.userId, context.sessionId)
        .status
    ).toBe('pending');

    conversation.pendingApprovalId = pending.approval!.id;
    harness.conversations.save(conversation);
    await harness.orchestrator.approve(context, pending.approval!.id);
    expect(harness.executor.calls).toHaveLength(1);
  });

  it('does not reject an approval when the conversation pending ID mismatches', async () => {
    const harness = createHarness([tool('cancel_support_request', { requestId: 'req-alex-001' })]);
    const pending = await harness.orchestrator.chat(context, 'Cancel my request');
    const conversation = harness.conversations.get(
      pending.conversationId,
      context.userId,
      context.sessionId
    );
    conversation.pendingApprovalId = 'stale-approval-id';
    harness.conversations.save(conversation);

    expect(() => harness.orchestrator.reject(context, pending.approval!.id)).toThrow(ApprovalError);
    expect(
      harness.approvals.validatePending(pending.approval!.id, context.userId, context.sessionId)
        .status
    ).toBe('pending');

    conversation.pendingApprovalId = pending.approval!.id;
    harness.conversations.save(conversation);
    const rejected = await harness.orchestrator.reject(context, pending.approval!.id);
    expect(rejected.assistantText).toContain('No changes');
    expect(harness.executor.calls).toHaveLength(0);
  });

  it('blocks malformed and unknown model requests without calling MCP', async () => {
    const malformed = createHarness([
      tool('get_service_status', {}),
      text('I could not validate that request.')
    ]);
    expect((await malformed.orchestrator.chat(context, 'Check it')).assistantText).toContain(
      'could not validate'
    );
    expect(malformed.executor.calls).toHaveLength(0);

    const unknown = createHarness([
      tool('delete_everything', {}),
      text('That tool is unavailable.')
    ]);
    expect(
      (await unknown.orchestrator.chat(context, 'Do something unsafe')).assistantText
    ).toContain('unavailable');
    expect(unknown.executor.calls).toHaveLength(0);
    expect(unknown.diagnostics.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'model_tool_request', tool: 'unknown_tool' })
      ])
    );
  });

  it('does not let model text grant approval for a write', async () => {
    const model = new QueueModel([
      {
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I approve this myself.' },
            {
              type: 'tool_use',
              id: 'write-1',
              name: 'cancel_support_request',
              input: { requestId: 'req-alex-001' }
            }
          ]
        }
      }
    ]);
    const executor = new RecordingExecutor();
    const orchestrator = new CampusOpsOrchestrator(
      model,
      executor,
      new InMemoryConversationStore(),
      new InMemoryApprovalStore(),
      new InMemoryDiagnosticSink()
    );
    const result = await orchestrator.chat(context, 'Cancel my request');
    expect(result.approval?.tool).toBe('cancel_support_request');
    expect(executor.calls).toHaveLength(0);
  });

  it('does not expose or execute tools outside the authenticated scope set', async () => {
    const harness = createHarness([
      tool('cancel_support_request', { requestId: 'req-alex-001' }),
      text('That action is not available.')
    ]);
    const readOnlyContext = { ...context, scopes: ['requests:read'] as const };
    const result = await harness.orchestrator.chat(readOnlyContext, 'Cancel my request');
    expect(result.approval).toBeUndefined();
    expect(harness.executor.calls).toHaveLength(0);
    expect(harness.model.requests[0]?.tools.map(({ name }) => name)).not.toContain(
      'cancel_support_request'
    );
  });

  it('removes model thinking tags from the user-facing response', async () => {
    const harness = createHarness([
      text('<thinking>Private scratch work</thinking>\nThe service is operational.')
    ]);
    const result = await harness.orchestrator.chat(context, 'Check service status');
    expect(result.assistantText).toBe('The service is operational.');
    expect(result.assistantText).not.toContain('scratch');
  });
});
