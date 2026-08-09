import { describe, it, expect } from 'vitest';
import {
  ORDER_STATUS, canTransition, assertTransition, allowedTransitions,
  isTerminal, roleMayTransition, TransitionError,
} from '../../src/domain/orders.js';

describe('order lifecycle state machine', () => {
  it('walks the full happy path', () => {
    const path = ['PENDING', 'MATCHED', 'IN_TRANSIT', 'DELIVERED', 'SETTLED'];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('allows cancellation only before goods move', () => {
    expect(canTransition('PENDING', 'CANCELLED')).toBe(true);
    expect(canTransition('MATCHED', 'CANCELLED')).toBe(true);
    // Once produce is on a truck, cancelling is a dispute, not a state change.
    expect(canTransition('IN_TRANSIT', 'CANCELLED')).toBe(false);
    expect(canTransition('DELIVERED', 'CANCELLED')).toBe(false);
  });

  it('refuses to skip stages', () => {
    expect(canTransition('PENDING', 'DELIVERED')).toBe(false);
    expect(canTransition('PENDING', 'SETTLED')).toBe(false);
    expect(canTransition('MATCHED', 'SETTLED')).toBe(false);
  });

  it('refuses to move backwards', () => {
    expect(canTransition('DELIVERED', 'IN_TRANSIT')).toBe(false);
    expect(canTransition('SETTLED', 'DELIVERED')).toBe(false);
    expect(canTransition('MATCHED', 'PENDING')).toBe(false);
  });

  it('treats SETTLED and CANCELLED as terminal', () => {
    expect(isTerminal('SETTLED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(allowedTransitions('SETTLED')).toEqual([]);
    expect(allowedTransitions('CANCELLED')).toEqual([]);
    expect(isTerminal('PENDING')).toBe(false);
  });

  describe('assertTransition', () => {
    it('returns the target on a legal move', () => {
      expect(assertTransition('PENDING', 'MATCHED')).toBe('MATCHED');
    });

    it('throws a 409 on an illegal move', () => {
      try {
        assertTransition('PENDING', 'SETTLED');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TransitionError);
        expect(err.statusCode).toBe(409);
        // The message must name the legal options - a 409 with no guidance is
        // a support ticket waiting to happen.
        expect(err.message).toContain('MATCHED');
      }
    });

    it('rejects a no-op transition', () => {
      expect(() => assertTransition('PENDING', 'PENDING')).toThrow(/already PENDING/);
    });

    it('rejects an unknown status', () => {
      expect(() => assertTransition('PENDING', 'TELEPORTED')).toThrow(/unknown target status/);
    });

    it('explains that terminal states are terminal', () => {
      expect(() => assertTransition('SETTLED', 'MATCHED')).toThrow(/terminal/);
    });
  });

  describe('role authority', () => {
    it('lets farmers move produce and buyers confirm receipt', () => {
      expect(roleMayTransition('farmer', 'IN_TRANSIT')).toBe(true);
      expect(roleMayTransition('buyer', 'DELIVERED')).toBe(true);
      expect(roleMayTransition('buyer', 'SETTLED')).toBe(true);
    });

    it('stops a farmer from settling their own sale', () => {
      expect(roleMayTransition('farmer', 'SETTLED')).toBe(false);
      expect(roleMayTransition('farmer', 'DELIVERED')).toBe(false);
    });

    it('stops a buyer from declaring goods dispatched', () => {
      expect(roleMayTransition('buyer', 'IN_TRANSIT')).toBe(false);
    });

    it('lets field agents act on either side', () => {
      for (const target of Object.values(ORDER_STATUS)) {
        if (target === 'PENDING') continue;
        expect(roleMayTransition('agent', target)).toBe(true);
      }
    });
  });
});
