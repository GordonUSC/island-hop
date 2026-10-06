/* Keep the gift readable when WebGL or its module/CDN fails. No save data is changed. */
(function () {
  var root = document.documentElement;
  window.islandHopReadFallback = function () {
    root.classList.remove('has3d');
    root.classList.add('reading');
    document.getElementById('start').hidden = true;
    document.getElementById('gl').hidden = true;
    document.getElementById('flight-fallback').hidden = false;
    document.querySelectorAll('audio, video').forEach(function (media) { media.pause(); });
  };
  if (new URLSearchParams(location.search).get('pilot') === 'cale') {
    document.querySelectorAll('.pilot-invitation').forEach(function (note) { note.hidden = false; });
  }
})();
