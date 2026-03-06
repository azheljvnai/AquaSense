/**
 * Reports feature: Daily/Weekly/Monthly Water Quality and Feeding Report tabs.
 */
export function init() {
  document.querySelectorAll('.tab-btn[data-report-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-report-tab');
      const container = btn.closest('.report-tabs');
      if (!container) return;
      container.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      container.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      const content = document.getElementById('tab-' + tab);
      if (content) content.classList.add('active');
    });
  });
}
