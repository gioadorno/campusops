import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool
} from '@aws-sdk/client-bedrock-runtime';
import type {
  ModelBlock,
  ModelMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from './types.js';

const toBedrockBlock = (block: ModelBlock): ContentBlock => {
  if (block.type === 'text') return { text: block.text };
  if (block.type === 'tool_use') {
    return {
      toolUse: {
        toolUseId: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>
      }
    } as ContentBlock;
  }
  return {
    toolResult: {
      toolUseId: block.toolUseId,
      content: [{ text: block.content }],
      status: block.status
    }
  };
};

const fromBedrockMessage = (message: Message): ModelMessage => ({
  role: message.role === 'assistant' ? 'assistant' : 'user',
  content: (message.content ?? []).flatMap((block): ModelBlock[] => {
    if (block.text !== undefined) return [{ type: 'text', text: block.text }];
    if (block.toolUse?.toolUseId && block.toolUse.name) {
      return [
        {
          type: 'tool_use',
          id: block.toolUse.toolUseId,
          name: block.toolUse.name,
          input: block.toolUse.input ?? {}
        }
      ];
    }
    return [];
  })
});

export class BedrockConverseProvider implements ModelProvider {
  constructor(
    private readonly client: BedrockRuntimeClient,
    private readonly modelId: string
  ) {}

  async converse(request: ModelRequest): Promise<ModelResponse> {
    const tools: Tool[] = request.tools.map(
      (tool) =>
        ({
          toolSpec: {
            name: tool.name,
            description: tool.description,
            inputSchema: { json: tool.inputSchema }
          }
        }) as Tool
    );
    const response = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: request.system }],
        messages: request.messages.map((message): Message => ({
          role: message.role,
          content: message.content.map(toBedrockBlock)
        })),
        toolConfig: { tools, toolChoice: { auto: {} } },
        inferenceConfig: { maxTokens: 800, temperature: 0.1, topP: 0.9 },
        requestMetadata: { correlationId: request.correlationId }
      })
    );
    if (!response.output?.message) throw new Error('Bedrock returned no message');
    return {
      message: fromBedrockMessage(response.output.message),
      ...(response.stopReason ? { stopReason: response.stopReason } : {})
    };
  }
}

export const createBedrockProvider = (region: string, modelId: string): BedrockConverseProvider =>
  new BedrockConverseProvider(new BedrockRuntimeClient({ region }), modelId);
