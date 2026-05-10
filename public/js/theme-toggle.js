/**
 * Theme Toggle Button
 * Handles theme toggle button UI and interactions
 */

const ThemeToggle = {
  _button: null,
  _icon: null,

  /**
   * Initialize theme toggle button
   */
  init() {
    this._button = document.getElementById('theme-toggle-btn');
    if (!this._button) {
      console.error('Theme toggle button not found in DOM');
      return;
    }

    this._icon = this._button.querySelector('use');
    if (!this._icon) {
      console.error('Theme toggle icon not found');
      return;
    }

    // Attach click event listener
    this._button.addEventListener('click', () => {
      ThemeManager.toggle();
    });

    // Keyboard accessibility is implicit for button element
    // Enter and Space keys will trigger click event automatically
  },

  /**
   * Update button icon and aria-label based on current theme
   * @param {boolean} isDark - true if dark theme is active
   */
  updateIcon(isDark) {
    if (!this._button || !this._icon) return;

    if (isDark) {
      // Dark theme active: show sun icon, label says "Switch to light mode"
      this._icon.setAttribute('href', '#icon-sun');
      this._button.setAttribute('aria-label', 'Switch to light mode');
      this._button.setAttribute('title', 'Switch to light mode');
    } else {
      // Light theme active: show moon icon, label says "Switch to dark mode"
      this._icon.setAttribute('href', '#icon-moon');
      this._button.setAttribute('aria-label', 'Switch to dark mode');
      this._button.setAttribute('title', 'Switch to dark mode');
    }
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ThemeToggle;
}
