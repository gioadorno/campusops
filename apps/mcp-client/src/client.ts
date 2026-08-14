import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export interface AuthenticatedMcpConnection {
  listTools(): ReturnType<Client['listTools']>;
  callTool(request: Parameters<Client['callTool']>[0]): ReturnType<Client['callTool']>;
}

export class McpClientError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number,
    public readonly requestId?: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'McpClientError';
  }
}

export class McpToolError extends Error {
  constructor() {
    super('CampusOps tool returned an error');
    this.name = 'McpToolError';
  }
}

export async function withAuthenticatedMcpClient<T>(options: {
  endpoint: string;
  accessToken: string;
  correlationId?: string;
  onHttpResponse?(response: Response): void;
  operation(client: AuthenticatedMcpConnection): Promise<T>;
}): Promise<T> {
  const client = new Client(
    { name: 'campusops-authenticated-client', version: '0.3.0' },
    { versionNegotiation: { mode: 'auto' } }
  );
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(options.endpoint), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${options.accessToken}`,
            ...(options.correlationId
              ? { 'x-campusops-correlation-id': options.correlationId }
              : {})
          }
        },
        ...(options.onHttpResponse
          ? {
              fetch: async (input, init) => {
                const response = await fetch(input, init);
                options.onHttpResponse?.(response);
                return response;
              }
            }
          : {})
      })
    );
    return await options.operation(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function callAuthenticatedTool(options: {
  endpoint: string;
  accessToken: string;
  correlationId: string;
  name: string;
  args: Record<string, unknown>;
}): Promise<unknown> {
  let httpFailure: { status: number; requestId?: string } | undefined;
  try {
    return await withAuthenticatedMcpClient({
      ...options,
      onHttpResponse: (response) => {
        if (!response.ok) {
          const requestId = response.headers.get('x-amzn-requestid') ?? undefined;
          httpFailure = {
            status: response.status,
            ...(requestId ? { requestId } : {})
          };
        }
      },
      operation: async (client) => {
        const result = await client.callTool({ name: options.name, arguments: options.args });
        const text = result.content
          .filter(
            (item): item is Extract<(typeof result.content)[number], { type: 'text' }> =>
              item.type === 'text'
          )
          .map((item) => item.text)
          .join('\n');
        if (result.isError) throw new McpToolError();
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      }
    });
  } catch (error) {
    if (error instanceof McpToolError) throw error;
    throw new McpClientError(
      httpFailure ? 'MCP gateway rejected the request' : 'MCP protocol request failed',
      httpFailure?.status,
      httpFailure?.requestId,
      { cause: error }
    );
  }
}
