import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApprovalError } from './approval.js';
import { ConversationError } from './conversation.js';
import type { InMemoryApprovalStore, PublicApproval } from './approval.js';
import type { Conversation, InMemoryConversationStore } from './conversation.js';
import { CAMPUSOPS_SYSTEM_INSTRUCTION } from './prompt.js';
import { safeErrorMetadata, safeErrorType } from './diagnostics.js';
import {
  allowedToolDefinitions,
  getToolDefinition,
  toModelToolDefinition,
  validateToolProposal
} from './tools.js';
import type {
  Activity,
  DiagnosticSink,
  ModelMessage,
  ModelProvider,
  ToolExecutor,
  ToolResultBlock,
  ToolUseBlock,
  UserContext
} from './types.js';

const chatInput = z.string().trim().min(1).max(4000);

export interface TurnResult {
  conversationId: string;
  correlationId: string;
  assistantText: string;
  approval?: PublicApproval;
  activities: Activity[];
}

const activity = (
  kind: Activity['kind'],
  label: string,
  status: Activity['status'] = 'info'
): Activity => ({ id: randomUUID(), kind, label, status, timestamp: new Date().toISOString() });

const toolResultBlock = (
  toolUseId: string,
  value: unknown,
  status: ToolResultBlock['status']
): ToolResultBlock => ({
  type: 'tool_result',
  toolUseId,
  content: typeof value === 'string' ? value : JSON.stringify(value),
  status
});

const toolResult = (
  toolUseId: string,
  value: unknown,
  status: ToolResultBlock['status']
): ModelMessage => ({ role: 'user', content: [toolResultBlock(toolUseId, value, status)] });

const assistantText = (message: ModelMessage): string =>
  message.content
    .filter(
      (block): block is Extract<(typeof message.content)[number], { type: 'text' }> =>
        block.type === 'text'
    )
    .map((block) => block.text)
    .join('\n')
    .replace(/<(?:thinking|analysis)>[\s\S]*?<\/(?:thinking|analysis)>/gi, '')
    .replace(/<(?:thinking|analysis)>[\s\S]*$/gi, '')
    .replace(/<\/?(?:thinking|analysis)>/gi, '')
    .trim();

export class CampusOpsOrchestrator {
  constructor(
    private readonly model: ModelProvider,
    private readonly executor: ToolExecutor,
    private readonly conversations: InMemoryConversationStore,
    private readonly approvals: InMemoryApprovalStore,
    private readonly diagnostics: DiagnosticSink,
    private readonly maxModelSteps = 6
  ) {}

  async chat(context: UserContext, message: string, conversationId?: string): Promise<TurnResult> {
    const correlationId = randomUUID();
    const started = performance.now();
    this.diagnostics.write({ correlationId, operation: 'conversation', result: 'started' });
    try {
      const conversation = conversationId
        ? this.conversations.get(conversationId, context.userId, context.sessionId)
        : this.conversations.create(context.userId, context.sessionId);
      if (conversation.pendingApprovalId) {
        throw new ApprovalError('Resolve the pending approval before sending another message');
      }
      conversation.messages.push({
        role: 'user',
        content: [{ type: 'text', text: chatInput.parse(message) }]
      });
      this.conversations.save(conversation);
      const result = await this.continueConversation(context, conversation, correlationId, []);
      this.diagnostics.write({
        correlationId,
        operation: 'conversation',
        result: result.approval ? 'pending' : 'success',
        durationMs: performance.now() - started
      });
      return result;
    } catch (error) {
      this.diagnostics.write({
        correlationId,
        operation: 'conversation',
        result: 'error',
        durationMs: performance.now() - started,
        errorType: safeErrorType(error)
      });
      throw error;
    }
  }

