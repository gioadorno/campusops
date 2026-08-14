import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { publicError, requestSession } from '../../../src/server/http.js';
import { getWorkspaceRuntime } from '../../../src/server/runtime.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

const inputSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().uuid().optional()
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = requestSession(request, true);
    const input = inputSchema.parse(await request.json());
    const result = await getWorkspaceRuntime().orchestrator.chat(
      {
        userId: session.userId,
        sessionId: session.id,
        scopes: session.scopes,
        accessToken: session.accessToken
      },
      input.message,
      input.conversationId
    );
    return NextResponse.json(result);
  } catch (error) {
    return publicError(error);
  }
}
