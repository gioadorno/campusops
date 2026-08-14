import {
  CampusOpsOrchestrator,
  InMemoryApprovalStore,
  InMemoryConversationStore,
  JsonDiagnosticSink,
  createBedrockProvider,
  type ToolExecutor
} from '@campusops/ai';
import { callAuthenticatedTool } from '@campusops/mcp-client';
import { CognitoOAuthClient } from './cognito.js';
import { loadWorkspaceConfig } from './config.js';
import { InMemoryWorkspaceAuthStore } from './session.js';

class McpToolExecutor implements ToolExecutor {
  constructor(private readonly endpoint: string) {}
  execute(
    name: string,
    args: Record<string, unknown>,
    context: { accessToken: string; correlationId: string }
  ): Promise<unknown> {
    return callAuthenticatedTool({
      endpoint: this.endpoint,
      accessToken: context.accessToken,
      correlationId: context.correlationId,
      name,
      args
    });
  }
}

const createRuntime = () => {
  const config = loadWorkspaceConfig();
  const auth = new InMemoryWorkspaceAuthStore();
  const diagnostics = new JsonDiagnosticSink();
  return {
    config,
    auth,
    oauth: new CognitoOAuthClient(config),
    orchestrator: new CampusOpsOrchestrator(
      createBedrockProvider(config.AWS_REGION, config.BEDROCK_MODEL_ID),
      new McpToolExecutor(config.MCP_ENDPOINT),
      new InMemoryConversationStore(),
      new InMemoryApprovalStore(),
      diagnostics
    )
  };
};

export type WorkspaceRuntime = ReturnType<typeof createRuntime>;

const globalRuntime = globalThis as typeof globalThis & {
  campusOpsWorkspaceRuntime?: WorkspaceRuntime;
};

export const getWorkspaceRuntime = (): WorkspaceRuntime =>
  (globalRuntime.campusOpsWorkspaceRuntime ??= createRuntime());
