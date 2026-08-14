import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getWorkspaceRuntime } from '../../src/server/runtime.js';
import { LOGIN_COOKIE, SESSION_COOKIE } from '../../src/server/request-auth.js';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const workspace = getWorkspaceRuntime();
  const failure = () => {
    const response = NextResponse.redirect(`${workspace.config.WORKSPACE_BASE_URL}/?auth=failed`);
    response.cookies.delete(LOGIN_COOKIE);
    return response;
  };
  const state = request.nextUrl.searchParams.get('state');
  const code = request.nextUrl.searchParams.get('code');
  const loginId = request.cookies.get(LOGIN_COOKIE)?.value;
  if (!state || !code || !loginId || request.nextUrl.searchParams.has('error')) return failure();
  try {
    const login = workspace.auth.consumeLogin(loginId, state);
    const identity = await workspace.oauth.exchange(code, login);
    const session = workspace.auth.createSession({
      ...identity,
      expiresAt: Math.min(
        identity.expiresAt,
        Date.now() + workspace.config.SESSION_TTL_SECONDS * 1000
      )
    });
    const response = NextResponse.redirect(workspace.config.WORKSPACE_BASE_URL);
    response.cookies.delete(LOGIN_COOKIE);
    response.cookies.set(SESSION_COOKIE, session.id, {
      httpOnly: true,
      secure: workspace.config.secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000))
    });
    return response;
  } catch {
    return failure();
  }
}
