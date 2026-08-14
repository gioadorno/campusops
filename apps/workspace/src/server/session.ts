import { createHash, randomBytes } from 'node:crypto';
import type { Scope } from '@campusops/contracts';

const randomValue = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export interface PendingLogin {
  id: string;
  state: string;
  verifier: string;
  challenge: string;
  expiresAt: number;
}

export interface WorkspaceSession {
  id: string;
  userId: string;
  displayName: string;
  scopes: readonly Scope[];
  accessToken: string;
  csrfToken: string;
  expiresAt: number;
}

export class WorkspaceAuthenticationError extends Error {
  constructor(
    message = 'Authentication required',
    public readonly status = 401
  ) {
    super(message);
    this.name = 'WorkspaceAuthenticationError';
  }
}

export class InMemoryWorkspaceAuthStore {
  private readonly logins = new Map<string, PendingLogin>();
  private readonly sessions = new Map<string, WorkspaceSession>();

  constructor(private readonly now: () => number = Date.now) {}

  beginLogin(ttlMs = 10 * 60_000): PendingLogin {
    const verifier = randomValue(64);
    const login: PendingLogin = {
      id: randomValue(),
      state: randomValue(),
      verifier,
      challenge: createHash('sha256').update(verifier).digest('base64url'),
      expiresAt: this.now() + ttlMs
    };
    this.logins.set(login.id, login);
    return structuredClone(login);
  }

  consumeLogin(id: string, state: string): PendingLogin {
    const login = this.logins.get(id);
    this.logins.delete(id);
    if (!login || login.state !== state || login.expiresAt <= this.now()) {
      throw new WorkspaceAuthenticationError('OAuth state is invalid or expired', 400);
    }
    return structuredClone(login);
  }

  createSession(input: Omit<WorkspaceSession, 'id' | 'csrfToken'>): WorkspaceSession {
    const session: WorkspaceSession = {
      ...structuredClone(input),
      id: randomValue(),
      csrfToken: randomValue()
    };
    this.sessions.set(session.id, session);
    return structuredClone(session);
  }

  requireSession(id: string | undefined): WorkspaceSession {
    const session = id ? this.sessions.get(id) : undefined;
    if (!session || session.expiresAt <= this.now()) {
      if (id) this.sessions.delete(id);
      throw new WorkspaceAuthenticationError();
    }
    return structuredClone(session);
  }

  destroySession(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }
}
