// tests/feeding-tab-device-migration.bugfix.test.js
// Bugfix: feeding-tab-device-migration — Bug Condition Exploration Test
// This test MUST FAIL on unfixed code - failure confirms the bug exists
// DO NOT attempt to fix the test or the code when it fails
// This test encodes the expected behavior - it will validate the fix when it passes

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';

// ─── Mock ES module dependencies ─────────────────────────────────────────────

// Mock Firebase client
vi.mock('../public/js/firebase-client.js', () => ({
  fbDatabase: vi.fn(() => ({})),
  fbRef: vi.fn((db, path) => ({ path })),
  fbOnValue: vi.fn((ref, callback) => {
    // Return unsubscribe function
    return () => {};
  }),
  fbSet: vi.fn(() => Promise.resolve()),
  fbGet: vi.fn(() => Promise.resolve({
    forEach: (cb) => {},
  })),
}));

// Mock charts
vi.mock('../public/js/charts.js', () => ({
  initFeedingChart: vi.fn(() => ({
    data: {
      labels: [],
      datasets: [{ data: [] }],
    },
    update: vi.fn(),
  })),
}));

// Mock pond-context.js to return null (simulating the bug condition)
vi.mock('../public/js/pond-context.js', () => ({
  getActivePond: vi.fn(() => null), // Returns null - pond selection removed
}));

// ─── Bug Condition Exploration Test ──────────────────────────────────────────
// Property 1: Bug Condition - Feeding Tab Stuck in "No Pond" State
//
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
//
// For any page navigation event where the feeding tab is loaded or navigated to,
// when getActivePond() returns null (because pond selection has been removed),
// the feeding module displays "No pond selected" message, hides feeding content,
// waits for 'active-pond-changed' event that never fires, and does not initialize
// with device001.
//
// EXPECTED OUTCOME ON UNFIXED CODE: Tests FAIL
// - "No pond" message is displayed (this IS the bug)
// - Feeding content is hidden (this IS the bug)
// - Module does not initialize with device001 (this IS the bug)
// - Module registers 'active-pond-changed' event listener (this IS the bug)
//
// EXPECTED OUTCOME ON FIXED CODE: Tests PASS
// - "No pond" message is hidden
// - Feeding content is visible
// - Module initializes with device001
// - Module does NOT register 'active-pond-changed' event listener

