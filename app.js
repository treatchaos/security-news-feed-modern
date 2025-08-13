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

  function ensureHistoryIndex() {
    if (historyIndex) return Promise.resolve(historyIndex);
    return fetch('history/index.json?_=' + Date.now())
      .then(r => { if (!r.ok) throw new Error('index'); return r.json(); })
      .then(idx => { historyIndex = idx; buildDaySelect(); return idx; })
      .catch(e => { console.warn('No history index yet', e); });
  }

  function buildDaySelect() {
    if (!historyIndex?.days) return;
    daySelect.innerHTML = historyIndex.days.map(d => `<option value="${d.date}">${d.date} (${d.count})</option>`).join('');
    if (currentDay) daySelect.value = currentDay;
  }

  daySelect?.addEventListener('change', () => {
    currentDay = daySelect.value;
    if (currentDay) fetchDay(currentDay);
  });

  function fetchDay(day) {
    container.classList.add('loading');
    showLoader();
    fetch(`history/${day}.json?_=${Date.now()}`)
      .then(r => { if(!r.ok) throw new Error('day'); return r.json(); })
      .then(data => {
        hideLoader();
        container.classList.remove('loading');
        const items = data.items || [];
        allNews = items; // day view shows that day only
        applyFilters();
        buildBadges();
      })
      .catch(e => { hideLoader(); container.classList.remove('loading'); console.error(e); });
  }

  function fetchArchive() {
    container.classList.add('loading');
    showLoader();
    fetch('archive.json?_=' + Date.now())
      .then(r => { if(!r.ok) throw new Error('archive'); return r.json(); })
      .then(data => {
        hideLoader();
        container.classList.remove('loading');
        archiveMeta = data;
        const items = data.items || [];
        allNews = items; // full archive (already trimmed by retention)
        applyFilters();
        buildBadges();
      })
      .catch(e => { hideLoader(); container.classList.remove('loading'); console.error(e); });
  }

  function fetchNews(force = false) {
    container.classList.add('loading');
    showLoader();
    fetch('news.json' + (force ? `?t=${Date.now()}` : ''))
      .then(res => { if(!res.ok) throw new Error('HTTP '+res.status); return res.json(); })
      .then(payload => {
        hideLoader();
        container.classList.remove('loading');
        const data = Array.isArray(payload) ? payload : (payload.items || []);
        const THIRTY_DAYS = 1000*60*60*24*30;
        const now = Date.now();
        allNews = data.filter(item => {
          const ts = normalizeDate(item.date);
          return !ts || (now - ts) <= THIRTY_DAYS; // keep if within 30 days or date missing
        });
        applyFilters();
        buildBadges();
      })
      .catch(err => { hideLoader(); container.classList.remove('loading'); container.innerHTML = '<p class="col-span-full text-red-600">Failed to load news.</p>'; console.error(err); });
  }

  // Segmented control events
  datasetControls?.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    setMode(btn.dataset.mode);
    updateSegmentedSlider();
  });

  // Add (or restore) unified refresh logic & event listeners
  function refresh(force=true){
    if(mode==='latest') return fetchNews(force);
    if(mode==='archive') return fetchArchive();
    if(mode==='day' && currentDay) return fetchDay(currentDay);
  }

  // Search & sort listeners (re-add if lost)
  [searchInput, sortSelect].forEach(el => el && el.addEventListener('input', applyFilters));

  clearFilters?.addEventListener('click', () => {
    searchInput.value='';
    sortSelect.value='latest';
    applyFilters();
  });

  refreshBtn?.addEventListener('click', () => refresh(true));

  // Scroll top visibility
  window.addEventListener('scroll', () => {
    const show = window.scrollY > 400;
    scrollTopBtn.classList.toggle('show', show);
  });
  scrollTopBtn?.addEventListener('click', () => window.scrollTo({ top:0, behavior:'smooth' }));

  // About dialog
  aboutLink?.addEventListener('click', (e) => { e.preventDefault(); aboutDialog?.showModal(); });
  aboutDialog?.addEventListener('click', (e) => { if (e.target === aboutDialog) aboutDialog.close(); });

  // After first paint adjust slider
  setTimeout(updateSegmentedSlider, 150);

  // Initial load still uses latest mode
  fetchNews();
});
