/**
 * Unit tests for updateNavigatorUI function
 * Tests navigator visibility, label formatting, and button states
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

describe('updateNavigatorUI function', () => {
  let dom;
  let document;
  let updateNavigatorUI;
  let getNavigatedRange;

  beforeEach(() => {
    // Create a minimal DOM environment
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="hist-week-nav" style="display:none">
            <button id="hist-week-prev"></button>
            <span id="hist-week-label"></span>
            <button id="hist-week-next"></button>
          </div>
          <div id="hist-month-nav" style="display:none">
            <button id="hist-month-prev"></button>
            <span id="hist-month-label"></span>
            <button id="hist-month-next"></button>
          </div>
        </body>
      </html>
    `);
    document = dom.window.document;
    global.document = document;

    // Define getNavigatedRange function
    getNavigatedRange = function(rangeVal, weekOffset, monthOffset, customFrom, customTo) {
      const validWeekOffset = Number.isFinite(weekOffset) ? weekOffset : 0;
      const validMonthOffset = Number.isFinite(monthOffset) ? monthOffset : 0;
      const now = new Date();

      if (rangeVal === 'week') {
        const day = now.getDay();
        const currentMonday = new Date(now);
        currentMonday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
        currentMonday.setHours(0, 0, 0, 0);
        const targetMonday = new Date(currentMonday);
        targetMonday.setDate(currentMonday.getDate() + validWeekOffset * 7);
        const targetSunday = new Date(targetMonday);
        targetSunday.setDate(targetMonday.getDate() + 6);
        targetSunday.setHours(23, 59, 59, 999);
        return { from: targetMonday, to: targetSunday };
      }

      if (rangeVal === 'month') {
        const targetMonth = new Date(now.getFullYear(), now.getMonth() + validMonthOffset, 1, 0, 0, 0, 0);
        const targetMonthEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 23, 59, 59, 999);
        return { from: targetMonth, to: targetMonthEnd };
      }

      return { from: new Date(now - 24*60*60*1000), to: now };
    };

    // Define updateNavigatorUI function
    updateNavigatorUI = function(rangeVal, weekOffset, monthOffset) {
      const weekNav = document.getElementById('hist-week-nav');
      const monthNav = document.getElementById('hist-month-nav');
      const weekPrevBtn = document.getElementById('hist-week-prev');
      const weekNextBtn = document.getElementById('hist-week-next');
      const monthPrevBtn = document.getElementById('hist-month-prev');
      const monthNextBtn = document.getElementById('hist-month-next');
      const weekLabel = document.getElementById('hist-week-label');
      const monthLabel = document.getElementById('hist-month-label');

      if (weekNav) weekNav.style.display = 'none';
      if (monthNav) monthNav.style.display = 'none';

      if (rangeVal === 'week') {
        if (weekNav) weekNav.style.display = 'flex';
        const { from, to } = getNavigatedRange('week', weekOffset, 0, '', '');
        const monDay = from.getDate();
        const monMonth = from.toLocaleString('default', { month: 'short' });
        const sunDay = to.getDate();
        const sunMonth = to.toLocaleString('default', { month: 'short' });
        const year = to.getFullYear();
        if (weekLabel) {
          weekLabel.textContent = `Mon ${monDay} ${monMonth} – Sun ${sunDay} ${sunMonth} ${year}`;
        }
        if (weekPrevBtn) weekPrevBtn.disabled = false;
        if (weekNextBtn) weekNextBtn.disabled = (weekOffset >= 0);
      }

      if (rangeVal === 'month') {
        if (monthNav) monthNav.style.display = 'flex';
        const { from } = getNavigatedRange('month', 0, monthOffset, '', '');
        const monthName = from.toLocaleString('default', { month: 'long' });
        const year = from.getFullYear();
        if (monthLabel) {
          monthLabel.textContent = `${monthName} ${year}`;
        }
        if (monthPrevBtn) monthPrevBtn.disabled = false;
        if (monthNextBtn) monthNextBtn.disabled = (monthOffset >= 0);
      }
    };
  });

  afterEach(() => {
    delete global.document;
  });

  describe('Navigator Visibility', () => {
    it('should show week navigator and hide month navigator when range is "week"', () => {
      updateNavigatorUI('week', 0, 0);
      
      const weekNav = document.getElementById('hist-week-nav');
      const monthNav = document.getElementById('hist-month-nav');
      
      expect(weekNav.style.display).toBe('flex');
      expect(monthNav.style.display).toBe('none');
    });

    it('should show month navigator and hide week navigator when range is "month"', () => {
      updateNavigatorUI('month', 0, 0);
      
      const weekNav = document.getElementById('hist-week-nav');
      const monthNav = document.getElementById('hist-month-nav');
      
      expect(weekNav.style.display).toBe('none');
      expect(monthNav.style.display).toBe('flex');
    });

    it('should hide both navigators when range is "24h"', () => {
      updateNavigatorUI('24h', 0, 0);
      
      const weekNav = document.getElementById('hist-week-nav');
      const monthNav = document.getElementById('hist-month-nav');
      
      expect(weekNav.style.display).toBe('none');
      expect(monthNav.style.display).toBe('none');
    });

    it('should hide both navigators when range is "custom"', () => {
      updateNavigatorUI('custom', 0, 0);
      
      const weekNav = document.getElementById('hist-week-nav');
      const monthNav = document.getElementById('hist-month-nav');
      
      expect(weekNav.style.display).toBe('none');
      expect(monthNav.style.display).toBe('none');
    });
  });

  describe('Week Label Formatting', () => {
    it('should format week label as "Mon DD MMM – Sun DD MMM YYYY"', () => {
      updateNavigatorUI('week', 0, 0);
      
      const weekLabel = document.getElementById('hist-week-label');
      const labelText = weekLabel.textContent;
      
      // Check format: "Mon DD MMM – Sun DD MMM YYYY"
      expect(labelText).toMatch(/^Mon \d{1,2} \w{3} – Sun \d{1,2} \w{3} \d{4}$/);
    });

    it('should update week label for offset -1 (last week)', () => {
      updateNavigatorUI('week', -1, 0);
      
      const weekLabel = document.getElementById('hist-week-label');
      const labelText = weekLabel.textContent;
      
      expect(labelText).toMatch(/^Mon \d{1,2} \w{3} – Sun \d{1,2} \w{3} \d{4}$/);
    });
  });

  describe('Month Label Formatting', () => {
    it('should format month label as "MMMM YYYY"', () => {
      updateNavigatorUI('month', 0, 0);
      
      const monthLabel = document.getElementById('hist-month-label');
      const labelText = monthLabel.textContent;
      
      // Check format: "Month YYYY"
      expect(labelText).toMatch(/^\w+ \d{4}$/);
    });

    it('should update month label for offset -1 (last month)', () => {
      updateNavigatorUI('month', 0, -1);
      
      const monthLabel = document.getElementById('hist-month-label');
      const labelText = monthLabel.textContent;
      
      expect(labelText).toMatch(/^\w+ \d{4}$/);
    });
  });

  describe('Button States', () => {
    it('should enable "Previous week" button always', () => {
      updateNavigatorUI('week', 0, 0);
      const weekPrevBtn = document.getElementById('hist-week-prev');
      expect(weekPrevBtn.disabled).toBe(false);

      updateNavigatorUI('week', -5, 0);
      expect(weekPrevBtn.disabled).toBe(false);
    });

    it('should disable "Next week" button when weekOffset >= 0', () => {
      updateNavigatorUI('week', 0, 0);
      const weekNextBtn = document.getElementById('hist-week-next');
      expect(weekNextBtn.disabled).toBe(true);

      updateNavigatorUI('week', 1, 0);
      expect(weekNextBtn.disabled).toBe(true);
    });

    it('should enable "Next week" button when weekOffset < 0', () => {
      updateNavigatorUI('week', -1, 0);
      const weekNextBtn = document.getElementById('hist-week-next');
      expect(weekNextBtn.disabled).toBe(false);

      updateNavigatorUI('week', -5, 0);
      expect(weekNextBtn.disabled).toBe(false);
    });

    it('should enable "Previous month" button always', () => {
      updateNavigatorUI('month', 0, 0);
      const monthPrevBtn = document.getElementById('hist-month-prev');
      expect(monthPrevBtn.disabled).toBe(false);

      updateNavigatorUI('month', 0, -5);
      expect(monthPrevBtn.disabled).toBe(false);
    });

    it('should disable "Next month" button when monthOffset >= 0', () => {
      updateNavigatorUI('month', 0, 0);
      const monthNextBtn = document.getElementById('hist-month-next');
      expect(monthNextBtn.disabled).toBe(true);

      updateNavigatorUI('month', 0, 1);
      expect(monthNextBtn.disabled).toBe(true);
    });

    it('should enable "Next month" button when monthOffset < 0', () => {
      updateNavigatorUI('month', 0, -1);
      const monthNextBtn = document.getElementById('hist-month-next');
      expect(monthNextBtn.disabled).toBe(false);

      updateNavigatorUI('month', 0, -5);
      expect(monthNextBtn.disabled).toBe(false);
    });
  });
});
