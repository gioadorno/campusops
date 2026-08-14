import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  cancelSupportRequestInput,
  createSupportRequestInput,
  getServiceStatusInput,
  getSupportRequestInput,
  listSupportRequestsInput,
  searchPoliciesInput,
  type Scope
} from '@campusops/contracts';
import type { ModelToolDefinition, ToolAccess } from './types.js';

const definitions = {
  search_policies: {
    title: 'Search policies',
    description: 'Search fictional organizational policies by text and optional category.',
    access: 'read',
    requiredScopes: ['policies:read'],
    schema: searchPoliciesInput
  },
  get_service_status: {
    title: 'Get service status',
    description:
      'Get one fictional CampusOps service status. Seeded service IDs are learning-hub and campus-wifi; check both when the user asks about all services.',
    access: 'read',
    requiredScopes: ['services:read'],
    schema: getServiceStatusInput
  },
  list_support_requests: {
    title: 'List support requests',
    description: 'List support requests owned by the authenticated user.',
    access: 'read',
    requiredScopes: ['requests:read'],
    schema: listSupportRequestsInput
  },
  get_support_request: {
    title: 'Get support request',
    description: 'Read one support request after CampusOps verifies ownership.',
    access: 'read',
    requiredScopes: ['requests:read'],
    schema: getSupportRequestInput
  },
  create_support_request: {
    title: 'Create support request',
    description: 'Propose an idempotent support request for the authenticated user.',
    access: 'write',
    requiredScopes: ['requests:write'],
    schema: createSupportRequestInput
  },
  cancel_support_request: {
    title: 'Cancel support request',
    description: 'Propose closing a support request owned by the authenticated user.',
    access: 'write',
    requiredScopes: ['requests:write'],
    schema: cancelSupportRequestInput
  }
} as const satisfies Record<
  string,
  {
    title: string;
    description: string;
    access: ToolAccess;
    requiredScopes: readonly Scope[];
    schema: z.ZodType;
  }
>;

export type CampusOpsToolName = keyof typeof definitions;

export interface CampusOpsToolDefinition {
  name: CampusOpsToolName;
  title: string;
  description: string;
  access: ToolAccess;
  requiredScopes: readonly Scope[];
  schema: z.ZodType;
}

export const campusOpsToolNames = Object.keys(definitions) as CampusOpsToolName[];

export const getToolDefinition = (name: string): CampusOpsToolDefinition | undefined => {
  if (!campusOpsToolNames.includes(name as CampusOpsToolName)) return undefined;
  const definition = definitions[name as CampusOpsToolName];
  return { name: name as CampusOpsToolName, ...definition };
};

export const classifyTool = (name: CampusOpsToolName): ToolAccess => definitions[name].access;

export const validateToolProposal = (
  name: string,
  input: unknown
): { definition: CampusOpsToolDefinition; args: Record<string, unknown> } => {
  const definition = getToolDefinition(name);
  if (!definition) throw new Error('Unknown CampusOps tool');
  const candidate =
    name === 'create_support_request' && input !== null && typeof input === 'object'
      ? { ...input, idempotencyKey: `workspace-${randomUUID()}` }
      : input;
  const parsed = definition.schema.safeParse(candidate);
  if (!parsed.success) throw new Error('Malformed CampusOps tool arguments');
  return { definition, args: parsed.data as Record<string, unknown> };
};

export const allowedToolDefinitions = (scopes: readonly Scope[]): CampusOpsToolDefinition[] =>
  campusOpsToolNames
    .map((name) => getToolDefinition(name) as CampusOpsToolDefinition)
    .filter((tool) => tool.requiredScopes.every((scope) => scopes.includes(scope)));

export const toModelToolDefinition = (tool: CampusOpsToolDefinition): ModelToolDefinition => {
  const schema = z.toJSONSchema(tool.schema) as Record<string, unknown>;
  delete schema.$schema;
  if (tool.name === 'create_support_request') {
    const properties = schema.properties as Record<string, unknown> | undefined;
    if (properties) delete properties.idempotencyKey;
    if (Array.isArray(schema.required)) {
      schema.required = schema.required.filter((name) => name !== 'idempotencyKey');
    }
  }
  return { name: tool.name, description: tool.description, inputSchema: schema };
};
