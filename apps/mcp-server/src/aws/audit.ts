import { PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { AuditEvent, AuditSink } from '@campusops/audit';

export const auditEventToItem = (event: AuditEvent) => ({
  PK: `TRACE#${event.traceId}`,
  SK: `${event.timestamp}#EVENT#${event.eventId}`,
  GSI1PK: `USER#${event.userId}`,
  GSI1SK: `${event.timestamp}#EVENT#${event.eventId}`,
  entityType: 'AuditEvent',
  ...event
});

export class DynamoDbAuditSink implements AuditSink {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly environment: string
  ) {}

  async write(event: AuditEvent): Promise<void> {
    await this.client.send(
      new PutCommand({ TableName: this.tableName, Item: auditEventToItem(event) })
    );
    console.log(
      JSON.stringify({
        requestId: event.sessionId,
        traceId: event.traceId,
        operation: event.tool,
        result: event.result,
        durationMs: event.durationMs,
        authorizationDecision: event.authorizationDecision,
        ...(event.denialReason ? { denialReason: event.denialReason } : {}),
        environment: this.environment
      })
    );
  }
}
