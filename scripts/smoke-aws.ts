import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const endpoint = process.env.MCP_URL;
const token = process.env.MCP_TOKEN;
if (!endpoint || !token) throw new Error('Set MCP_URL and MCP_TOKEN');
const client = new Client({ name: 'campusops-aws-smoke', version: '0.2.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  })
);
const result = await client.listTools();
if (result.tools.length !== 6) throw new Error(`Expected 6 tools, received ${result.tools.length}`);
process.stdout.write('AWS MCP smoke test passed.\n');
await client.close();