  async approve(context: UserContext, approvalId: string): Promise<TurnResult> {
    const correlationId = randomUUID();
    const approval = this.approvals.claim(approvalId, context.userId, context.sessionId);
    const conversation = this.conversations.get(
      approval.conversationId,
      context.userId,
      context.sessionId
    );
    if (conversation.pendingApprovalId !== approval.id) throw new ApprovalError();
    const activities = [activity('approval_accepted', 'Human approval accepted', 'success')];
    this.diagnostics.write({
      correlationId,
      operation: 'approval',
      result: 'success',
      tool: approval.tool
    });
    const toolStarted = performance.now();
    try {
      const result = await this.executor.execute(approval.tool, approval.args, {
        accessToken: context.accessToken,
        correlationId
      });
      this.approvals.finish(approval.id, 'completed');
      delete conversation.pendingApprovalId;
      conversation.messages.push(toolResult(approval.toolUseId, result, 'success'));
      this.conversations.save(conversation);
      activities.push(activity('tool_succeeded', `${approval.tool} completed`, 'success'));
      this.diagnostics.write({
        correlationId,
        operation: 'tool_call',
        result: 'success',
        tool: approval.tool,
        durationMs: performance.now() - toolStarted
      });
      return this.continueConversation(context, conversation, correlationId, activities);
    } catch (error) {
      this.approvals.finish(approval.id, 'failed');
      delete conversation.pendingApprovalId;
      conversation.messages.push(
        toolResult(approval.toolUseId, 'CampusOps tool execution failed', 'error')
      );
      this.conversations.save(conversation);
      activities.push(activity('tool_failed', `${approval.tool} failed`, 'error'));
      this.diagnostics.write({
        correlationId,
        operation: 'tool_call',
        result: 'error',
        tool: approval.tool,
        durationMs: performance.now() - toolStarted,
        errorType: safeErrorType(error)
      });
      return this.continueConversation(context, conversation, correlationId, activities);
    }
  }

  reject(context: UserContext, approvalId: string): Promise<TurnResult> {
    const correlationId = randomUUID();
    const approval = this.approvals.reject(approvalId, context.userId, context.sessionId);
    const conversation = this.conversations.get(
      approval.conversationId,
      context.userId,
      context.sessionId
    );
    if (conversation.pendingApprovalId !== approval.id) throw new ApprovalError();
    delete conversation.pendingApprovalId;
    conversation.messages.push(
      toolResult(
        approval.toolUseId,
        'The user declined this action. No changes were made.',
        'error'
      )
    );
    const response = 'Cancelled. No changes were made to CampusOps.';
    conversation.messages.push({ role: 'assistant', content: [{ type: 'text', text: response }] });
    this.conversations.save(conversation);
    const activities = [activity('approval_rejected', 'Human approval declined', 'warning')];
    this.diagnostics.write({
      correlationId,
      operation: 'approval',
      result: 'rejected',
      tool: approval.tool
    });
    return Promise.resolve({
      conversationId: conversation.id,
      correlationId,
      assistantText: response,
      activities
    });
  }

