// tests/feeding.property.test.js
// Feature: feeding-schedule-tab — Property-Based Tests
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ─── Pure logic extracted from feeding.js for testing ────────────────────────

/**
 * _scheduleStatus — returns 'completed' | 'upcoming' | 'scheduled' | 'not-today'
 * based on the 30-minute boundary rule relative to `nowMs` and day of week.
 */
function _scheduleStatus(timeStr, days, nowMs) {
  const [h, m] = timeStr.split(':').map(Number);
  const now = new Date(nowMs);
  const todayDay = now.getDay(); // 0 = Sunday, 6 = Saturday
  
  // Check if schedule applies to today
  if (!days || !days.includes(todayDay)) {
    return 'not-today';
  }
  
  const schedMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
  const diffMin = (schedMs - nowMs) / 60000;
  if (diffMin < 0)   return 'completed';
  if (diffMin <= 30) return 'upcoming';
  return 'scheduled';
}

/**
 * _nextScheduleKey — returns the next scheduleN key not in existingKeys.
 */
function _nextScheduleKey(existingKeys) {
  const nums = existingKeys
    .map((k) => parseInt(k.replace('schedule', ''), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `schedule${max + 1}`;
}

/**
 * _feedsTodayCount — count entries whose ts falls within today's calendar day.
 */
function _feedsTodayCount(logEntries, nowMs) {
  const now = new Date(nowMs);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfDay = startOfDay + 86400000;
  return logEntries.filter((e) => e.ts >= startOfDay && e.ts < endOfDay).length;
}

/**
 * _nextScheduleTime — returns the first future schedule ms or null.
 * Now considers day of week for recurring schedules.
 */
function _nextScheduleTime(schedules, nowMs) {
  const now = new Date(nowMs);
  const todayDay = now.getDay();
  
  // Helper to get ms for a specific day and time
  const getMs = (dayOffset, h, m) => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  
  const candidates = [];
  
  schedules.forEach((s) => {
    const [h, m] = s.time.split(':').map(Number);
    const days = s.days || [0, 1, 2, 3, 4, 5, 6];
    
    // Check each day in the schedule
    days.forEach((day) => {
      // Calculate how many days ahead this day is
      let daysAhead = day - todayDay;
      if (daysAhead < 0) daysAhead += 7; // Next week
      
      const ms = getMs(daysAhead, h, m);
      
      // Only include if it's in the future
      if (ms > nowMs) {
        candidates.push(ms);
      }
    });
  });
  
  if (candidates.length === 0) return null;
  
  // Return the earliest future occurrence
  return Math.min(...candidates);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FeedingModule — Property-Based Tests', () => {

  // Property 1: Schedule status is mutually exclusive and exhaustive
  // For any valid HH:MM time string, days array, and any current time, _scheduleStatus SHALL return
  // exactly one of "completed", "upcoming", "scheduled", or "not-today", and the result SHALL be
  // consistent with the 30-minute boundary rule and day-of-week matching.
  // Validates: Requirements 1.2, 1.3, 1.4
  it('Property 1: _scheduleStatus returns exactly one valid status and respects 30-min boundary + day matching', () => {
    const VALID_STATUSES = new Set(['completed', 'upcoming', 'scheduled', 'not-today']);

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),   // hour
        fc.integer({ min: 0, max: 59 }),   // minute
        fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 0, maxLength: 7 }), // days array
        fc.integer({ min: 0, max: 6 }),    // current day of week
        fc.integer({ min: 0, max: 23 }),   // current hour
        fc.integer({ min: 0, max: 59 }),   // current minute
        (schedH, schedM, days, nowDay, nowH, nowM) => {
          const timeStr = `${String(schedH).padStart(2, '0')}:${String(schedM).padStart(2, '0')}`;
          // Use a date where we can control the day of week
          // Jan 1, 2023 is a Sunday (day 0), so we can offset to get any day
          const baseDate = new Date(2023, 0, 1 + nowDay);
          const nowMs = new Date(2023, 0, 1 + nowDay, nowH, nowM, 0).getTime();
          const schedMs = new Date(2023, 0, 1 + nowDay, schedH, schedM, 0).getTime();
          const diffMin = (schedMs - nowMs) / 60000;
          
          // Deduplicate days array
          const uniqueDays = [...new Set(days)];

          const status = _scheduleStatus(timeStr, uniqueDays, nowMs);

          // Must be one of the four valid values
          if (!VALID_STATUSES.has(status)) return false;

          // If today is not in the days array, must be 'not-today'
          if (!uniqueDays.includes(nowDay)) {
            return status === 'not-today';
          }

          // If today IS in the days array, must respect the boundary rules
          if (diffMin < 0 && status !== 'completed') return false;
          if (diffMin >= 0 && diffMin <= 30 && status !== 'upcoming') return false;
          if (diffMin > 30 && status !== 'scheduled') return false;

          return true;
        }
      ),
      { numRuns: 200 }
    );
  });

  // Property 2: Next schedule key is always greater than all existing keys
  // For any set of existing scheduleN keys, _nextScheduleKey SHALL return a key whose
  // numeric suffix is strictly greater than the maximum existing suffix, and the returned
  // key SHALL NOT already exist in the set.
  // Validates: Requirements 2.3, 2.10
  it('Property 2: _nextScheduleKey suffix is strictly greater than all existing suffixes', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.integer({ min: 1, max: 100 }),
          { minLength: 0, maxLength: 20 }
        ),
        (suffixes) => {
          // Deduplicate to simulate real key sets
          const unique = [...new Set(suffixes)];
          const existingKeys = unique.map((n) => `schedule${n}`);

          const newKey = _nextScheduleKey(existingKeys);

          // Must not already exist
          if (existingKeys.includes(newKey)) return false;

          // Numeric suffix must be strictly greater than all existing
          const newNum = parseInt(newKey.replace('schedule', ''), 10);
          const maxExisting = unique.length ? Math.max(...unique) : 0;
          if (newNum <= maxExisting) return false;

          // Must follow scheduleN pattern
          if (!/^schedule\d+$/.test(newKey)) return false;

          return true;
        }
      ),
      { numRuns: 200 }
    );
  });

  // Property 3: Feeds Today count is consistent with log entries
  // For any array of log entries, the "Feeds Today" count SHALL equal the number of entries
  // whose ts falls within the current calendar day, and SHALL be ≤ the total number of entries.
  // Validates: Requirement 5.1
  it('Property 3: _feedsTodayCount equals filtered count and is ≤ total entries', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            ts: fc.integer({ min: 0, max: 2_000_000_000_000 }),
            type: fc.constantFrom('Manual', 'Auto'),
          }),
          { minLength: 0, maxLength: 50 }
        ),
        fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }), // nowMs
        (entries, nowMs) => {
          const count = _feedsTodayCount(entries, nowMs);

          // Must be ≤ total entries
          if (count > entries.length) return false;

          // Must equal the manually filtered count
          const now = new Date(nowMs);
          const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          const endOfDay = startOfDay + 86400000;
          const expected = entries.filter((e) => e.ts >= startOfDay && e.ts < endOfDay).length;

          return count === expected;
        }
      ),
      { numRuns: 200 }
    );
  });

  // Property 4: Next Feed derivation is always a future time or null
  // For any array of schedule entries (with days) and any current time, _nextScheduleTime SHALL return
  // either null (no future schedule in next 7 days) or a timestamp strictly greater than the current time.
  // Validates: Requirements 5.4, 5.6
  it('Property 4: _nextScheduleTime returns null or a timestamp strictly greater than now', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            key: fc.string({ minLength: 1, maxLength: 10 }),
            time: fc.tuple(
              fc.integer({ min: 0, max: 23 }),
              fc.integer({ min: 0, max: 59 })
            ).map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`),
            days: fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 0, maxLength: 7 }),
          }),
          { minLength: 0, maxLength: 10 }
        ),
        fc.integer({ min: 0, max: 6 }),    // current day of week
        fc.integer({ min: 0, max: 23 }),   // current hour
        fc.integer({ min: 0, max: 59 }),   // current minute
        (schedules, nowDay, nowH, nowM) => {
          // Jan 1, 2023 is a Sunday (day 0)
          const nowMs = new Date(2023, 0, 1 + nowDay, nowH, nowM, 0).getTime();
          
          // Deduplicate days in each schedule
          const cleanedSchedules = schedules.map(s => ({
            ...s,
            days: [...new Set(s.days)]
          }));
          
          const result = _nextScheduleTime(cleanedSchedules, nowMs);

          if (result === null) return true;           // null is always valid
          return result > nowMs;                      // must be strictly in the future
        }
      ),
      { numRuns: 200 }
    );
  });

});
