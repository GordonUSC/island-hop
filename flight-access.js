/* Keep the gift readable when WebGL or its module/CDN fails. No save data is changed. */
(function () {
  var root = document.documentElement;
  // Retain the reading invitation from the concurrently reviewed draft.
  if (new URLSearchParams(location.search).get('pilot') === 'cale') {
    document.querySelectorAll('.pilot-invitation').forEach(function (note) { note.hidden = false; });
  }
  var start = document.getElementById('start');
  var read = document.getElementById('read');
  var back = document.getElementById('backWorld');
  var returnToWelcome = false;

  /* Reading from the welcome must return to a usable welcome, before flight starts. */
  read.onclick = function () {
    returnToWelcome = !start.hidden;
    root.classList.add('reading');
    start.hidden = true;
    document.getElementById('voice').pause();
    scrollTo(0, 0);
    document.getElementById('readingStart').focus({ preventScroll: true });
  };
  back.onclick = function () {
    root.classList.remove('reading');
    scrollTo(0, 0);
    if (window.__hop && window.__hop.glLost && window.__hop.glLost()) {
      document.getElementById('gl').hidden = false;
      document.getElementById('glReload').focus({ preventScroll: true });
    } else if (returnToWelcome) {
      start.hidden = false;
      read.focus({ preventScroll: true });
    } else {
      document.getElementById('help').focus({ preventScroll: true });
    }
  };

  /* CSS hides the trailer in calm mode; pause the media itself as well. */
  var trailer = start.querySelector('.trailer');
  var motion = matchMedia('(prefers-reduced-motion: reduce)');
  var calm = motion.matches;
  try {
    var savedCalm = localStorage.getItem('islandhop-calm');
    if (savedCalm !== null) calm = savedCalm === '1';
  } catch (e) {}
  root.classList.toggle('calm', calm);
  function syncTrailer() {
    var visible = root.classList.contains('has3d') && !root.classList.contains('reading') &&
      !start.hidden && !document.hidden && !root.classList.contains('calm') && !motion.matches;
    if (!visible) trailer.pause();
    else if (trailer.paused) {
      var playback = trailer.play();
      if (playback && playback.catch) playback.catch(function () {});
    }
  }
  var trailerObserver = new MutationObserver(syncTrailer);
  trailerObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
  trailerObserver.observe(start, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', syncTrailer);
  if (motion.addEventListener) motion.addEventListener('change', syncTrailer);
  else if (motion.addListener) motion.addListener(syncTrailer);
  trailer.addEventListener('play', syncTrailer);
  syncTrailer();

  window.islandHopReadFallback = function () {
    root.classList.remove('has3d');
    root.classList.add('reading');
    document.getElementById('start').hidden = true;
    document.getElementById('gl').hidden = true;
    document.getElementById('flight-fallback').hidden = false;
    document.querySelectorAll('audio, video').forEach(function (media) { media.pause(); });
  };
})();
