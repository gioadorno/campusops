import { NextResponse } from 'next/server';
import { getWorkspaceRuntime } from '../../../../src/server/runtime.js';
import { LOGIN_COOKIE } from '../../../../src/server/request-auth.js';

export const runtime = 'nodejs';

export function GET(): NextResponse {
  const workspace = getWorkspaceRuntime();
  const login = workspace.auth.beginLogin();
  const response = NextResponse.redirect(workspace.oauth.authorizationUrl(login));
  response.cookies.set(LOGIN_COOKIE, login.id, {
    httpOnly: true,
    secure: workspace.config.secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60
  });
  return response;
}
