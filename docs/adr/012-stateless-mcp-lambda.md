# ADR 012: Stateless MCP on Lambda without SSE

- Status: Accepted
- Date: 2026-08-13

Lambda adapts API Gateway events directly to the MCP SDK fetch handler and never opens a Node listener. `POST /mcp` supports stateless Streamable HTTP and protocol headers. Authenticated `GET /mcp` returns 405; Phase 2 has no server-initiated SSE, resumability, or sessionful transport.
