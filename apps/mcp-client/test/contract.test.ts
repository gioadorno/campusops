import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { InMemoryAuditSink } from '@campusops/audit';
import { LocalJwtAuth, type Principal } from '@campusops/auth';
import { createDependencies } from '../../mcp-server/src/application.js';
import { startHttpServer, type HttpRuntime } from '../../mcp-server/src/http.js';

const secret = 'contract-test-secret-that-is-more-than-32-characters';
const correlationId = '6e3ae64f-e0c7-4fc8-91b8-1dc62a7e3ff1';
const fullPrincipal: Principal = {
  userId: 'user-alex',
  sessionId: 'contract-session-alex',
  scopes: ['policies:read', 'services:read', 'requests:read', 'requests:write']
};

const text = (result: Awaited<ReturnType<Client['callTool']>>) => {
  const item = result.content[0];
  if (!item || item.type !== 'text') throw new Error('Expected a text tool result');
  return JSON.parse(item.text) as Record<string, unknown> | unknown[];
};

const rawText = (result: Awaited<ReturnType<Client['callTool']>>) => {
  const item = result.content[0];
  if (!item || item.type !== 'text') throw new Error('Expected a text tool result');
  return item.text;
};

describe('MCP HTTP contract', () => {
  const auth = new LocalJwtAuth(secret);
  const audit = new InMemoryAuditSink();
  const dependencies = createDependencies(audit);
  let runtime: HttpRuntime;
  let client: Client;

  const connect = async (principal: Principal, traceId?: string) => {
    const token = await auth.issue(principal);
    const candidate = new Client(
      { name: 'campusops-test-client', version: '0.1.0' },
      { versionNegotiation: { mode: 'auto' } }
    );
    await candidate.connect(
      new StreamableHTTPClientTransport(new URL(runtime.url), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(traceId ? { 'x-campusops-correlation-id': traceId } : {})
          }
        }
      })
    );
    return candidate;
  };

  beforeAll(async () => {
    runtime = await startHttpServer({ verifier: auth, dependencies });
    client = await connect(fullPrincipal, correlationId);
  });

  afterAll(async () => {
    if (client) await client.close();
    if (runtime) await runtime.close();
  });

  it('discovers tools, resources, and prompts and reads one of each', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'search_policies',
        'get_service_status',
        'list_support_requests',
        'get_support_request',
        'create_support_request',
        'cancel_support_request'
      ])
    );
    const resources = await client.listResources();
    expect(resources.resources).toHaveLength(5);
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(
      expect.arrayContaining(['triage-support-request', 'policy-answer'])
    );
    for (const uri of [
      'policy://catalog',
      'policy://categories/security',
      'services://catalog',
      'support://categories',
      'platform://capabilities'
    ]) {
      const resource = await client.readResource({ uri });
      expect(resource.contents[0]).toMatchObject({ uri });
    }
    const prompt = await client.getPrompt({
      name: 'policy-answer',
      arguments: { question: 'How should accounts be protected?' }
    });
    expect(prompt.messages).toHaveLength(1);
  });

  it('calls every read-only tool', async () => {
    const calls = await Promise.all([
      client.callTool({ name: 'search_policies', arguments: { query: 'security' } }),
      client.callTool({ name: 'get_service_status', arguments: { serviceId: 'learning-hub' } }),
      client.callTool({ name: 'list_support_requests', arguments: {} }),
      client.callTool({ name: 'get_support_request', arguments: { requestId: 'req-alex-001' } })
    ]);
    expect(calls.every((call) => call.isError !== true)).toBe(true);
    expect(audit.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ traceId: correlationId })])
    );
  });

  it('creates once for duplicate idempotency calls and cancels the result', async () => {
    const args = {
      category: 'software',
      title: 'Fictional software issue',
      description: 'The fictional application does not launch.',
      severity: 'medium',
      idempotencyKey: 'contract-create-1'
    };
    const first = text(
      await client.callTool({ name: 'create_support_request', arguments: args })
    ) as {
      request: { id: string };
      created: boolean;
    };
    const second = text(
      await client.callTool({ name: 'create_support_request', arguments: args })
    ) as {
      request: { id: string };
      created: boolean;
    };
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, request: { id: first.request.id } });
    const conflict = await client.callTool({
      name: 'create_support_request',
      arguments: { ...args, description: 'Conflicting payload for the same key.' }
    });
    expect(conflict.isError).toBe(true);
    expect(rawText(conflict)).toBe('Idempotency key conflicts with an existing request');
    const cancelled = await client.callTool({
      name: 'cancel_support_request',
      arguments: { requestId: first.request.id }
    });
    expect(cancelled.isError).not.toBe(true);
  });

  it('returns normalized tool errors for unauthorized, missing, and ownership calls', async () => {
    const limited = await connect({
      userId: 'user-alex',
      sessionId: 'limited-session',
      scopes: ['requests:read']
    });
    const unauthorized = await limited.callTool({
      name: 'create_support_request',
      arguments: {
        category: 'network',
        title: 'Denied',
        description: 'Must not be created.',
        idempotencyKey: 'denied-contract'
      }
    });
    expect(unauthorized.isError).toBe(true);
    await limited.close();

    const ownership = await client.callTool({
      name: 'get_support_request',
      arguments: { requestId: 'req-blair-001' }
    });
    expect(ownership.isError).toBe(true);
    const missing = await client.callTool({
      name: 'get_support_request',
      arguments: { requestId: 'req-does-not-exist' }
    });
    expect(missing.isError).toBe(true);
    expect(rawText(ownership)).toBe('Resource not found or unavailable');
    expect(rawText(missing)).toBe(rawText(ownership));
    expect(audit.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authorizationDecision: 'deny',
          denialReason: 'scope',
          tool: 'create_support_request'
        }),
        expect.objectContaining({
          authorizationDecision: 'deny',
          denialReason: 'ownership',
          result: 'denied',
          tool: 'get_support_request'
        })
      ])
    );
  });
});
