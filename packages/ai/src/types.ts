import type { Scope } from '@campusops/contracts';

export type ToolAccess = 'read' | 'write';

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  status: 'success' | 'error';
}

export type ModelBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: ModelBlock[];
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ModelRequest {
  system: string;
  messages: readonly ModelMessage[];
  tools: readonly ModelToolDefinition[];
  correlationId: string;
}

export interface ModelResponse {
  message: ModelMessage;
  stopReason?: string;
}

export interface ModelProvider {
  converse(request: ModelRequest): Promise<ModelResponse>;
}

export interface ToolExecutionContext {
  accessToken: string;
  correlationId: string;
}

export interface ToolExecutor {
  execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown>;
}

export interface UserContext {
  userId: string;
  sessionId: string;
  scopes: readonly Scope[];
  accessToken: string;
}

export type ActivityKind =
  | 'model_invocation'
  | 'tool_requested'
  | 'authorization_checked'
  | 'approval_requested'
  | 'approval_accepted'
  | 'approval_rejected'
  | 'tool_succeeded'
  | 'tool_failed';

export interface Activity {
  id: string;
  kind: ActivityKind;
  label: string;
  status: 'info' | 'success' | 'warning' | 'error';
  timestamp: string;
}

export interface WorkspaceDiagnostic {
  correlationId: string;
  operation: string;
  result: 'started' | 'success' | 'error' | 'pending' | 'rejected';
  durationMs?: number;
  tool?: string;
  errorType?: string;
  httpStatus?: number;
  requestId?: string;
}

export interface DiagnosticSink {
  write(event: WorkspaceDiagnostic): void;
}
