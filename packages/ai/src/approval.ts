import { createHash, randomUUID } from 'node:crypto';
import type { CampusOpsToolName } from './tools.js';

export type ApprovalStatus = 'pending' | 'executing' | 'completed' | 'rejected' | 'failed';

export interface ApprovalProposal {
  userId: string;
  sessionId: string;
  conversationId: string;
  toolUseId: string;
  tool: CampusOpsToolName;
  args: Record<string, unknown>;
}

export interface PendingApproval extends ApprovalProposal {
  id: string;
  fingerprint: string;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
}

export interface PublicApproval {
  id: string;
  tool: CampusOpsToolName;
  title: string;
  explanation: string;
  whatWillChange: string;
  args: Record<string, unknown>;
  expiresAt: string;
}

export class ApprovalError extends Error {
  constructor(message = 'Approval is unavailable or expired') {
    super(message);
    this.name = 'ApprovalError';
  }
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export const approvalFingerprint = (proposal: ApprovalProposal): string =>
  createHash('sha256')
    .update(canonical({ tool: proposal.tool, args: proposal.args }))
    .digest('hex');

const publicView = (approval: PendingApproval): PublicApproval => {
  const argument = (name: string, fallback: string): string =>
    typeof approval.args[name] === 'string' ? approval.args[name] : fallback;
  if (approval.tool === 'create_support_request') {
    const publicArgs = structuredClone(approval.args);
    delete publicArgs.idempotencyKey;
    return {
      id: approval.id,
      tool: approval.tool,
      title: 'CampusOps wants to create a support request',
      explanation: `Create “${argument('title', 'Untitled request')}” in ${argument('category', 'support')}.`,
      whatWillChange: 'A new support request will be created for your signed-in account.',
      args: publicArgs,
      expiresAt: approval.expiresAt
    };
  }
  return {
    id: approval.id,
    tool: approval.tool,
    title: 'CampusOps wants to cancel a support request',
    explanation: `Cancel support request ${argument('requestId', '')}.`,
    whatWillChange: 'The owned support request will be closed and cannot remain active.',
    args: structuredClone(approval.args),
    expiresAt: approval.expiresAt
  };
};

export class InMemoryApprovalStore {
  private readonly approvals = new Map<string, PendingApproval>();

  constructor(
    private readonly ttlMs = 5 * 60_000,
    private readonly now: () => number = Date.now
  ) {}

  create(proposal: ApprovalProposal): PublicApproval {
    const created = this.now();
    const approval: PendingApproval = {
      ...structuredClone(proposal),
      id: randomUUID(),
      fingerprint: approvalFingerprint(proposal),
      status: 'pending',
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + this.ttlMs).toISOString()
    };
    this.approvals.set(approval.id, approval);
    return publicView(approval);
  }

  validatePending(id: string, userId: string, sessionId: string): PendingApproval {
    return structuredClone(this.boundPending(id, userId, sessionId));
  }

  claim(id: string, userId: string, sessionId: string): PendingApproval {
    const approval = this.boundPending(id, userId, sessionId);
    approval.status = 'executing';
    return structuredClone(approval);
  }

  reject(id: string, userId: string, sessionId: string): PendingApproval {
    const approval = this.boundPending(id, userId, sessionId);
    approval.status = 'rejected';
    return structuredClone(approval);
  }

  finish(id: string, status: 'completed' | 'failed'): void {
    const approval = this.approvals.get(id);
    if (!approval || approval.status !== 'executing') throw new ApprovalError();
    approval.status = status;
  }

  private boundPending(id: string, userId: string, sessionId: string): PendingApproval {
    const approval = this.approvals.get(id);
    if (
      !approval ||
      approval.status !== 'pending' ||
      approval.userId !== userId ||
      approval.sessionId !== sessionId ||
      Date.parse(approval.expiresAt) <= this.now()
    ) {
      throw new ApprovalError();
    }
    return approval;
  }
}
