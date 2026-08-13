import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = new URL(process.env.MCP_URL ?? 'http://127.0.0.1:3000/mcp');
const token = process.env.MCP_TOKEN;
if (!token) throw new Error('Set MCP_TOKEN to a local bearer token');

const client = new Client(
  { name: 'campusops-contract-client', version: '0.1.0' },
  { versionNegotiation: { mode: 'auto' } }
);
await client.connect(
  new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  })
);
process.stdout.write(`${JSON.stringify(await client.listTools(), null, 2)}\n`);
await client.close();
