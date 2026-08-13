import { createHash, randomUUID } from 'node:crypto';
import type {
  CreateSupportRequestInput,
  Policy,
  ServiceStatus,
  SupportRequest
} from '@campusops/contracts';
import { initialSupportRequests, policies, services } from './data.js';
import { IdempotencyConflictError } from './errors.js';

export interface PolicyRepository {
  search(query: string, category: string | undefined, limit: number): MaybePromise<Policy[]>;
  catalog(): MaybePromise<readonly Omit<Policy, 'body'>[]>;
  findByCategory(category: string): MaybePromise<readonly Policy[]>;
}

export type MaybePromise<T> = T | Promise<T>;

export interface ServiceRepository {
  find(serviceId: string): MaybePromise<ServiceStatus | undefined>;
  all(): MaybePromise<readonly ServiceStatus[]>;
}

export interface SupportRequestRepository {
  listForUser(
    userId: string,
    status: SupportRequest['status'] | undefined,
    limit: number
  ): MaybePromise<SupportRequest[]>;
  find(requestId: string): MaybePromise<SupportRequest | undefined>;
  create(
    userId: string,
    input: CreateSupportRequestInput
  ): MaybePromise<{ request: SupportRequest; created: boolean }>;
  save(request: SupportRequest): MaybePromise<void>;
  categories(): MaybePromise<readonly string[]>;
  countForUser(userId: string): MaybePromise<number>;
}

export interface PlatformCapabilitiesProvider {
  get(): MaybePromise<
    Readonly<{
      tools: number;
      resources: number;
      prompts: number;
      transport: readonly string[];
    }>
  >;
}

export class StaticPlatformCapabilitiesProvider implements PlatformCapabilitiesProvider {
  get() {
    return {
      tools: 6,
      resources: 5,
      prompts: 2,
      transport: ['streamable-http', 'stdio'] as const
    };
  }
}

export class InMemoryPolicyRepository implements PolicyRepository {
  search(query: string, category: string | undefined, limit: number): Policy[] {
    const needle = query.toLocaleLowerCase();
    return policies
      .filter(
        (policy) =>
          (!category || policy.category === category) &&
          [policy.title, policy.summary, policy.body].some((value) =>
            value.toLocaleLowerCase().includes(needle)
          )
      )
      .slice(0, limit);
  }

  catalog(): readonly Omit<Policy, 'body'>[] {
    return policies.map(({ id, title, category, summary, updatedAt }) => ({
      id,
      title,
      category,
      summary,
      updatedAt
    }));
  }

  findByCategory(category: string): readonly Policy[] {
    return policies.filter((policy) => policy.category === category);
  }
}

export class InMemoryServiceRepository implements ServiceRepository {
  find(serviceId: string): ServiceStatus | undefined {
    return services.find((service) => service.serviceId === serviceId);
  }

  all(): readonly ServiceStatus[] {
    return services;
  }
}

interface IdempotencyRecord {
  requestId: string;
  fingerprint: string;
}

export const supportRequestFingerprint = (input: CreateSupportRequestInput): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        category: input.category,
        title: input.title,
        description: input.description,
        severity: input.severity
      })
    )
    .digest('hex');

export class InMemorySupportRequestRepository implements SupportRequestRepository {
  private readonly records: SupportRequest[];
  private readonly idempotency = new Map<string, IdempotencyRecord>();

  constructor(seed: readonly SupportRequest[] = initialSupportRequests) {
    this.records = seed.map((record) => ({ ...record }));
  }

  listForUser(userId: string, status: SupportRequest['status'] | undefined, limit: number) {
    return this.records
      .filter((record) => record.userId === userId && (!status || record.status === status))
      .slice(0, limit);
  }

  find(requestId: string): SupportRequest | undefined {
    return this.records.find((record) => record.id === requestId);
  }

  create(
    userId: string,
    input: CreateSupportRequestInput
  ): { request: SupportRequest; created: boolean } {
    const key = `${userId}:${input.idempotencyKey}`;
    const payloadFingerprint = supportRequestFingerprint(input);
    const existing = this.idempotency.get(key);
    if (existing) {
      if (existing.fingerprint !== payloadFingerprint) throw new IdempotencyConflictError();
      return { request: this.find(existing.requestId)!, created: false };
    }
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
    this.records.push(request);
    this.idempotency.set(key, { requestId: request.id, fingerprint: payloadFingerprint });
    return { request, created: true };
  }

  save(request: SupportRequest): void {
    const index = this.records.findIndex((record) => record.id === request.id);
    if (index >= 0) this.records[index] = request;
  }

  categories(): readonly string[] {
    return ['accounts', 'accessibility', 'devices', 'network', 'software'];
  }

  countForUser(userId: string): number {
    return this.records.filter((record) => record.userId === userId).length;
  }
}
