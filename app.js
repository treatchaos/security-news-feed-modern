document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("news-container");
  const themeToggle = document.getElementById("theme-toggle");
  const searchInput = document.getElementById("search");
  const sortSelect = document.getElementById("sort");
  const clearFilters = document.getElementById("clear-filters");
  const statsEl = document.getElementById("stats");
  const loader = document.getElementById("loader");
  const emptyState = document.getElementById("empty-state");
  const scrollTopBtn = document.getElementById("scroll-top");
  const aboutLink = document.getElementById("about-link");
  const aboutDialog = document.getElementById("about-dialog");
  const refreshBtn = document.getElementById("refresh-btn");
  const yearEl = document.getElementById("year");
  const iconSun = document.getElementById("icon-sun");
  const iconMoon = document.getElementById("icon-moon");
  const datasetControls = document.getElementById('dataset-controls');
  const segButtons = () => Array.from(datasetControls.querySelectorAll('.seg-btn'));
  const daySelect = document.getElementById('day-select');
  const daySelectLabel = document.getElementById('day-select-label');
  const datasetBadges = document.getElementById('dataset-badges');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const fb = window.firebaseCtx || null;
  let currentUser = null;

  function updateDatasetAuthState(authed){
    // Disable Archive & Day buttons when not authed
    segButtons().forEach(btn => {
      const m = btn.dataset.mode;
      const shouldDisable = !authed && (m === 'archive' || m === 'day');
      btn.setAttribute('aria-disabled', shouldDisable ? 'true' : 'false');
      btn.classList.toggle('opacity-50', shouldDisable);
      btn.classList.toggle('cursor-not-allowed', shouldDisable);
      if (shouldDisable && m !== 'latest' && btn.classList.contains('active')) {
        // Ensure Latest stays active
        const latestBtn = segButtons().find(b=>b.dataset.mode==='latest');
        latestBtn?.classList.add('active'); latestBtn?.setAttribute('aria-pressed','true');
        btn.classList.remove('active'); btn.setAttribute('aria-pressed','false');
      }
    });
  }

  // Intercept clicks on segmented control
  datasetControls.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    const disabled = btn.getAttribute('aria-disabled') === 'true';
    const targetMode = btn.dataset.mode;
    if (disabled) {
      // Soft prompt; do not switch
      if (!currentUser) alert('Sign in to view Archive and Day.');
      return;
    }
    setMode(targetMode);
  });

  yearEl.textContent = new Date().getFullYear();

  let allNews = [];
  let filtered = [];
  let mode = 'latest'; // 'latest' | 'archive' | 'day'
  let historyIndex = null; // loaded index.json
  let currentDay = null; // selected day
  let archiveMeta = null; // archive metadata for badges

  // Theme handling
  function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.body.classList.toggle('dark', isDark);
    iconSun.classList.toggle('hidden', !isDark);
    iconMoon.classList.toggle('hidden', isDark);
  }
  const storedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(storedTheme);

  themeToggle.addEventListener('click', () => {
    const newTheme = document.body.classList.contains('dark') ? 'light' : 'dark';
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
  });

  function showLoader(count = 9) {
    loader.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const sk = document.createElement('div');
      sk.className = 'skeleton';
      loader.appendChild(sk);
    }
  }

  function hideLoader() { loader.innerHTML = ''; }

  function renderStats() {
    statsEl.classList.remove('hidden');
    const windowText = mode === 'latest' ? 'last 30 days' : (mode === 'archive' ? `archive (${archiveMeta?.retention_days || 0}d)` : (currentDay || '')); 
    statsEl.innerHTML = `<strong>${filtered.length}</strong> shown <span class="opacity-70">(${windowText})</span>`;
  }

  function normalizeDate(d) {
    if (!d) return 0;
    const parsed = Date.parse(d);
    return isNaN(parsed) ? 0 : parsed;
  }

  function applyFilters() {
    const q = (searchInput.value || '').toLowerCase();
    filtered = allNews.filter(item => !q || (item.title + ' ' + item.description).toLowerCase().includes(q));

    switch (sortSelect.value) {
      case 'oldest':
        filtered.sort((a,b)=> normalizeDate(a.date)-normalizeDate(b.date));
        break;
      case 'az':
        filtered.sort((a,b)=> a.title.localeCompare(b.title));
        break;
      case 'za':
        filtered.sort((a,b)=> b.title.localeCompare(a.title));
        break;
      default:
        filtered.sort((a,b)=> normalizeDate(b.date)-normalizeDate(a.date));
    }

    render();
  }

  function render() {
    container.innerHTML = '';
    if (!filtered.length) {
      emptyState.classList.remove('hidden');
      renderStats();
      return;
    }
    emptyState.classList.add('hidden');

    filtered.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'news-card bg-white dark:bg-gray-800 rounded-lg shadow p-5 hover:shadow-lg transition-shadow duration-300 focus-within:ring-2 focus-within:ring-blue-500';
      const dateStr = item.date ? new Date(item.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }).replace(/,\s*/, ' ') : '';
      card.innerHTML = `
        <div class="mb-3">
          <h2 class="text-lg font-semibold leading-snug"><a href="${item.link}" target="_blank" rel="noopener" class="hover:underline break-words">${item.title}</a></h2>
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">${dateStr}</p>
        <p class="text-sm leading-relaxed mb-4 line-clamp">${item.description || ''}</p>
        <div class="flex justify-between items-center text-sm">
          <a href="${item.link}" target="_blank" rel="noopener" class="text-blue-600 dark:text-blue-400 font-medium hover:underline">Read More</a>
          <button class="copy-btn text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" data-link="${item.link}" title="Copy link">Copy</button>
        </div>`;
      container.appendChild(card);
      setTimeout(() => card.classList.add('visible'), index * 50);
    });
    attachCopyHandlers();
    renderStats();
  }

  function attachCopyHandlers() {
    container.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const link = btn.getAttribute('data-link');
        navigator.clipboard.writeText(link).then(() => {
          const original = btn.textContent;
            btn.textContent = 'Copied';
            setTimeout(()=> btn.textContent = original, 1200);
        });
      });
    });
  }

  function setMode(newMode) {
    if (mode === newMode) return;
    mode = newMode;
    segButtons().forEach(btn => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    // Show/Hide day selector
    const showDay = mode === 'day';
    daySelect.classList.toggle('hidden', !showDay);
    daySelectLabel.classList.toggle('hidden', !showDay);
    // Load appropriate dataset
    if (mode === 'latest') {
      fetchNews();
    } else if (mode === 'archive') {
      fetchArchive();
    } else if (mode === 'day') {
      ensureHistoryIndex().then(() => {
        if (!currentDay && historyIndex?.days?.length) {
          currentDay = historyIndex.days[0].date;
          buildDaySelect();
        }
        if (currentDay) fetchDay(currentDay);
      });
    }
  }

  function updateSegmentedSlider() {
    const wrapper = datasetControls.querySelector('.segmented');
    const activeBtn = wrapper.querySelector('.seg-btn.active');
    if (!activeBtn) return;
    const rect = activeBtn.getBoundingClientRect();
    const wRect = wrapper.getBoundingClientRect();
    wrapper.style.setProperty('--seg-w', rect.width + 'px');
    wrapper.style.setProperty('--seg-x', (rect.left - wRect.left) + 'px');
  }
  window.addEventListener('resize', updateSegmentedSlider);

  function buildBadges() {
    datasetBadges.innerHTML = '';
    if (mode === 'archive' && archiveMeta) {
      addBadge('archive', `${archiveMeta.count} items`, 'Archive size');
      addBadge('archive', `${archiveMeta.retention_days}d retention`, 'Retention window');
    }
    if (mode === 'day' && currentDay) {
      addBadge('day', currentDay, 'Selected day');
    }
  }
  function addBadge(modeValue, text, title) {
    const span = document.createElement('span');
    span.className = 'badge';
    span.dataset.mode = modeValue;
    span.textContent = text;
    if (title) span.title = title;
    datasetBadges.appendChild(span);
  }

  function showSignInRequired() {
    // No longer hide the feed; we allow Latest before login
    // Optionally could show a small hint somewhere; skipping for now
  }

  // ---- Auth wiring (if Firebase present) ----
  if (fb && fb.auth) {
    // Buttons
    loginBtn?.addEventListener('click', async () => {
      try {
        const provider = new fb.GoogleAuthProvider();
        await fb.signInWithPopup(fb.auth, provider);
      } catch (e) { console.error(e); }
    });
    logoutBtn?.addEventListener('click', async () => {
      try { await fb.signOut(fb.auth); } catch (e) { console.error(e); }
    });

    fb.onAuthStateChanged(fb.auth, (user) => {
      currentUser = user || null;
      loginBtn?.classList.toggle('hidden', !!user);
      logoutBtn?.classList.toggle('hidden', !user);
      updateDatasetAuthState(!!user);
      if (!user) {
        // Force Latest view and load static latest data
        if (mode !== 'latest') setMode('latest');
        fetchNews();
        return;
      }
      // On first auth, load current mode via Firestore
      if (mode === 'latest') fetchNews();
      else if (mode === 'archive') fetchArchive();
      else if (mode === 'day' && currentDay) fetchDay(currentDay); else if (mode === 'day') ensureHistoryIndex().then(() => buildDaySelect());
    });
  }

  // ---- Firestore loaders ----
  async function fsQueryLatest() {
    const { db, collection, getDocs, query, where, orderBy, limit } = fb;
    const THIRTY_DAYS = 1000*60*60*24*30;
    const cutoff = Date.now() - THIRTY_DAYS;
    const q = query(
      collection(db, 'items'),
      where('date_ts', '>=', cutoff),
      orderBy('date_ts', 'desc'),
      limit(600)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data());
  }

  async function fsQueryArchive() {
    const { db, collection, getDocs, query, orderBy, limit } = fb;
    const q = query(
      collection(db, 'items'),
      orderBy('date_ts', 'desc'),
      limit(2000)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data());
  }

  async function fsQueryDaysIndex() {
    const { db, collection, getDocs, query, orderBy, limit } = fb;
    const q = query(collection(db, 'daily'), orderBy('date', 'desc'), limit(180));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ date: d.id || d.data().date, count: d.data().count || 0 }));
  }

  async function fsQueryDay(day) {
    const { db, collection, getDocs, query, where, orderBy, limit } = fb;
    const q = query(
      collection(db, 'items'),
      where('first_seen_date', '==', day),
      orderBy('date_ts', 'desc'),
      limit(1000)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data());
  }

  // Override history index builder if Firebase present
  async function ensureHistoryIndex() {
    if (!fb) return Promise.resolve();
    try {
      const days = await fsQueryDaysIndex();
      historyIndex = { days };
      buildDaySelect();
      return historyIndex;
    } catch (e) {
      console.warn('No history index yet', e);
    }
  }

  // Patch data fetchers to use Firestore when available and authed
  const prevFetchNews = fetchNews;
  const prevFetchArchive = fetchArchive;
  const prevFetchDay = fetchDay;

  fetchNews = function(force=false){
    if (fb && currentUser) {
      container.classList.add('loading'); showLoader();
      fsQueryLatest()
        .then(items => { allNews = items; hideLoader(); container.classList.remove('loading'); applyFilters(); buildBadges(); })
        .catch(e => { hideLoader(); container.classList.remove('loading'); console.error(e); });
      return;
    }
    return prevFetchNews.call(this, force);
  }

  fetchArchive = function(){
    if (fb && !currentUser) { alert('Sign in to view Archive.'); return; }
    if (fb && currentUser) {
      container.classList.add('loading'); showLoader();
      fsQueryArchive()
        .then(items => { allNews = items; hideLoader(); container.classList.remove('loading'); applyFilters(); buildBadges(); })
        .catch(e => { hideLoader(); container.classList.remove('loading'); console.error(e); });
      return;
    }
    return prevFetchArchive.call(this);
  }

  fetchDay = function(day){
    if (fb && !currentUser) { alert('Sign in to view Day-wise items.'); return; }
    if (fb && currentUser) {
      container.classList.add('loading'); showLoader();
      fsQueryDay(day)
        .then(items => { allNews = items; hideLoader(); container.classList.remove('loading'); applyFilters(); buildBadges(); })
        .catch(e => { hideLoader(); container.classList.remove('loading'); console.error(e); });
      return;
    }
    return prevFetchDay.call(this, day);
  }

  // Update segmented control to use Firestore index when available, and gate unauth users
  const prevSetMode = setMode;
  setMode = function(newMode){
    if (fb && !currentUser && newMode !== 'latest') {
      alert('Sign in to use Archive and Day.');
      return;
    }
    prevSetMode.call(this, newMode);
    if (fb && currentUser && newMode === 'day') ensureHistoryIndex();
  }

  // Initialize unauth state on load
  updateDatasetAuthState(false);

  // Remove previous immediate sign-in block (we now allow Latest pre-login)
  // if (fb && !currentUser) { showSignInRequired(); }

  // After first paint adjust slider
  setTimeout(updateSegmentedSlider, 150);

  // Initial load still uses latest mode
  fetchNews();
});
