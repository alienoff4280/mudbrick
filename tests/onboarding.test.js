import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initOnboarding,
  showTip,
  shouldShowTour,
  startTour,
} from '../js/onboarding.js';

const TOUR_KEY = 'mudbrick-tour-complete';
const TIPS_KEY = 'mudbrick-seen-tips';
const SESSION_KEY = 'mudbrick-tips-session-count';

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  // End any active tour by clicking the skip button (which calls endTour)
  const skipBtn = document.querySelector('.tour-skip-btn');
  if (skipBtn) skipBtn.click();
  // Also click overlay as fallback
  const overlay = document.querySelector('.tour-overlay');
  if (overlay) overlay.click();
  // Clean up any remaining overlays/tooltips
  document.querySelectorAll('.tour-overlay, .tour-spotlight, .tour-tooltip, .contextual-tip')
    .forEach((el) => el.remove());
  vi.useRealTimers();
  delete window.__mbStartTour;
  delete window.__mbShowAbout;
});

/* ═══════════════════ shouldShowTour ═══════════════════ */

describe('shouldShowTour', () => {
  it('returns true when tour has not been completed', () => {
    expect(shouldShowTour()).toBe(true);
  });

  it('returns false when tour has been completed', () => {
    localStorage.setItem(TOUR_KEY, '1');
    expect(shouldShowTour()).toBe(false);
  });

  it('returns true after localStorage is cleared', () => {
    localStorage.setItem(TOUR_KEY, '1');
    localStorage.removeItem(TOUR_KEY);
    expect(shouldShowTour()).toBe(true);
  });
});

/* ═══════════════════ initOnboarding ═══════════════════ */

describe('initOnboarding', () => {
  it('exposes __mbStartTour on window', () => {
    initOnboarding();
    expect(window.__mbStartTour).toBeTypeOf('function');
  });

  it('exposes __mbShowAbout on window', () => {
    initOnboarding();
    expect(window.__mbShowAbout).toBeTypeOf('function');
  });

  it('checks localStorage for tour completion status', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem');
    initOnboarding();
    expect(spy).toHaveBeenCalledWith(TOUR_KEY);
    spy.mockRestore();
  });

  it('does not auto-start tour if already completed', () => {
    localStorage.setItem(TOUR_KEY, '1');
    initOnboarding();
    vi.advanceTimersByTime(1000);
    // No overlay should be created
    expect(document.querySelector('.tour-overlay')).toBeNull();
  });

  it('auto-starts tour on first visit when welcome screen is visible', () => {
    // Create a visible welcome screen
    const welcome = document.createElement('div');
    welcome.id = 'welcome-screen';
    document.body.appendChild(welcome);

    // Also create tour targets so the tour can render
    const dropZone = document.createElement('div');
    dropZone.id = 'drop-zone';
    document.body.appendChild(dropZone);

    initOnboarding();
    vi.advanceTimersByTime(1000);

    expect(document.querySelector('.tour-overlay')).not.toBeNull();
  });
});

/* ═══════════════════ startTour ═══════════════════ */

describe('startTour', () => {
  it('creates the tour overlay, spotlight, and tooltip elements', () => {
    startTour();
    expect(document.querySelector('.tour-overlay')).not.toBeNull();
    expect(document.querySelector('.tour-spotlight')).not.toBeNull();
    expect(document.querySelector('.tour-tooltip')).not.toBeNull();
  });

  it('shows the first step with correct title', () => {
    startTour();
    const title = document.querySelector('.tour-tooltip-title');
    expect(title).not.toBeNull();
    expect(title.textContent).toContain('Welcome');
  });

  it('does not create duplicate overlays when called twice', () => {
    startTour();
    startTour();
    const overlays = document.querySelectorAll('.tour-overlay');
    expect(overlays.length).toBe(1);
  });

  it('displays step indicator showing "1 of 5"', () => {
    startTour();
    const indicator = document.querySelector('.tour-step-indicator');
    expect(indicator.textContent).toContain('1 of 5');
  });

  it('has a skip button', () => {
    startTour();
    const skipBtn = document.querySelector('.tour-skip-btn');
    expect(skipBtn).not.toBeNull();
    expect(skipBtn.getAttribute('aria-label')).toBe('Skip tour');
  });
});

/* ═══════════════════ showTip ═══════════════════ */

describe('showTip', () => {
  it('creates a contextual tip element in the document', () => {
    showTip('test-tip', 'This is a helpful tip');
    const tip = document.querySelector('.contextual-tip');
    expect(tip).not.toBeNull();
    expect(tip.textContent).toContain('This is a helpful tip');
  });

  it('does not show the same tip twice', () => {
    showTip('duplicate-tip', 'First show');
    showTip('duplicate-tip', 'Second show');
    const tips = document.querySelectorAll('.contextual-tip');
    expect(tips.length).toBe(1);
  });

  it('stores seen tips in localStorage', () => {
    showTip('stored-tip', 'Check storage');
    const stored = JSON.parse(localStorage.getItem(TIPS_KEY));
    expect(stored).toContain('stored-tip');
  });

  it('limits tips to 3 per session', () => {
    showTip('tip-1', 'Tip 1');
    showTip('tip-2', 'Tip 2');
    showTip('tip-3', 'Tip 3');
    showTip('tip-4', 'Tip 4'); // should not appear
    const tips = document.querySelectorAll('.contextual-tip');
    expect(tips.length).toBe(3);
  });

  it('increments the session counter in sessionStorage', () => {
    showTip('session-tip', 'Session tip');
    const count = parseInt(sessionStorage.getItem(SESSION_KEY), 10);
    expect(count).toBe(1);
  });

  it('positions the tip near the anchor element when provided', () => {
    const anchor = document.createElement('button');
    anchor.textContent = 'Anchor';
    anchor.style.position = 'absolute';
    anchor.style.top = '100px';
    anchor.style.left = '200px';
    document.body.appendChild(anchor);

    showTip('anchor-tip', 'Near anchor', anchor);
    const tip = document.querySelector('.contextual-tip');
    expect(tip).not.toBeNull();
    expect(tip.style.position).toBe('fixed');
  });

  it('has a dismiss button', () => {
    showTip('dismiss-tip', 'Dismissable');
    const closeBtn = document.querySelector('.contextual-tip-close');
    expect(closeBtn).not.toBeNull();
    expect(closeBtn.getAttribute('aria-label')).toBe('Dismiss tip');
  });

  it('sets role="status" and aria-live="polite" for accessibility', () => {
    showTip('a11y-tip', 'Accessible tip');
    const tip = document.querySelector('.contextual-tip');
    expect(tip.getAttribute('role')).toBe('status');
    expect(tip.getAttribute('aria-live')).toBe('polite');
  });
});
