import { randomUUID } from 'node:crypto';
import type {
  CreateSupportRequestInput,
  Policy,
  ServiceStatus,
  SupportRequest
} from '@campusops/contracts';
import { initialSupportRequests, policies, services } from './data.js';

export class PolicyRepository {
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

  all(): readonly Policy[] {
    return policies;
  }
}

export class ServiceRepository {
  find(serviceId: string): ServiceStatus | undefined {
    return services.find((service) => service.serviceId === serviceId);
  }

  all(): readonly ServiceStatus[] {
    return services;
  }
}

export class SupportRequestRepository {
  private readonly records: SupportRequest[];
  private readonly idempotency = new Map<string, string>();

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
    const existingId = this.idempotency.get(key);
    if (existingId) return { request: this.find(existingId)!, created: false };
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
    this.idempotency.set(key, request.id);
    return { request, created: true };
  }

  save(request: SupportRequest): void {
    const index = this.records.findIndex((record) => record.id === request.id);
    if (index >= 0) this.records[index] = request;
  }

  countForUser(userId: string): number {
    return this.records.filter((record) => record.userId === userId).length;
  }
}