describe('Feeding Tab Device Migration — Bug Condition Exploration', () => {
  let dom;
  let window;
  let document;
  let feedingModule;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Load the real HTML
    const html = readFileSync('public/index.html', 'utf-8');
    dom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: 'http://localhost',
    });
    window = dom.window;
    document = dom.window.document;

    // Mock window._rbacPerms for permission checks
    window._rbacPerms = {
      canTriggerFeed: true,
      canEditSchedules: true,
    };

    // Stub requestAnimationFrame
    window.requestAnimationFrame = vi.fn(cb => cb());

    // Set global document and window for the module
    globalThis.document = document;
    globalThis.window = window;
  });

  afterEach(() => {
    if (dom) {
      dom.window.close();
    }
    // Restore globals
    globalThis.document = undefined;
    globalThis.window = undefined;
  });

  /**
   * Property 1 — Test 1: "No pond" message should be HIDDEN (not displayed)
   *
   * isBugCondition: noPondMessage.isVisible == true AND getActivePond() == null
   *
   * On UNFIXED code: Message is visible (display !== 'none') → FAILS
   * On FIXED code:   Message is hidden (display === 'none') → PASSES
   */
  it('Test 1: "No pond" message should be hidden when feeding tab loads', async () => {
    const { init } = await import('../public/js/features/feeding.js');

    // Initialize feeding module
    init();

    // Allow async operations to complete
    await new Promise(r => setTimeout(r, 50));

    const noPondElement = document.getElementById('feed-no-pond');
    expect(noPondElement).not.toBeNull();

    // On UNFIXED code: noPondElement.style.display !== 'none' (message is visible) → FAILS
    // On FIXED code:   noPondElement.style.display === 'none' (message is hidden) → PASSES
    expect(noPondElement.style.display).toBe('none');
  });

  /**
   * Property 1 — Test 2: Feeding content should be VISIBLE (not hidden)
   *
   * isBugCondition: feedingContent.isHidden == true AND getActivePond() == null
   *
   * On UNFIXED code: Content is hidden (display === 'none') → FAILS
   * On FIXED code:   Content is visible (display !== 'none') → PASSES
   */
  it('Test 2: Feeding content should be visible when feeding tab loads', async () => {
    const { init } = await import('../public/js/features/feeding.js');

    // Initialize feeding module
    init();

    // Allow async operations to complete
    await new Promise(r => setTimeout(r, 50));

    const contentElement = document.getElementById('feed-content');
    expect(contentElement).not.toBeNull();

    // On UNFIXED code: contentElement.style.display === 'none' (content is hidden) → FAILS
    // On FIXED code:   contentElement.style.display !== 'none' (content is visible) → PASSES
    expect(contentElement.style.display).not.toBe('none');
  });

  /**
   * Property 1 — Test 3: Module should initialize with device001
   *
   * isBugCondition: _deviceId != 'device001' AND getActivePond() == null
   *
   * On UNFIXED code: Module does not subscribe to device001 RTDB paths → FAILS
   * On FIXED code:   Module subscribes to device001 RTDB paths → PASSES
   */
  it('Test 3: Module should initialize with device001 and subscribe to RTDB paths', async () => {
    const { fbRef, fbOnValue } = await import('../public/js/firebase-client.js');
    const { init } = await import('../public/js/features/feeding.js');

    // Initialize feeding module
    init();

    // Allow async operations to complete
    await new Promise(r => setTimeout(r, 50));

    // On UNFIXED code: fbRef and fbOnValue are NOT called with device001 paths → FAILS
    // On FIXED code:   fbRef and fbOnValue ARE called with device001 paths → PASSES

    // Check that fbRef was called with device001 paths
    const refCalls = fbRef.mock.calls;
    const device001Calls = refCalls.filter(call => 
      call[1] && call[1].includes('/devices/device001/')
    );

    // Should have at least 3 subscriptions: schedules, feedLog, manualFeed
    expect(device001Calls.length).toBeGreaterThanOrEqual(3);

    // Verify specific paths
    const paths = device001Calls.map(call => call[1]);
    expect(paths).toContain('/devices/device001/feeding/schedules/times');
    expect(paths).toContain('/devices/device001/feedLog');
    expect(paths).toContain('/devices/device001/feeding/manualFeed');
  });

  /**
   * Property 1 — Test 4: Module should NOT register 'active-pond-changed' event listener
   *
   * isBugCondition: activePondChangedListenerRegistered == true
   *
   * On UNFIXED code: Event listener is registered → FAILS
   * On FIXED code:   Event listener is NOT registered → PASSES
   */
  it('Test 4: Module should NOT register active-pond-changed event listener', async () => {
    // Track addEventListener calls
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

    const { init } = await import('../public/js/features/feeding.js');

    // Initialize feeding module
    init();

    // Allow async operations to complete
    await new Promise(r => setTimeout(r, 50));

    // Check if 'active-pond-changed' listener was registered
    const activePondChangedCalls = addEventListenerSpy.mock.calls.filter(
      call => call[0] === 'active-pond-changed'
    );

    // On UNFIXED code: activePondChangedCalls.length > 0 (listener is registered) → FAILS
    // On FIXED code:   activePondChangedCalls.length === 0 (listener is NOT registered) → PASSES
    expect(activePondChangedCalls.length).toBe(0);
  });

  /**
   * Property 1 — Test 5: Module should NOT call getActivePond()
   *
   * isBugCondition: getActivePond() is called during initialization
   *
   * On UNFIXED code: getActivePond() is called → FAILS
   * On FIXED code:   getActivePond() is NOT called → PASSES
   */
  it('Test 5: Module should NOT call getActivePond() during initialization', async () => {
    const { getActivePond } = await import('../public/js/pond-context.js');
    const { init } = await import('../public/js/features/feeding.js');

    // Initialize feeding module
    init();

    // Allow async operations to complete
    await new Promise(r => setTimeout(r, 50));

    // On UNFIXED code: getActivePond was called → FAILS
    // On FIXED code:   getActivePond was NOT called → PASSES
    expect(getActivePond).not.toHaveBeenCalled();
  });

  /**
   * Property 1 — Test 6: Manual feed button should be enabled and functional
   *
   * isBugCondition: manualFeedButton.disabled == true OR manualFeedButton.notVisible
   *
   * On UNFIXED code: Button may be hidden or non-functional because content is hidden → FAILS
   * On FIXED code:   Button is visible and enabled → PASSES
   */
  it('Test 6: Manual feed button should be enabled and functional', async () => {
    const { init } = await import('../public/js/features/feeding.js');

    // Initialize feeding module
    init();

    // Allow async operations to complete
    await new Promise(r => setTimeout(r, 50));

    const manualFeedButton = document.getElementById('feed-manual-btn');
    expect(manualFeedButton).not.toBeNull();

    // On UNFIXED code: Button is hidden (parent content is hidden) → FAILS
    // On FIXED code:   Button is visible and enabled → PASSES
    expect(manualFeedButton.disabled).toBe(false);

    // Check that the button's parent content is visible
    const contentElement = document.getElementById('feed-content');
    expect(contentElement.style.display).not.toBe('none');
  });
});
