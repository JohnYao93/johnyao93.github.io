/*
 * Coming Soon mode for the Flash ALOHA and SPAR pages.
 *
 *   COMING_SOON = true   -> homepage links point to /coming-soon/, and the
 *                           project pages redirect there.
 *   COMING_SOON = false  -> everything behaves normally (launch).
 *
 * Preview while in Coming Soon mode: open any page with ?preview
 * (e.g. /?preview or /flash-aloha/?preview). It sticks for the browser tab
 * (sessionStorage). Turn it off with ?preview=off.
 *
 * Links that are gated carry data-real-href="..." (their real target);
 * elements with class "cs-label" are shown only while gated.
 * A page that should itself be gated sets data-coming-soon on <html>.
 */
(function () {
  var COMING_SOON = true;

  var preview = false;
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('preview') === 'off') sessionStorage.removeItem('cs-preview');
    else if (q.has('preview')) sessionStorage.setItem('cs-preview', '1');
    preview = sessionStorage.getItem('cs-preview') === '1';
  } catch (e) {
    preview = /[?&]preview(?!=off)/.test(location.search);
  }

  var gated = COMING_SOON && !preview;

  if (gated && document.documentElement.hasAttribute('data-coming-soon')) {
    location.replace('/coming-soon/');
    return;
  }

  if (gated) return;

  function reveal() {
    document.querySelectorAll('[data-real-href]').forEach(function (a) {
      a.setAttribute('href', a.getAttribute('data-real-href'));
    });
    document.querySelectorAll('.cs-label').forEach(function (el) { el.remove(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reveal);
  else reveal();
})();
