// The theme: system, light, or dark. Loaded from <head> as a classic script so
// the class is set before the first paint; the toggle button is wired once the
// page has loaded. It is a file rather than an inline script so the site's
// Content-Security-Policy needs no exception for it.
(function () {
  var KEY = 'theme';
  var CYCLE = ['system', 'light', 'dark'];
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  function readMode() {
    try {
      var v = localStorage.getItem(KEY);
      if (v === 'light' || v === 'dark') return v;
    } catch (e) {}
    return 'system';
  }
  function apply(mode) {
    var dark = mode === 'dark' || (mode === 'system' && media.matches);
    document.documentElement.classList.toggle('dark', dark);
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-label', 'Theme: ' + mode + (mode === 'system' ? ' (' + (dark ? 'dark' : 'light') + ')' : ''));
      btn.querySelectorAll('[data-theme-icon]').forEach(function (icon) {
        icon.classList.toggle('is-hidden', icon.getAttribute('data-theme-icon') !== mode);
      });
    });
  }
  apply(readMode());
  document.addEventListener('DOMContentLoaded', function () {
    apply(readMode());
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = CYCLE[(CYCLE.indexOf(readMode()) + 1) % CYCLE.length];
        try {
          if (next === 'system') localStorage.removeItem(KEY);
          else localStorage.setItem(KEY, next);
        } catch (e) {}
        apply(next);
      });
    });
  });
  media.addEventListener('change', function () {
    if (readMode() === 'system') apply('system');
  });
})();
