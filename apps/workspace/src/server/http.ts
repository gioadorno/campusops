import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ApprovalError, ConversationError, safeErrorType } from '@campusops/ai';
import { ZodError } from 'zod';
import { authorizeWorkspaceRequest, SESSION_COOKIE } from './request-auth.js';
import { getWorkspaceRuntime } from './runtime.js';
import { WorkspaceAuthenticationError, type WorkspaceSession } from './session.js';

export const requestSession = (request: NextRequest, requireCsrf = false): WorkspaceSession => {
  const runtime = getWorkspaceRuntime();
  const sessionId = request.cookies.get(SESSION_COOKIE)?.value;
  const csrfToken = request.headers.get('x-csrf-token') ?? undefined;
  return authorizeWorkspaceRequest(runtime.auth, {
    ...(sessionId ? { sessionId } : {}),
    ...(csrfToken ? { csrfToken } : {}),
    requireCsrf
  });
};

export const publicError = (error: unknown): NextResponse => {
  if (error instanceof WorkspaceAuthenticationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ApprovalError || error instanceof ConversationError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: 'Request validation failed' }, { status: 400 });
  }
  process.stderr.write(
    `${JSON.stringify({
      operation: 'workspace_request',
      result: 'error',
      errorType: safeErrorType(error)
    })}\n`
  );
  return NextResponse.json({ error: 'Workspace operation failed' }, { status: 500 });
};