  private async continueConversation(
    context: UserContext,
    conversation: Conversation,
    correlationId: string,
    activities: Activity[]
  ): Promise<TurnResult> {
    const tools = allowedToolDefinitions(context.scopes);
    for (let step = 0; step < this.maxModelSteps; step += 1) {
      activities.push(activity('model_invocation', 'AI response requested'));
      const modelStarted = performance.now();
      this.diagnostics.write({
        correlationId,
        operation: 'model_invocation',
        result: 'started'
      });
      let response;
      try {
        response = await this.model.converse({
          system: CAMPUSOPS_SYSTEM_INSTRUCTION,
          messages: conversation.messages,
          tools: tools.map(toModelToolDefinition),
          correlationId
        });
        this.diagnostics.write({
          correlationId,
          operation: 'model_invocation',
          result: 'success',
          durationMs: performance.now() - modelStarted
        });
      } catch (error) {
        this.diagnostics.write({
          correlationId,
          operation: 'model_invocation',
          result: 'error',
          durationMs: performance.now() - modelStarted,
          errorType: safeErrorType(error)
        });
        throw error;
      }
      if (response.message.role !== 'assistant') throw new Error('Model returned an invalid role');
      conversation.messages.push(response.message);
      const requested = response.message.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use'
      );
      if (requested.length === 0) {
        this.conversations.save(conversation);
        return {
          conversationId: conversation.id,
          correlationId,
          assistantText: assistantText(response.message) || 'CampusOps completed the request.',
          activities
        };
      }
      if (requested.length > 1) {
        const proposals = requested.map((proposal) => {
          this.diagnostics.write({
            correlationId,
            operation: 'model_tool_request',
            result: 'success',
            tool: getToolDefinition(proposal.name)?.name ?? 'unknown_tool'
          });
          try {
            return { proposal, validated: validateToolProposal(proposal.name, proposal.input) };
          } catch {
            return { proposal, validated: undefined };
          }
        });
        const batchIsSafe = proposals.every(
          ({ validated }) =>
            validated?.definition.access === 'read' &&
            tools.some((tool) => tool.name === validated.definition.name)
        );
        if (!batchIsSafe) {
          conversation.messages.push({
            role: 'user',
            content: proposals.map(({ proposal }) =>
              toolResultBlock(
                proposal.id,
                'Multiple requests are allowed only for authorized read-only tools. Request state-changing tools one at a time.',
                'error'
              )
            )
          });
          activities.push(
            activity('tool_failed', 'Unsafe or invalid parallel tool request blocked', 'error')
          );
          this.conversations.save(conversation);
          continue;
        }
        const results: ToolResultBlock[] = [];
        for (const { proposal, validated } of proposals) {
          if (!validated) continue;
          activities.push(activity('authorization_checked', 'Tool eligibility checked', 'success'));
          const toolStarted = performance.now();
          try {
            const result = await this.executor.execute(validated.definition.name, validated.args, {
              accessToken: context.accessToken,
              correlationId
            });
            results.push(toolResultBlock(proposal.id, result, 'success'));
            activities.push(
              activity('tool_succeeded', `${validated.definition.name} completed`, 'success')
            );
            this.diagnostics.write({
              correlationId,
              operation: 'tool_call',
              result: 'success',
              tool: validated.definition.name,
              durationMs: performance.now() - toolStarted
            });
          } catch (error) {
            results.push(toolResultBlock(proposal.id, 'CampusOps tool execution failed', 'error'));
            activities.push(
              activity('tool_failed', `${validated.definition.name} failed`, 'error')
            );
            this.diagnostics.write({
              correlationId,
              operation: 'tool_call',
              result: 'error',
              tool: validated.definition.name,
              durationMs: performance.now() - toolStarted,
              ...safeErrorMetadata(error)
            });
          }
        }
        conversation.messages.push({ role: 'user', content: results });
        this.conversations.save(conversation);
        continue;
      }
      const proposal = requested[0] as ToolUseBlock;
      this.diagnostics.write({
        correlationId,
        operation: 'model_tool_request',
        result: 'success',
        tool: getToolDefinition(proposal.name)?.name ?? 'unknown_tool'
      });
      activities.push(activity('tool_requested', `${proposal.name} requested`));
      let validated: ReturnType<typeof validateToolProposal>;
      try {
        validated = validateToolProposal(proposal.name, proposal.input);
      } catch {
        conversation.messages.push(toolResult(proposal.id, 'Tool request was invalid.', 'error'));
        this.conversations.save(conversation);
        activities.push(activity('tool_failed', 'Invalid tool request blocked', 'error'));
        continue;
      }
      if (!tools.some((tool) => tool.name === validated.definition.name)) {
        conversation.messages.push(toolResult(proposal.id, 'Tool is not authorized.', 'error'));
        this.conversations.save(conversation);
        activities.push(activity('authorization_checked', 'Tool authorization denied', 'error'));
        continue;
      }
      activities.push(activity('authorization_checked', 'Tool eligibility checked', 'success'));
      if (validated.definition.access === 'write') {
        const approval = this.approvals.create({
          userId: context.userId,
          sessionId: context.sessionId,
          conversationId: conversation.id,
          toolUseId: proposal.id,
          tool: validated.definition.name,
          args: validated.args
        });
        conversation.pendingApprovalId = approval.id;
        this.conversations.save(conversation);
        activities.push(
          activity('approval_requested', 'Explicit human approval required', 'warning')
        );
        this.diagnostics.write({
          correlationId,
          operation: 'approval',
          result: 'pending',
          tool: approval.tool
        });
        return {
          conversationId: conversation.id,
          correlationId,
          assistantText: assistantText(response.message),
          approval,
          activities
        };
      }
      try {
        const toolStarted = performance.now();
        const result = await this.executor.execute(validated.definition.name, validated.args, {
          accessToken: context.accessToken,
          correlationId
        });
        conversation.messages.push(toolResult(proposal.id, result, 'success'));
        activities.push(
          activity('tool_succeeded', `${validated.definition.name} completed`, 'success')
        );
        this.diagnostics.write({
          correlationId,
          operation: 'tool_call',
          result: 'success',
          tool: validated.definition.name,
          durationMs: performance.now() - toolStarted
        });
      } catch (error) {
        conversation.messages.push(
          toolResult(proposal.id, 'CampusOps tool execution failed', 'error')
        );
        activities.push(activity('tool_failed', `${validated.definition.name} failed`, 'error'));
        this.diagnostics.write({
          correlationId,
          operation: 'tool_call',
          result: 'error',
          tool: validated.definition.name,
          ...safeErrorMetadata(error)
        });
      }
      this.conversations.save(conversation);
    }
    throw new Error('Model tool loop exceeded the safe step limit');
  }
}

export { ApprovalError, ConversationError };
