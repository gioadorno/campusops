import { randomUUID } from 'node:crypto';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient
} from '@aws-sdk/lib-dynamodb';
import type {
  CreateSupportRequestInput,
  ServiceStatus,
  SupportRequest
} from '@campusops/contracts';
import { IdempotencyConflictError, NotFoundError } from '../errors.js';
import {
  supportRequestFingerprint,
  type ServiceRepository,
  type SupportRequestRepository
} from '../repositories.js';

type Item = Record<string, unknown>;

export const supportRequestToItem = (request: SupportRequest): Item => ({
  PK: `REQUEST#${request.id}`,
  SK: 'META',
  GSI1PK: `USER#${request.userId}`,
  GSI1SK: `CREATED#${request.createdAt}#REQUEST#${request.id}`,
  entityType: 'SupportRequest',
  ...request
});

export const supportRequestFromItem = (item: Item): SupportRequest => ({
  id: String(item.id),
  userId: String(item.userId),
  category: String(item.category),
  title: String(item.title),
  description: String(item.description),
  severity: item.severity as SupportRequest['severity'],
  status: item.status as SupportRequest['status'],
  createdAt: String(item.createdAt),
  updatedAt: String(item.updatedAt)
});

const serviceFromItem = (item: Item): ServiceStatus => ({
  serviceId: String(item.serviceId),
  name: String(item.name),
  status: item.status as ServiceStatus['status'],
  message: String(item.message),
  updatedAt: String(item.updatedAt)
});

export class DynamoDbSupportRequestRepository implements SupportRequestRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly ttlSeconds = 86400
  ) {}

  async listForUser(userId: string, status: SupportRequest['status'] | undefined, limit: number) {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ...(status ? { ':status': status } : {})
        },
        ...(status
          ? {
              FilterExpression: '#status = :status',
              ExpressionAttributeNames: { '#status': 'status' }
            }
          : {}),
        ScanIndexForward: false,
        Limit: limit
      })
    );
    return (response.Items ?? []).map((item) => supportRequestFromItem(item));
  }

  async find(requestId: string) {
    const response = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: `REQUEST#${requestId}`, SK: 'META' } })
    );
    return response.Item ? supportRequestFromItem(response.Item) : undefined;
  }

  async create(userId: string, input: CreateSupportRequestInput) {
    const key = { PK: `IDEMPOTENCY#${userId}#${input.idempotencyKey}`, SK: 'META' };
    const payloadFingerprint = supportRequestFingerprint(input);
    const existing = await this.readIdempotency(key);
    if (existing) return this.resolveExisting(existing, payloadFingerprint);

    const now = new Date().toISOString();
    const request: SupportRequest = {
      id: `req-${randomUUID()}`,
      userId,
      category: input.category,
      title: input.title,
      description: input.description,
      severity: input.severity,
      status: 'open',
      createdAt: now,
      updatedAt: now
    };
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  ...key,
                  entityType: 'Idempotency',
                  fingerprint: payloadFingerprint,
                  requestId: request.id,
                  createdAt: now,
                  expiresAt: Math.floor(Date.now() / 1000) + this.ttlSeconds
                },
                ConditionExpression: 'attribute_not_exists(PK)'
              }
            },
            {
              Put: {
                TableName: this.tableName,
                Item: supportRequestToItem(request),
                ConditionExpression: 'attribute_not_exists(PK)'
              }
            }
          ]
        })
      );
      return { request, created: true };
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      const winner = await this.readIdempotency(key, true);
      if (!winner) throw error;
      return this.resolveExisting(winner, payloadFingerprint);
    }
  }

  async save(request: SupportRequest) {
    await this.client.send(
      new PutCommand({ TableName: this.tableName, Item: supportRequestToItem(request) })
    );
  }

  categories() {
    return ['accounts', 'accessibility', 'devices', 'network', 'software'];
  }

  async countForUser(userId: string) {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `USER#${userId}` },
        Select: 'COUNT'
      })
    );
    return response.Count ?? 0;
  }

  private async readIdempotency(key: Item, consistent = false): Promise<Item | undefined> {
    const response = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: consistent })
    );
    return response.Item;
  }

  private async resolveExisting(item: Item, fingerprint: string) {
    if (item.fingerprint !== fingerprint) throw new IdempotencyConflictError();
    const request = await this.find(String(item.requestId));
    if (!request) throw new NotFoundError('Idempotent support request');
    return { request, created: false };
  }
}

export class DynamoDbServiceRepository implements ServiceRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  async find(serviceId: string) {
    const response = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: `SERVICE#${serviceId}`, SK: 'META' } })
    );
    return response.Item ? serviceFromItem(response.Item) : undefined;
  }

  async all() {
    const response = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'entityType = :type',
        ExpressionAttributeValues: { ':type': 'ServiceStatus' }
      })
    );
    return (response.Items ?? []).map(serviceFromItem);
  }
}

const isTransactionConflict = (error: unknown): boolean =>
  error instanceof Error &&
  ['TransactionCanceledException', 'ConditionalCheckFailedException'].includes(error.name);
