import { createHash, randomBytes } from 'node:crypto';

const TRANSITIONS = {
  prepared: new Set(['cancelled', 'confirmed', 'failed']),
  cancelled: new Set(),
  confirmed: new Set(['restarting', 'failed']),
  restarting: new Set(['applied', 'failed']),
  applied: new Set(),
  failed: new Set(),
};

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function transitionRecord(base, status, extra = {}) {
  return {
    ...base,
    ...extra,
    status,
    history: [...(Array.isArray(base.history) ? base.history : []), status],
    at: new Date().toISOString(),
  };
}

export function createApprovalToken({ now = Date.now(), ttlMs = 5 * 60_000 } = {}) {
  const token = randomBytes(24).toString('hex');
  return { token, tokenHash: hashToken(token), expiresAt: now + ttlMs };
}

export class OperationStateMachine {
  constructor({ restart = async () => {}, now = () => Date.now() } = {}) {
    this.state = 'prepared';
    this.restart = restart;
    this.now = now;
    this.restartCount = 0;
    this.record = [];
    this.approval = createApprovalToken({ now: this.now() });
  }

  transition(next) {
    if (!TRANSITIONS[this.state]?.has(next)) throw new Error(`invalid operation transition: ${this.state} -> ${next}`);
    this.record.push({ from: this.state, to: next });
    this.state = next;
  }

  cancel() {
    this.transition('cancelled');
    return this.snapshot();
  }

  confirm(token) {
    if (this.state !== 'prepared') throw new Error('operation is no longer confirmable');
    if (typeof token !== 'string' || !token) throw new Error('confirmation token is required');
    if (this.approval.used) throw new Error('confirmation token already used');
    if (this.now() > this.approval.expiresAt) throw new Error('confirmation token expired');
    if (hashToken(token) !== this.approval.tokenHash) throw new Error('confirmation token invalid');
    this.approval.used = true;
    this.transition('confirmed');
    return this.snapshot();
  }

  async restartOnce() {
    if (this.state !== 'confirmed') throw new Error('operation is not confirmed');
    if (this.restartCount >= 1) throw new Error('restart limit exceeded');
    this.transition('restarting');
    this.restartCount += 1;
    try {
      await this.restart();
    } catch (error) {
      this.transition('failed');
      throw error;
    }
    return this.snapshot();
  }

  applied() {
    if (this.state === 'confirmed') this.transition('restarting');
    if (this.state !== 'restarting') throw new Error('operation is not restarting');
    this.transition('applied');
    return this.snapshot();
  }

  fail(error) {
    if (this.state !== 'failed' && TRANSITIONS[this.state]?.has('failed')) this.transition('failed');
    return { ...this.snapshot(), error: error?.message ?? String(error) };
  }

  snapshot() {
    return { state: this.state, restartCount: this.restartCount, transitions: [...this.record], expiresAt: this.approval.expiresAt };
  }
}
