import { createServer, type Server } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler, type NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import { InMemoryAuditSink } from '@campusops/audit';
import {
  AuthenticationError,
  bearerToken,
  LocalJwtAuth,
  type Principal,
  type TokenVerifier
} from '@campusops/auth';
import { loadConfig } from '@campusops/config';
import { createDependencies, type Dependencies } from './application.js';
import { createMcpServer } from './mcp.js';

const correlationId = (value: string | string[] | undefined): string | undefined => {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : undefined;
};

export interface HttpRuntime {
  server: Server;
  dependencies: Dependencies;
  url: string;
  close(): Promise<void>;
}

export async function startHttpServer(options: {
  host?: string;
  port?: number;
  verifier: TokenVerifier;
  dependencies?: Dependencies;
}): Promise<HttpRuntime> {
  const host = options.host ?? '127.0.0.1';
  const dependencies = options.dependencies ?? createDependencies(new InMemoryAuditSink());
  const server = createServer(async (request, response) => {
    if (request.url !== '/mcp') {
      response.writeHead(404).end('Not found');
      return;
    }
    try {
      const principal = await options.verifier.verify(
        bearerToken(request.headers.authorization ?? null)
      );
      const handler = createMcpHandler(() =>
        createMcpServer(
          dependencies,
          principal,
          correlationId(request.headers['x-campusops-correlation-id'])
        )
      );
      await toNodeHandler(handler)(request as unknown as NodeIncomingMessageLike, response);
    } catch (error) {
      if (!response.headersSent) {
        const status = error instanceof AuthenticationError ? 401 : 500;
        response.writeHead(status, {
          'content-type': 'application/json',
          ...(status === 401 ? { 'www-authenticate': 'Bearer realm="campusops-local"' } : {})
        });
        response.end(
          JSON.stringify({ error: status === 401 ? 'invalid_token' : 'internal_error' })
        );
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return {
    server,
    dependencies,
    url: `http://${host}:${address.port}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const auth = new LocalJwtAuth(config.JWT_SECRET);
  const runtime = await startHttpServer({ host: config.HOST, port: config.PORT, verifier: auth });
  process.stdout.write(`CampusOps MCP Gateway listening on ${runtime.url}\n`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) void main();

export const localDevelopmentPrincipal: Principal = {
  userId: 'user-alex',
  sessionId: 'local-development-session',
  scopes: ['policies:read', 'services:read', 'requests:read', 'requests:write']
};
