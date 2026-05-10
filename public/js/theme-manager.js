/**
 * Theme Manager
 * Manages light/dark theme switching and persistence
 */

const ThemeManager = {
  STORAGE_KEY: 'aquasense.theme.v1',
  _currentTheme: 'light',
  _updateCallback: null,

  /**
   * Initialize theme manager
   * Reads saved preference and applies theme
   */
  init(updateCallback) {
    this._updateCallback = updateCallback;
    const savedTheme = this.loadPreference();
    
    if (savedTheme) {
      this._currentTheme = savedTheme;
      this.applyTheme(savedTheme);
    } else {
      // Check if theme-dark class was applied by inline script
      if (document.documentElement.classList.contains('theme-dark') || 
          document.body.classList.contains('theme-dark')) {
        this._currentTheme = 'dark';
      } else {
        this._currentTheme = 'light';
      }
    }

    // Notify UI to update
    if (this._updateCallback) {
      this._updateCallback(this._currentTheme === 'dark');
    }
  },

  /**
   * Toggle between light and dark themes
   */
  toggle() {
    const newTheme = this._currentTheme === 'light' ? 'dark' : 'light';
    this.applyTheme(newTheme);
    this.savePreference(newTheme);
    this._currentTheme = newTheme;

    // Notify UI to update
    if (this._updateCallback) {
      this._updateCallback(newTheme === 'dark');
    }
  },

  /**
   * Apply a specific theme
   * @param {string} theme - 'light' or 'dark'
   */
  applyTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') {
      console.warn('Invalid theme value, defaulting to light');
      theme = 'light';
    }

    if (theme === 'dark') {
      document.body.classList.add('theme-dark');
      // Also remove from documentElement if it was added by inline script
      document.documentElement.classList.remove('theme-dark');
    } else {
      document.body.classList.remove('theme-dark');
      document.documentElement.classList.remove('theme-dark');
    }
  },

  /**
   * Get current theme
   * @returns {string} 'light' or 'dark'
   */
  getCurrentTheme() {
    return this._currentTheme;
  },

  /**
   * Save theme preference to localStorage
   * @param {string} theme - 'light' or 'dark'
   */
  savePreference(theme) {
    try {
      localStorage.setItem(this.STORAGE_KEY, theme);
    } catch (e) {
      console.warn('Theme preference cannot be saved: localStorage unavailable', e);
    }
  },

  /**
   * Load theme preference from localStorage
   * @returns {string|null} 'light', 'dark', or null if not found
   */
  loadPreference() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') {
        return saved;
      }
      if (saved !== null) {
        console.warn('Invalid theme preference, defaulting to light');
      }
      return null;
    } catch (e) {
      console.warn('Cannot load theme preference: localStorage unavailable', e);
      return null;
    }
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ThemeManager;
}
