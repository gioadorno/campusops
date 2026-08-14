import { withAuthenticatedMcpClient } from './client.js';

const url = new URL(process.env.MCP_URL ?? 'http://127.0.0.1:3000/mcp');
const token = process.env.MCP_TOKEN;
if (!token) throw new Error('Set MCP_TOKEN to a local bearer token');

await withAuthenticatedMcpClient({
  endpoint: url.toString(),
  accessToken: token,
  operation: async (client) => {
    process.stdout.write(`${JSON.stringify(await client.listTools(), null, 2)}\n`);
  }
});
