/* toggleTheme.js — non-module, runs before the main app module */
(function () {
  const btn  = document.getElementById('theme-toggle');
  const body = document.body;

  function updateIcon() {
    if (!btn) return;
    const isDark = body.classList.contains('dark-theme');
    btn.innerHTML = isDark
      ? '<i class="fas fa-sun"></i>'
      : '<i class="fas fa-moon"></i>';
  }

  /* Apply saved / system preference immediately (no transition flash) */
  const saved = localStorage.getItem('lp-theme');
  if (saved === 'dark') {
    body.classList.add('dark-theme');
  } else if (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    body.classList.add('dark-theme');
  }
  updateIcon();

  /* Enable transitions after initial paint */
  setTimeout(() => body.classList.add('enable-transition'), 50);

  if (btn) {
    btn.addEventListener('click', () => {
      body.classList.toggle('dark-theme');
      const isDark = body.classList.contains('dark-theme');
      localStorage.setItem('lp-theme', isDark ? 'dark' : 'light');
      updateIcon();
    });
  }
})();
