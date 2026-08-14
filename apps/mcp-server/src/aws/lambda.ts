import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2
} from 'aws-lambda';
import { loadAwsRuntimeConfig } from '@campusops/aws';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createMcpServer } from '../mcp.js';
import { OriginRejectedError, validateOrigin } from './origin.js';
import { principalFromApiGatewayClaims } from './principal.js';
import { createAwsDependencies } from './runtime.js';

import type { AwsRuntimeConfig } from '@campusops/aws';
import type { Dependencies } from '../application.js';

const correlationId = (headers: Record<string, string | undefined>): string | undefined => {
  const candidate = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === 'x-campusops-correlation-id'
  )?.[1];
  return candidate &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : undefined;
};

export const createLambdaHandler =
  (config: AwsRuntimeConfig, dependencies: Dependencies) =>
  async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      validateOrigin(event.headers.origin, config.ALLOWED_ORIGINS);
      const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
      const principal = principalFromApiGatewayClaims(claims, event.requestContext.requestId);
      if (event.requestContext.http.method === 'GET') {
        return response(405, 'GET stream/SSE is not supported in Phase 2', {
          allow: 'POST',
          'content-type': 'text/plain'
        });
      }
      if (event.requestContext.http.method !== 'POST') return response(405, 'Method not allowed');

      const requestHeaders = new Headers();
      for (const [name, value] of Object.entries(event.headers)) {
        if (value !== undefined) requestHeaders.set(name, value);
      }
      const request = new Request(`https://${event.requestContext.domainName}${event.rawPath}`, {
        method: 'POST',
        headers: requestHeaders,
        ...(event.body
          ? { body: event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body }
          : {})
      });
      const mcp = createMcpHandler(() =>
        createMcpServer(dependencies, principal, correlationId(event.headers))
      );
      const result = await mcp.fetch(request);
      const headers: Record<string, string> = {};
      result.headers.forEach((value, name) => (headers[name] = value));
      return {
        statusCode: result.status,
        headers,
        body: await result.text(),
        isBase64Encoded: false
      };
    } catch (error) {
      if (error instanceof OriginRejectedError) return response(403, 'Origin not allowed');
      console.error(
        JSON.stringify({
          requestId: event.requestContext.requestId,
          operation: 'lambda_request',
          result: 'error',
          environment: config.ENVIRONMENT
        })
      );
      return response(500, JSON.stringify({ error: 'internal_error' }), {
        'content-type': 'application/json'
      });
    }
  };

const response = (
  statusCode: number,
  body: string,
  headers: Record<string, string> = { 'content-type': 'text/plain' }
): APIGatewayProxyStructuredResultV2 => ({ statusCode, headers, body, isBase64Encoded: false });

let cachedHandler: ReturnType<typeof createLambdaHandler> | undefined;
export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  if (!cachedHandler) {
    const config = loadAwsRuntimeConfig();
    cachedHandler = createLambdaHandler(config, createAwsDependencies(config));
  }
  return cachedHandler(event);
}
