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

  yearEl.textContent = new Date().getFullYear();

  let allNews = [];
  let filtered = [];

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
    statsEl.innerHTML = `<strong>${filtered.length}</strong> shown (last 30 days)`;
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

  function fetchNews(force = false) {
    showLoader();
    fetch('news.json' + (force ? `?t=${Date.now()}` : ''))
      .then(res => { if(!res.ok) throw new Error('HTTP '+res.status); return res.json(); })
      .then(payload => {
        hideLoader();
        const data = Array.isArray(payload) ? payload : (payload.items || []);
        const THIRTY_DAYS = 1000*60*60*24*30;
        const now = Date.now();
        allNews = data.filter(item => {
          const ts = normalizeDate(item.date);
          return !ts || (now - ts) <= THIRTY_DAYS; // keep if within 30 days or date missing
        });
        applyFilters();
      })
      .catch(err => { hideLoader(); container.innerHTML = '<p class="col-span-full text-red-600">Failed to load news.</p>'; console.error(err); });
  }

  // Events
  [searchInput, sortSelect].forEach(el => el && el.addEventListener('input', applyFilters));
  clearFilters.addEventListener('click', () => { searchInput.value=''; sortSelect.value='latest'; applyFilters(); });
  refreshBtn.addEventListener('click', () => fetchNews(true));

  window.addEventListener('scroll', () => {
    const show = window.scrollY > 400;
    scrollTopBtn.classList.toggle('show', show);
  });
  scrollTopBtn.addEventListener('click', () => window.scrollTo({ top:0, behavior:'smooth' }));

  aboutLink.addEventListener('click', (e) => { e.preventDefault(); aboutDialog?.showModal(); });
  aboutDialog?.addEventListener('click', (e) => { if (e.target === aboutDialog) aboutDialog.close(); });

  // Initial load
  fetchNews();
});
