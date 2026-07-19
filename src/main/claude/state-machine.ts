import { EventEmitter } from 'node:events';
import { ClaudeState, SessionSnapshot } from '../../shared/types';

const STATE_PRIORITY: Record<ClaudeState, number> = {
  attention: 3,
  working: 2,
  done: 1,
  idle: 0,
};

/** Sessions with no events for this long are dropped (terminal killed, laptop slept...). */
const SESSION_STALE_MS = 4 * 60 * 60 * 1000;

interface Session {
  id: string;
  state: ClaudeState;
  lastEvent: string;
  updatedAt: number;
}

/**
 * Tracks per-Claude-session state from hook events and aggregates them into a
 * single pad state: attention > working > done > idle.
 *
 * Emits 'change' with the aggregate ClaudeState whenever it may have changed.
 */
export class ClaudeStateMachine extends EventEmitter {
  private sessions = new Map<string, Session>();
  private doneDecayMs: number;
  private decayTimer: NodeJS.Timeout | null = null;

  constructor(doneDecaySeconds: number) {
    super();
    this.doneDecayMs = doneDecaySeconds * 1000;
  }

  setDoneDecaySeconds(seconds: number): void {
    this.doneDecayMs = seconds * 1000;
  }

  /** Feed a raw Claude Code hook payload. */
  handleHookEvent(payload: Record<string, unknown>): void {
    const event = String(payload.hook_event_name ?? '');
    const sessionId = String(payload.session_id ?? 'unknown');
    if (!event) return;

    const state = this.stateForEvent(event, payload);
    if (event === 'SessionEnd') {
      this.sessions.delete(sessionId);
    } else if (state !== null) {
      this.sessions.set(sessionId, {
        id: sessionId,
        state,
        lastEvent: event,
        updatedAt: Date.now(),
      });
    } else {
      // Event we don't map (SubagentStop, PreCompact...): refresh timestamp only.
      const existing = this.sessions.get(sessionId);
      if (existing) existing.updatedAt = Date.now();
      return;
    }
    this.recompute();
  }

  /** For UI test buttons. */
  simulate(state: ClaudeState): void {
    if (state === 'idle') {
      this.sessions.delete('simulated');
    } else {
      this.sessions.set('simulated', {
        id: 'simulated',
        state,
        lastEvent: `simulate:${state}`,
        updatedAt: Date.now(),
      });
    }
    this.recompute();
  }

  private stateForEvent(
    event: string,
    payload: Record<string, unknown>
  ): ClaudeState | null {
    switch (event) {
      case 'UserPromptSubmit':
      case 'PreToolUse':
      case 'PostToolUse':
        return 'working';
      case 'Notification': {
        // Claude Code also emits Notification("Claude is waiting for your
        // input") after ~60s of inactivity — that is not an approval prompt,
        // don't flash red for it.
        const message = String(payload.message ?? '');
        if (/waiting for (your )?input/i.test(message)) return null;
        return 'attention';
      }
      case 'Stop':
        return 'done';
      case 'SessionStart':
        return 'idle';
      default:
        return null;
    }
  }

  get aggregateState(): ClaudeState {
    this.gc();
    let best: ClaudeState = 'idle';
    for (const s of this.sessions.values()) {
      if (STATE_PRIORITY[s.state] > STATE_PRIORITY[best]) best = s.state;
    }
    return best;
  }

  get snapshots(): SessionSnapshot[] {
    this.gc();
    return [...this.sessions.values()].map((s) => ({ ...s }));
  }

  private gc(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.updatedAt > SESSION_STALE_MS) this.sessions.delete(id);
    }
  }

  private recompute(): void {
    if (this.decayTimer) {
      clearTimeout(this.decayTimer);
      this.decayTimer = null;
    }
    const agg = this.aggregateState;
    // "done" decays to idle: drop done-sessions after the decay window.
    if (agg === 'done') {
      this.decayTimer = setTimeout(() => {
        for (const [id, s] of this.sessions) {
          if (s.state === 'done') this.sessions.delete(id);
        }
        this.emit('change', this.aggregateState);
      }, this.doneDecayMs);
    }
    this.emit('change', agg);
  }
}
