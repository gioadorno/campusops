import { EXPECTED_TOOL_COUNT, validateDeployedMcp } from './aws-smoke-lib.js';

const endpoint = process.env.MCP_URL;
const token = process.env.MCP_TOKEN;
if (!endpoint || !token) throw new Error('Set MCP_URL and MCP_TOKEN');
await validateDeployedMcp(endpoint, token);
process.stdout.write(`AWS MCP smoke test passed: ${EXPECTED_TOOL_COUNT} tools available.\n`);
