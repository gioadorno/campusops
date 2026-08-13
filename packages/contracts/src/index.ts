import { z } from 'zod';

export const scopes = [
  'policies:read',
  'services:read',
  'requests:read',
  'requests:write',
  'admin:audit'
] as const;
export const scopeSchema = z.enum(scopes);
export type Scope = z.infer<typeof scopeSchema>;

const trimmed = z.string().trim().min(1);
export const searchPoliciesInput = z.object({
  query: trimmed.max(200),
  category: trimmed.max(50).optional(),
  limit: z.number().int().min(1).max(50).default(10)
});
export const getServiceStatusInput = z.object({ serviceId: trimmed.max(100) });
export const supportStatusSchema = z.enum(['open', 'in_progress', 'closed']);
export const listSupportRequestsInput = z.object({
  status: supportStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20)
});
export const getSupportRequestInput = z.object({ requestId: trimmed.max(100) });
export const createSupportRequestInput = z.object({
  category: trimmed.max(50),
  title: trimmed.max(120),
  description: trimmed.max(4000),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
  idempotencyKey: trimmed.max(200)
});
export const cancelSupportRequestInput = getSupportRequestInput;

export type SearchPoliciesInput = z.infer<typeof searchPoliciesInput>;
export type ListSupportRequestsInput = z.infer<typeof listSupportRequestsInput>;
export type CreateSupportRequestInput = z.infer<typeof createSupportRequestInput>;

export interface Policy {
  id: string;
  title: string;
  category: string;
  summary: string;
  body: string;
  updatedAt: string;
}

export interface ServiceStatus {
  serviceId: string;
  name: string;
  status: 'operational' | 'degraded' | 'outage';
  message: string;
  updatedAt: string;
}

export interface SupportRequest {
  id: string;
  userId: string;
  category: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  status: z.infer<typeof supportStatusSchema>;
  createdAt: string;
  updatedAt: string;
}
