import type { DiagnosticSink, WorkspaceDiagnostic } from './types.js';

const redact = (value: string): string =>
  value
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:code|state|code_verifier|code_challenge)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_TOKEN]')
    .replace(
      /(authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]\s*[^\s,}]+/gi,
      '$1=[REDACTED]'
    );

export const safeErrorMessage = (error: unknown): string =>
  redact(error instanceof Error ? error.message : 'Unexpected workspace error');

const SAFE_ERROR_TYPES = new Set([
  'AccessDeniedException',
  'ApprovalError',
  'ConversationError',
  'McpClientError',
  'McpToolError',
  'ModelErrorException',
  'ResourceNotFoundException',
  'ServiceUnavailableException',
  'ThrottlingException',
  'TimeoutError',
  'ValidationException',
  'WorkspaceAuthenticationError',
  'ZodError'
]);

export const safeErrorType = (error: unknown): string => {
  const name = error instanceof Error ? error.name : '';
  return SAFE_ERROR_TYPES.has(name) ? name : 'UnexpectedError';
};

export const safeErrorMetadata = (
  error: unknown
): Pick<WorkspaceDiagnostic, 'errorType' | 'httpStatus' | 'requestId'> => {
  const candidate = error as { httpStatus?: unknown; requestId?: unknown };
  const httpStatus =
    typeof candidate?.httpStatus === 'number' &&
    Number.isInteger(candidate.httpStatus) &&
    candidate.httpStatus >= 100 &&
    candidate.httpStatus <= 599
      ? candidate.httpStatus
      : undefined;
  const requestId =
    typeof candidate?.requestId === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(candidate.requestId)
      ? candidate.requestId
      : undefined;
  return {
    errorType: safeErrorType(error),
    ...(httpStatus ? { httpStatus } : {}),
    ...(requestId ? { requestId } : {})
  };
};

export class JsonDiagnosticSink implements DiagnosticSink {
  write(event: WorkspaceDiagnostic): void {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }
}

export class InMemoryDiagnosticSink implements DiagnosticSink {
  readonly events: WorkspaceDiagnostic[] = [];
  write(event: WorkspaceDiagnostic): void {
    this.events.push(structuredClone(event));
  }
}
