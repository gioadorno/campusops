import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { publicError, requestSession } from '../../../../src/server/http.js';
import { getWorkspaceRuntime } from '../../../../src/server/runtime.js';
import { SESSION_COOKIE } from '../../../../src/server/request-auth.js';

export const runtime = 'nodejs';

export function POST(request: NextRequest): NextResponse {
  try {
    requestSession(request, true);
    const workspace = getWorkspaceRuntime();
    workspace.auth.destroySession(request.cookies.get(SESSION_COOKIE)?.value);
    const response = NextResponse.json({ logoutUrl: workspace.oauth.logoutUrl() });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch (error) {
    return publicError(error);
  }
}
