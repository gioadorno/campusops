import { describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { InMemoryAuditSink } from '@campusops/audit';
import type { AwsRuntimeConfig } from '@campusops/aws';
import { CampusOpsService, createDependencies } from '../src/application.js';
import { auditEventToItem, DynamoDbAuditSink } from '../src/aws/audit.js';
import { createLambdaHandler } from '../src/aws/lambda.js';
import { OriginRejectedError, validateOrigin } from '../src/aws/origin.js';
import { principalFromApiGatewayClaims } from '../src/aws/principal.js';
import {
  DynamoDbServiceRepository,
  DynamoDbSupportRequestRepository,
  supportRequestFromItem,
  supportRequestToItem
} from '../src/aws/repositories.js';
import { IdempotencyConflictError } from '../src/errors.js';

const request = {
  id: 'req-1',
  userId: 'user-1',
  category: 'network',
  title: 'Wi-Fi',
  description: 'Fictional Wi-Fi issue.',
  severity: 'medium',
  status: 'open',
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z'
} as const;
const input = {
  category: request.category,
  title: request.title,
  description: request.description,
  severity: request.severity,
  idempotencyKey: 'key-1'
} as const;

const client = (...responses: unknown[]) => {
  const send = vi.fn();
  for (const response of responses) send.mockResolvedValueOnce(response);
  return { value: { send } as unknown as DynamoDBDocumentClient, send };
};

describe('AWS identity and origin boundary', () => {
  it('maps supported Cognito scopes and ignores unsupported scopes', () => {
    expect(
      principalFromApiGatewayClaims(
        {
          sub: 'subject-1',
          scope: 'campusops/policies.read unknown/scope campusops/requests.write'
        },
        'request-1'
      )
    ).toEqual({
      userId: 'subject-1',
      sessionId: 'request-1',
      scopes: ['policies:read', 'requests:write']
    });
  });

  it('rejects missing subjects and malformed scope claims', () => {
    expect(() => principalFromApiGatewayClaims({ scope: '' }, 'request-1')).toThrow();
    expect(() =>
      principalFromApiGatewayClaims({ sub: 'x', scope: ['bad'] }, 'request-1')
    ).toThrow();
  });

  it('allows absent/allow-listed origins and rejects other origins', () => {
    expect(() => validateOrigin(undefined, ['https://allowed.test'])).not.toThrow();
    expect(() => validateOrigin('https://allowed.test', ['https://allowed.test'])).not.toThrow();
    expect(() => validateOrigin('https://evil.test', ['https://allowed.test'])).toThrow(
      OriginRejectedError
    );
  });
});

describe('DynamoDB adapters', () => {
  it('round-trips support request mappings and lists by authenticated user', async () => {
    expect(supportRequestFromItem(supportRequestToItem(request))).toEqual(request);
    const mock = client({ Items: [supportRequestToItem(request)] });
    const repository = new DynamoDbSupportRequestRepository(mock.value, 'table');
    await expect(repository.listForUser('user-1', undefined, 20)).resolves.toEqual([request]);
    const command = mock.send.mock.calls[0]?.[0] as QueryCommand;
    expect(command.input).toMatchObject({
      IndexName: 'GSI1',
      ExpressionAttributeValues: { ':pk': 'USER#user-1' }
    });
  });

  it('paginates filtered user requests until it collects the requested matches', async () => {
    const laterMatch = { ...request, id: 'req-2', status: 'closed' as const };
    const mock = client(
      { Items: [], LastEvaluatedKey: { GSI1PK: 'USER#user-1', GSI1SK: 'page-1' } },
      { Items: [supportRequestToItem(laterMatch)] }
    );
    const repository = new DynamoDbSupportRequestRepository(mock.value, 'table');

    await expect(repository.listForUser('user-1', 'closed', 1)).resolves.toEqual([laterMatch]);
    expect(mock.send).toHaveBeenCalledTimes(2);
    const second = mock.send.mock.calls[1]?.[0] as QueryCommand;
    expect(second.input.ExclusiveStartKey).toEqual({
      GSI1PK: 'USER#user-1',
      GSI1SK: 'page-1'
    });
  });

  it('returns the durable original for an identical idempotent payload', async () => {
    const fingerprint = (await import('../src/repositories.js')).supportRequestFingerprint(input);
    const mock = client(
      { Item: { fingerprint, requestId: request.id } },
      { Item: supportRequestToItem(request) }
    );
    const repository = new DynamoDbSupportRequestRepository(mock.value, 'table');
    await expect(repository.create('user-1', input)).resolves.toEqual({ request, created: false });
  });

  it('rejects conflicting durable idempotency payloads', async () => {
    const mock = client({ Item: { fingerprint: 'different', requestId: request.id } });
    await expect(
      new DynamoDbSupportRequestRepository(mock.value, 'table').create('user-1', input)
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('resolves a transaction race by consistently reading the winner', async () => {
    const race = Object.assign(new Error('race'), { name: 'TransactionCanceledException' });
    const fingerprint = (await import('../src/repositories.js')).supportRequestFingerprint(input);
    const mock = client(
      {},
      Promise.reject(race),
      { Item: { fingerprint, requestId: request.id } },
      { Item: supportRequestToItem(request) }
    );
    const repository = new DynamoDbSupportRequestRepository(mock.value, 'table');
    await expect(repository.create('user-1', input)).resolves.toMatchObject({
      created: false,
      request
    });
  });

  it('maps service reads and serializes only the safe audit contract', async () => {
    const serviceItem = {
      PK: 'SERVICE#learning-hub',
      SK: 'META',
      serviceId: 'learning-hub',
      name: 'Learning Hub',
      status: 'operational',
      message: 'OK',
      updatedAt: 'now'
    };
    const serviceMock = client({ Item: serviceItem });
    await expect(
      new DynamoDbServiceRepository(serviceMock.value, 'table').find('learning-hub')
    ).resolves.toMatchObject({ serviceId: 'learning-hub' });
    const event = {
      eventId: 'event-1',
      traceId: 'trace-1',
      userId: 'user-1',
      sessionId: 'request-1',
      action: 'read',
      tool: 'get_service_status',
      authorizationDecision: 'allow',
      requiredScopes: ['services:read'],
      durationMs: 1,
      result: 'success',
      timestamp: 'now'
    } as const;
    expect(auditEventToItem(event)).not.toHaveProperty('description');
    const auditMock = client({});
    await new DynamoDbAuditSink(auditMock.value, 'audit', 'test').write(event);
    expect(auditMock.send).toHaveBeenCalledOnce();
  });

  it('preserves application behavior across in-memory and AWS repository adapters', async () => {
    const localDependencies = createDependencies(new InMemoryAuditSink());
    const expected = await new CampusOpsService(localDependencies).getServiceStatus(
      {
        principal: {
          userId: 'user-1',
          sessionId: 'local',
          scopes: ['services:read']
        }
      },
      'learning-hub'
    );
    const serviceMock = client({
      Item: {
        PK: 'SERVICE#learning-hub',
        SK: 'META',
        entityType: 'ServiceStatus',
        ...expected
      }
    });
    const awsService = new CampusOpsService({
      ...localDependencies,
      services: new DynamoDbServiceRepository(serviceMock.value, 'table')
    });
    await expect(
      awsService.getServiceStatus(
        {
          principal: {
            userId: 'user-1',
            sessionId: 'aws',
            scopes: ['services:read']
          }
        },
        'learning-hub'
      )
    ).resolves.toEqual(expected);
  });
});

const config: AwsRuntimeConfig = {
  CAMPUSOPS_RUNTIME: 'aws',
  AWS_REGION: 'us-west-2',
  CAMPUSOPS_TABLE_NAME: 'table',
  CAMPUSOPS_AUDIT_TABLE_NAME: 'audit',
  COGNITO_USER_POOL_ID: 'pool',
  COGNITO_CLIENT_ID: 'client',
  ALLOWED_ORIGINS: ['https://allowed.test'],
  ENVIRONMENT: 'test',
  IDEMPOTENCY_TTL_SECONDS: 86400
};
const event = (method: string, overrides: Partial<APIGatewayProxyEventV2WithJWTAuthorizer> = {}) =>
  ({
    version: '2.0',
    routeKey: `${method} /mcp`,
    rawPath: '/mcp',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '1',
      apiId: 'api',
      domainName: 'api.test',
      domainPrefix: 'api',
      http: {
        method,
        path: '/mcp',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test'
      },
      requestId: 'request-1',
      routeKey: `${method} /mcp`,
      stage: '$default',
      time: '',
      timeEpoch: 0,
      authorizer: {
        jwt: {
          claims: { sub: 'user-1', scope: 'campusops/policies.read' },
          scopes: ['campusops/policies.read']
        }
      }
    },
    isBase64Encoded: false,
    ...overrides
  }) as APIGatewayProxyEventV2WithJWTAuthorizer;

describe('Lambda MCP adapter', () => {
  const handler = createLambdaHandler(config, createDependencies(new InMemoryAuditSink()));
  it('returns 405 for authenticated GET without opening SSE', async () => {
    await expect(handler(event('GET'))).resolves.toMatchObject({
      statusCode: 405,
      headers: { allow: 'POST' }
    });
  });
  it('handles stateless MCP POST and preserves protocol response headers', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' }
      }
    });
    const result = await handler(
      event('POST', {
        body,
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-06-18'
        }
      })
    );
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('campusops-mcp-gateway');
  });
  it('normalizes malformed AWS identity errors', async () => {
    const malformed = event('POST');
    malformed.requestContext.authorizer.jwt.claims = {};
    await expect(handler(malformed)).resolves.toMatchObject({
      statusCode: 500,
      body: '{"error":"internal_error"}'
    });
  });
});
