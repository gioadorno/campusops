import { randomUUID } from 'node:crypto';
import { newAuditEvent, type AuditSink } from '@campusops/audit';
import { authorize, AuthorizationError, type Principal } from '@campusops/auth';
import type {
  CreateSupportRequestInput,
  ListSupportRequestsInput,
  Scope,
  SearchPoliciesInput
} from '@campusops/contracts';
import { ConflictError, NotFoundError, OwnershipError } from './errors.js';
import {
  InMemoryPolicyRepository,
  InMemoryServiceRepository,
  InMemorySupportRequestRepository,
  StaticPlatformCapabilitiesProvider,
  type PlatformCapabilitiesProvider,
  type PolicyRepository,
  type ServiceRepository,
  type SupportRequestRepository
} from './repositories.js';

export interface OperationContext {
  principal: Principal;
  traceId?: string;
}

export interface Dependencies {
  policies: PolicyRepository;
  services: ServiceRepository;
  support: SupportRequestRepository;
  capabilities: PlatformCapabilitiesProvider;
  audit: AuditSink;
}

export const createDependencies = (audit: AuditSink): Dependencies => ({
  policies: new InMemoryPolicyRepository(),
  services: new InMemoryServiceRepository(),
  support: new InMemorySupportRequestRepository(),
  capabilities: new StaticPlatformCapabilitiesProvider(),
  audit
});

export class CampusOpsService {
  constructor(private readonly dependencies: Dependencies) {}

  private async run<T>(
    context: OperationContext,
    action: string,
    operation: string,
    requiredScopes: readonly Scope[],
    fn: () => T | Promise<T>
  ): Promise<T> {
    const started = performance.now();
    let decision: 'allow' | 'deny' = 'allow';
    let result: 'success' | 'error' | 'denied' = 'success';
    let denialReason: 'scope' | 'ownership' | undefined;
    try {
      authorize(context.principal, requiredScopes);
      return await fn();
    } catch (error) {
      if (error instanceof AuthorizationError) {
        decision = 'deny';
        result = 'denied';
        denialReason = 'scope';
      } else if (error instanceof OwnershipError) {
        decision = 'deny';
        result = 'denied';
        denialReason = 'ownership';
      } else {
        result = 'error';
      }
      throw error;
    } finally {
      await this.dependencies.audit.write(
        newAuditEvent({
          traceId: context.traceId ?? randomUUID(),
          userId: context.principal.userId,
          sessionId: context.principal.sessionId,
          action,
          tool: operation,
          authorizationDecision: decision,
          ...(denialReason ? { denialReason } : {}),
          requiredScopes,
          durationMs: Math.max(0, performance.now() - started),
          result
        })
      );
    }
  }

  searchPolicies(context: OperationContext, input: SearchPoliciesInput) {
    return this.run(context, 'read', 'search_policies', ['policies:read'], () =>
      this.dependencies.policies.search(input.query, input.category, input.limit)
    );
  }

  getServiceStatus(context: OperationContext, serviceId: string) {
    return this.run(context, 'read', 'get_service_status', ['services:read'], async () => {
      const service = await this.dependencies.services.find(serviceId);
      if (!service) throw new NotFoundError('Service');
      return service;
    });
  }

  listSupportRequests(context: OperationContext, input: ListSupportRequestsInput) {
    return this.run(context, 'read', 'list_support_requests', ['requests:read'], () =>
      this.dependencies.support.listForUser(context.principal.userId, input.status, input.limit)
    );
  }

  getSupportRequest(context: OperationContext, requestId: string) {
    return this.run(context, 'read', 'get_support_request', ['requests:read'], async () => {
      const request = await this.dependencies.support.find(requestId);
      if (!request) throw new NotFoundError('Support request');
      if (request.userId !== context.principal.userId) throw new OwnershipError();
      return request;
    });
  }

  createSupportRequest(context: OperationContext, input: CreateSupportRequestInput) {
    return this.run(context, 'create', 'create_support_request', ['requests:write'], () =>
      this.dependencies.support.create(context.principal.userId, input)
    );
  }

  cancelSupportRequest(context: OperationContext, requestId: string) {
    return this.run(context, 'cancel', 'cancel_support_request', ['requests:write'], async () => {
      const request = await this.dependencies.support.find(requestId);
      if (!request) throw new NotFoundError('Support request');
      if (request.userId !== context.principal.userId) throw new OwnershipError();
      if (request.status === 'closed') throw new ConflictError('Support request is already closed');
      const cancelled = {
        ...request,
        status: 'closed' as const,
        updatedAt: new Date().toISOString()
      };
      await this.dependencies.support.save(cancelled);
      return cancelled;
    });
  }

  getPolicyCatalog(context: OperationContext) {
    return this.run(context, 'read_resource', 'policy://catalog', ['policies:read'], () =>
      this.dependencies.policies.catalog()
    );
  }

  getPoliciesByCategory(context: OperationContext, category: string) {
    return this.run(
      context,
      'read_resource',
      `policy://categories/${category}`,
      ['policies:read'],
      () => this.dependencies.policies.findByCategory(category)
    );
  }

  getServiceCatalog(context: OperationContext) {
    return this.run(context, 'read_resource', 'services://catalog', ['services:read'], () =>
      this.dependencies.services.all()
    );
  }

  getSupportCategories(context: OperationContext) {
    return this.run(context, 'read_resource', 'support://categories', ['requests:read'], () =>
      this.dependencies.support.categories()
    );
  }

  getPlatformCapabilities(context: OperationContext) {
    return this.run(context, 'read_resource', 'platform://capabilities', [], () =>
      this.dependencies.capabilities.get()
    );
  }

  getPrompt<T>(
    context: OperationContext,
    name: string,
    requiredScopes: readonly Scope[],
    value: T
  ) {
    return this.run(context, 'get_prompt', name, requiredScopes, () => value);
  }
}
