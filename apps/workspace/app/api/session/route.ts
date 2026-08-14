import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { publicError, requestSession } from '../../../src/server/http.js';

export const runtime = 'nodejs';

export function GET(request: NextRequest): NextResponse {
  try {
    const session = requestSession(request);
    return NextResponse.json({
      authenticated: true,
      user: { displayName: session.displayName },
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString()
    });
  } catch (error) {
    return publicError(error);
  }
}
