import { randomUUID } from 'node:crypto';
import type { Scope } from '@campusops/contracts';

export interface AuditEvent {
  eventId: string;
  traceId: string;
  userId: string;
  sessionId: string;
  action: string;
  tool: string;
  authorizationDecision: 'allow' | 'deny';
  denialReason?: 'scope' | 'ownership';
  requiredScopes: readonly Scope[];
  durationMs: number;
  result: 'success' | 'error' | 'denied';
  timestamp: string;
}

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
}

export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  write(event: AuditEvent): Promise<void> {
    this.events.push(Object.freeze({ ...event }));
    return Promise.resolve();
  }
}

export function newAuditEvent(input: Omit<AuditEvent, 'eventId' | 'timestamp'>): AuditEvent {
  return { eventId: randomUUID(), timestamp: new Date().toISOString(), ...input };
}
