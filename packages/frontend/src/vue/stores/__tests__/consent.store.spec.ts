import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConsentStore } from '@/stores/consent.store';
import { freshPinia } from '@/components/__tests__/mount-with-vuetify';

/**
 * The decision itself: what is remembered, what is not, and when the banner is
 * on screen. Loading and unloading the tag is deliberately NOT here — that is
 * `analytics/__tests__/start-analytics.spec.ts` — because the whole point of the
 * split is that a decision can be reasoned about without a DOM.
 */

const MEASUREMENT_ID = 'G-TESTID1234';
const CONSENT_KEY = 'gravindex.analytics-consent';
/** The other thing this app keeps in `localStorage`, and the one it must never join. */
const VOTER_TOKEN_KEY = 'gravindex.voter-token';

function store(stored?: string) {
  localStorage.clear();
  if (stored !== undefined) localStorage.setItem(CONSENT_KEY, stored);
  freshPinia();
  return useConsentStore();
}

beforeEach(() => {
  vi.stubEnv('VITE_GA4_ID', MEASUREMENT_ID);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('a visitor who has not been asked', () => {
  it('has consented to nothing, and sees the banner', () => {
    const consent = store();

    expect(consent.status).toBe('unknown');
    expect(consent.granted).toBe(false);
    expect(consent.decided).toBe(false);
    expect(consent.isPromptVisible).toBe(true);
  });

  it('is not asked at all when there is no measurement id', () => {
    // ⚠️ No id means no tag and no cookie, so there is nothing to consent to.
    // A banner here would be asking permission for something that never happens.
    vi.stubEnv('VITE_GA4_ID', '');
    const consent = store();

    expect(consent.configured).toBe(false);
    expect(consent.isPromptVisible).toBe(false);
    expect(consent.granted).toBe(false);
  });
});

describe('answering', () => {
  it('remembers a yes, and closes the banner', () => {
    const consent = store();

    consent.accept();

    expect(consent.granted).toBe(true);
    expect(consent.isPromptVisible).toBe(false);
    expect(localStorage.getItem(CONSENT_KEY)).toBe('granted');
  });

  it('remembers a no just as durably — refusing is not "ask me every time"', () => {
    const consent = store();

    consent.reject();

    expect(consent.granted).toBe(false);
    expect(consent.decided).toBe(true);
    expect(consent.isPromptVisible).toBe(false);
    expect(localStorage.getItem(CONSENT_KEY)).toBe('denied');
  });
});

describe('coming back', () => {
  it('restores a yes without asking again', () => {
    const consent = store('granted');

    expect(consent.granted).toBe(true);
    expect(consent.isPromptVisible).toBe(false);
  });

  it('restores a no without asking again', () => {
    const consent = store('denied');

    expect(consent.status).toBe('denied');
    expect(consent.granted).toBe(false);
    expect(consent.isPromptVisible).toBe(false);
  });

  it('treats anything else in storage as never having been asked', () => {
    // Hand-edited storage, a value from some future version, a truncated write.
    // ⚠️ The safe reading of "I cannot tell" is "no consent".
    for (const junk of ['true', 'yes', '{}', '', 'GRANTED']) {
      const consent = store(junk);
      expect(consent.status).toBe('unknown');
      expect(consent.granted).toBe(false);
    }
  });
});

describe('changing your mind', () => {
  it('reopens the banner from the footer, without changing the answer', () => {
    const consent = store('granted');

    consent.askAgain();

    expect(consent.isPromptVisible).toBe(true);
    // Still granted: reopening asks, it does not revoke.
    expect(consent.granted).toBe(true);
    expect(localStorage.getItem(CONSENT_KEY)).toBe('granted');
  });

  it('withdraws consent when the reopened banner is answered with no', () => {
    const consent = store('granted');

    consent.askAgain();
    consent.reject();

    expect(consent.granted).toBe(false);
    expect(consent.isPromptVisible).toBe(false);
    expect(localStorage.getItem(CONSENT_KEY)).toBe('denied');
  });

  it('closes without answering, and a dismissal is never read as a yes', () => {
    const consent = store();

    consent.dismissPrompt();

    expect(consent.isPromptVisible).toBe(false);
    expect(consent.granted).toBe(false);
    expect(consent.status).toBe('unknown');
    // Nothing stored, so the next visit asks again — which is the only honest
    // way to treat a question that was never answered.
    expect(localStorage.getItem(CONSENT_KEY)).toBeNull();
  });
});

describe('when storage will not cooperate', () => {
  it('behaves as if never asked, rather than throwing on boot', () => {
    // Safari with "block all cookies", a sandboxed iframe, a full quota.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });

    const consent = store();
    expect(consent.status).toBe('unknown');
  });

  it('still honours the decision for this page when it cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    const consent = store();
    expect(() => consent.accept()).not.toThrow();
    expect(consent.granted).toBe(true);
  });
});

describe('the anonymous voter token', () => {
  /**
   * ⚠️ Two identifiers, two purposes, never joined (root `CLAUDE.md`,
   * "Identity"): the voter token is an anonymous deduplication hint for votes,
   * GA4 has an identifier of its own and it is gated behind this decision.
   * Storing them under one key, or clearing one with the other, is how they
   * would quietly become the same thing.
   */
  it('lives under a different key, and consent never reads or writes it', () => {
    localStorage.setItem(VOTER_TOKEN_KEY, '11111111-2222-4333-8444-555555555555');
    freshPinia();
    const consent = useConsentStore();

    consent.accept();
    consent.askAgain();
    consent.reject();

    expect(CONSENT_KEY).not.toBe(VOTER_TOKEN_KEY);
    expect(localStorage.getItem(VOTER_TOKEN_KEY)).toBe('11111111-2222-4333-8444-555555555555');
    expect(localStorage.getItem(CONSENT_KEY)).toBe('denied');
  });
});
