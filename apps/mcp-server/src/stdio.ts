import { InMemoryAuditSink } from '@campusops/audit';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createDependencies } from './application.js';
import { localDevelopmentPrincipal } from './http.js';
import { createMcpServer } from './mcp.js';

const dependencies = createDependencies(new InMemoryAuditSink());
serveStdio(() => createMcpServer(dependencies, localDevelopmentPrincipal));
