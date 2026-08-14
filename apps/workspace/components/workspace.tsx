'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Activity, PublicApproval } from '@campusops/ai';

interface SessionView {
  authenticated: true;
  user: { displayName: string };
  csrfToken: string;
  expiresAt: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface TurnResponse {
  conversationId: string;
  correlationId: string;
  assistantText: string;
  approval?: PublicApproval;
  activities: Activity[];
}

const suggestions = [
  'Are any services currently having problems?',
  'Show my open support requests.',
  'What does the remote access policy say?'
];

const iconFor = (kind: Activity['kind']) => {
  if (kind.startsWith('approval')) return '◆';
  if (kind.startsWith('tool')) return '↗';
  if (kind === 'authorization_checked') return '✓';
  return '✦';
};

export function Workspace() {
  const [session, setSession] = useState<SessionView>();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [approval, setApproval] = useState<PublicApproval>();
  const [conversationId, setConversationId] = useState<string>();
  const [correlationId, setCorrelationId] = useState<string>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const response = await fetch('/api/session', { cache: 'no-store' });
        setSession(response.ok ? ((await response.json()) as SessionView) : undefined);
      } catch {
        setSession(undefined);
      } finally {
        setSessionChecked(true);
      }
    };
    void loadSession();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, approval]);

  const initials = useMemo(
    () =>
      session?.user.displayName
        .split(/[@.\s]/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('') ?? 'CO',
    [session]
  );

  const applyTurn = (turn: TurnResponse) => {
    setConversationId(turn.conversationId);
    setCorrelationId(turn.correlationId);
    setActivities((current) => [...turn.activities, ...current].slice(0, 18));
    setApproval(turn.approval);
    if (turn.assistantText) {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', text: turn.assistantText }
      ]);
    }
  };

  const request = async (url: string, body: unknown): Promise<TurnResponse> => {
    if (!session) throw new Error('Your session has expired. Sign in again.');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
      body: JSON.stringify(body)
    });
    const payload = (await response.json().catch(() => ({}))) as TurnResponse & { error?: string };
    if (response.status === 401) setSession(undefined);
    if (!response.ok) throw new Error(payload.error ?? 'CampusOps could not complete the request.');
    return payload;
  };

  const send = async (message: string) => {
    const value = message.trim();
    if (!value || busy || approval) return;
    setBusy(true);
    setError(undefined);
    setDraft('');
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text: value }]);
    try {
      applyTurn(
        await request('/api/chat', {
          message: value,
          ...(conversationId ? { conversationId } : {})
        })
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'CampusOps request failed.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };

  const decide = async (decision: 'approve' | 'cancel') => {
    if (!approval || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      applyTurn(await request(`/api/approvals/${approval.id}`, { decision }));
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Approval could not be processed.'
      );
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (!session) return;
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'x-csrf-token': session.csrfToken }
    });
    const payload = (await response.json()) as { logoutUrl?: string };
    window.location.assign(payload.logoutUrl ?? '/');
  };

  const newConversation = () => {
    if (approval) return;
    setMessages([]);
    setActivities([]);
    setConversationId(undefined);
    setCorrelationId(undefined);
    setError(undefined);
  };

  if (!sessionChecked) {
    return (
      <main className="loading-screen">
        <div className="pulse-mark">C</div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="login-screen">
        <section className="login-card">
          <div className="brand-mark large">C</div>
          <p className="eyebrow">SECURE OPERATIONS</p>
          <h1>Your AI workspace for campus operations.</h1>
          <p className="login-copy">
            Ask questions, review live service information, and take governed action through
            CampusOps MCP.
          </p>
          <a className="primary-button login-button" href="/api/auth/login">
            Sign in with CampusOps <span>→</span>
          </a>
          <div className="trust-row">
            <span>PKCE</span>
            <span>Scoped access</span>
            <span>Human approval</span>
          </div>
        </section>
        <div className="login-orbit orbit-one" />
        <div className="login-orbit orbit-two" />
      </main>
    );
  }

  return (
    <main className="workspace-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C</div>
          <div>
            <strong>CampusOps</strong>
            <span>AI Workspace</span>
          </div>
        </div>
        <button className="new-chat" onClick={newConversation} disabled={Boolean(approval)}>
          <span>＋</span> New conversation
        </button>
        <div className="sidebar-label">CONVERSATIONS</div>
        <button className="conversation active">
          <span className="conversation-icon">✦</span>
          <span>
            <strong>Current workspace</strong>
            <small>{messages.length ? 'Active now' : 'Start a conversation'}</small>
          </span>
        </button>
        <div className="governance-card">
          <div className="shield">◇</div>
          <div>
            <strong>Governed execution</strong>
            <p>Reads run automatically. Changes wait for your approval.</p>
          </div>
        </div>
        <div className="user-row">
          <div className="avatar">{initials}</div>
          <div className="user-copy">
            <strong>{session.user.displayName}</strong>
            <span>Authenticated user</span>
          </div>
          <button aria-label="Sign out" onClick={() => void logout()}>
            ↗
          </button>
        </div>
      </aside>

      <section className="chat-panel">
        <header className="topbar">
          <div>
            <span className="status-dot" /> Connected to CampusOps
          </div>
          <span className="model-chip">Amazon Bedrock · Governed MCP</span>
        </header>
        <div className="message-scroll">
          {messages.length === 0 ? (
            <section className="welcome">
              <div className="assistant-orb">✦</div>
              <p className="eyebrow">CAMPUSOPS ASSISTANT</p>
              <h2>What can I help you operate today?</h2>
              <p>
                I can check services, search fictional policies, and manage your support
                requests—with approval before anything changes.
              </p>
              <div className="suggestions">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} onClick={() => void send(suggestion)}>
                    {suggestion}
                    <span>↗</span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="messages">
              {messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  <div className="message-avatar">
                    {message.role === 'assistant' ? '✦' : initials}
                  </div>
                  <div>
                    <span className="message-author">
                      {message.role === 'assistant' ? 'CampusOps' : 'You'}
                    </span>
                    <p>{message.text}</p>
                  </div>
                </article>
              ))}
              {busy && (
                <article className="message assistant">
                  <div className="message-avatar">✦</div>
                  <div className="thinking">
                    <span />
                    <span />
                    <span />
                  </div>
                </article>
              )}
            </div>
          )}

          {approval && (
            <section className="approval-card">
              <div className="approval-heading">
                <div className="approval-icon">!</div>
                <div>
                  <span>HUMAN APPROVAL REQUIRED</span>
                  <h3>{approval.title}</h3>
                </div>
              </div>
              <p>{approval.explanation}</p>
              <div className="approval-details">
                {Object.entries(approval.args)
                  .filter(([key]) => key !== 'idempotencyKey')
                  .map(([key, value]) => (
                    <div key={key}>
                      <span>{key.replace(/([A-Z])/g, ' $1')}</span>
                      <strong>{String(value)}</strong>
                    </div>
                  ))}
              </div>
              <div className="change-note">
                <span>◇</span>
                {approval.whatWillChange}
              </div>
              <div className="approval-actions">
                <button
                  className="secondary-button"
                  onClick={() => void decide('cancel')}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  className="primary-button"
                  onClick={() => void decide('approve')}
                  disabled={busy}
                >
                  Approve &amp; execute <span>→</span>
                </button>
              </div>
            </section>
          )}
          {error && (
            <div className="error-banner">
              <span>!</span>
              <p>{error}</p>
              <button onClick={() => setError(undefined)}>Dismiss</button>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form className="composer" onSubmit={submit}>
          <div className="composer-box">
            <textarea
              aria-label="Message CampusOps"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                approval
                  ? 'Resolve the pending approval to continue'
                  : 'Ask CampusOps about services, policies, or support…'
              }
              disabled={busy || Boolean(approval)}
              rows={1}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button type="submit" disabled={busy || Boolean(approval) || !draft.trim()}>
              ↑
            </button>
          </div>
          <p>The model proposes actions. CampusOps authorizes and executes them.</p>
        </form>
      </section>

      <aside className="activity-panel">
        <div className="activity-header">
          <div>
            <p className="eyebrow">LIVE TRACE</p>
            <h2>Activity</h2>
          </div>
          <span className="live-pill">● LIVE</span>
        </div>
        <p className="activity-intro">
          Safe execution events for this conversation. Sensitive payloads are never shown.
        </p>
        <div className="activity-list">
          {activities.length === 0 ? (
            <div className="empty-activity">
              <span>◇</span>
              <p>Tool and approval activity will appear here.</p>
            </div>
          ) : (
            activities.map((item) => (
              <div className={`activity-item ${item.status}`} key={item.id}>
                <div className="activity-symbol">{iconFor(item.kind)}</div>
                <div>
                  <strong>{item.label}</strong>
                  <span>
                    {new Date(item.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
        {correlationId && (
          <div className="trace-id">
            <span>Correlation</span>
            <code>{correlationId.slice(0, 8)}…</code>
          </div>
        )}
        <div className="boundary">
          <span className="boundary-icon">◇</span>
          <div>
            <strong>Security boundary</strong>
            <p>Identity, scopes, ownership, and validation are enforced again by CampusOps MCP.</p>
          </div>
        </div>
      </aside>
    </main>
  );
}
