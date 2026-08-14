import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const expectedTools = [
  'cancel_support_request',
  'create_support_request',
  'get_service_status',
  'get_support_request',
  'list_support_requests',
  'search_policies'
] as const;

const redact = (value: string): string =>
  value
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:code|state|code_verifier|code_challenge)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_TOKEN]');

export const safeErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return redact(error.message);
  return 'Unknown error';
};

export async function validateDeployedMcp(
  endpoint: string,
  accessToken: string
): Promise<string[]> {
  const client = new Client({ name: 'campusops-aws-smoke', version: '0.2.0' });
  let httpFailure: { status: number; requestId?: string } | undefined;
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          if (!response.ok) {
            const requestId = response.headers.get('x-amzn-requestid') ?? undefined;
            httpFailure = { status: response.status, ...(requestId ? { requestId } : {}) };
          }
          return response;
        }
      })
    );
    const result = await client.listTools();
    const names = result.tools.map(({ name }) => name).sort();
    const missing = expectedTools.filter((name) => !names.includes(name));
    if (names.length !== expectedTools.length || missing.length > 0) {
      throw new Error(
        `Expected ${expectedTools.length} tools; received ${names.length}; missing: ${missing.join(', ') || 'none'}`
      );
    }
    return names;
  } catch (error) {
    const gateway = httpFailure
      ? ` API Gateway HTTP ${httpFailure.status}${httpFailure.requestId ? ` request ${httpFailure.requestId}` : ''};`
      : '';
    throw new Error(`MCP protocol validation failed:${gateway} ${safeErrorMessage(error)}`, {
      cause: error
    });
  } finally {
    await client.close().catch(() => undefined);
  }
}

export const EXPECTED_TOOL_COUNT = expectedTools.length;
