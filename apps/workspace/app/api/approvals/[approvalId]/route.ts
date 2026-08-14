import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { publicError, requestSession } from '../../../../src/server/http.js';
import { getWorkspaceRuntime } from '../../../../src/server/runtime.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

const decisionSchema = z.object({ decision: z.enum(['approve', 'cancel']) });

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ approvalId: string }> }
): Promise<NextResponse> {
  try {
    const session = requestSession(request, true);
    const { approvalId } = await context.params;
    z.string().uuid().parse(approvalId);
    const { decision } = decisionSchema.parse(await request.json());
    const userContext = {
      userId: session.userId,
      sessionId: session.id,
      scopes: session.scopes,
      accessToken: session.accessToken
    };
    const orchestrator = getWorkspaceRuntime().orchestrator;
    const result =
      decision === 'approve'
        ? await orchestrator.approve(userContext, approvalId)
        : await orchestrator.reject(userContext, approvalId);
    return NextResponse.json(result);
  } catch (error) {
    return publicError(error);
  }
}
