import { WorkspaceAuthenticationError } from './session.js';
import type { InMemoryWorkspaceAuthStore, WorkspaceSession } from './session.js';

export const SESSION_COOKIE = 'campusops_workspace_session';
export const LOGIN_COOKIE = 'campusops_workspace_login';

export const authorizeWorkspaceRequest = (
  store: InMemoryWorkspaceAuthStore,
  input: { sessionId?: string; csrfToken?: string; requireCsrf?: boolean }
): WorkspaceSession => {
  const session = store.requireSession(input.sessionId);
  if (input.requireCsrf && (!input.csrfToken || input.csrfToken !== session.csrfToken)) {
    throw new WorkspaceAuthenticationError('CSRF validation failed', 403);
  }
  return session;
};
