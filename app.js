const LIMIT = 12;
const WATCHLIST_LIMIT = 20;
const FAVORITES_KEY = 'animeverse_favorites';
const WATCHLIST_KEY = 'animeverse_watchlist';
const VIEW_KEY = 'animeverse_view';
const DAY_KEY_STORAGE = 'animeverse_day_key';
const AGE_KEY = 'animeverse_age';

const routes = {
  '/home': { title: 'Home', desc: 'Свежая ежедневная подборка аниме.' },
  '/news': { title: 'News', desc: 'Анонсы и сезонные новинки (обновляется каждый день).' },
  '/top': { title: 'Top', desc: 'Рейтинг лучших тайтлов с выбором Top 10 / 50 / 100.' },
  '/thebest': { title: 'TheBest', desc: 'Тайтлы с самой сильной фан-базой.' },
  '/popular': { title: 'Popular', desc: 'Самое популярное прямо сейчас.' },
  '/random': { title: 'Random', desc: 'Случайные, каждый раз разные рекомендации.' },
  '/mylist': { title: 'MyList', desc: 'Ваш список просмотра и избранное.' }
};

const state = {
  route: '/home',
  page: 1,
  query: '',
  type: '',
  status: '',
  minScore: 0,
  genre: '',
  orderBy: 'score',
  sort: 'desc',
  topSize: 10,
  userAge: 0,
  onlyFavorites: false,
  current: []
};

const els = {
  nav: document.getElementById('mainNav'),
  heroTitle: document.getElementById('heroTitle'),
  heroDesc: document.getElementById('heroDesc'),
  featuredBox: document.getElementById('featuredBox'),
  catalogControls: document.getElementById('catalogControls'),
  grid: document.getElementById('grid'),
  statusText: document.getElementById('statusText'),
  btnRandomRefresh: document.getElementById('btnRandomRefresh'),
  pageText: document.getElementById('pageText'),
  searchInput: document.getElementById('searchInput'),
  typeSelect: document.getElementById('typeSelect'),
  statusSelect: document.getElementById('statusSelect'),
  scoreSelect: document.getElementById('scoreSelect'),
  sortSelect: document.getElementById('sortSelect'),
  topSizeSelect: document.getElementById('topSizeSelect'),
  genreChips: document.getElementById('genreChips'),
  btnApply: document.getElementById('btnApply'),
  btnReset: document.getElementById('btnReset'),
  btnFavorites: document.getElementById('btnFavorites'),
  btnView: document.getElementById('btnView'),
  btnPrev: document.getElementById('btnPrev'),
  btnNext: document.getElementById('btnNext'),
  watchInput: document.getElementById('watchInput'),
  watchAdd: document.getElementById('watchAdd'),
  watchItems: document.getElementById('watchItems'),
  myListSection: document.getElementById('myListSection'),
  modal: document.getElementById('animeModal'),
  modalBody: document.getElementById('modalBody'),
  modalClose: document.getElementById('modalClose'),
  ageGate: document.getElementById('ageGate'),
  ageInput: document.getElementById('ageInput'),
  ageEnterBtn: document.getElementById('ageEnterBtn')
};

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function daySeed() {
  const [y, m, d] = dayKey().split('-').map(Number);
  return y * 10000 + m * 100 + d;
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function favoritesList() {
  return readJSON(FAVORITES_KEY, []);
}

function isFavorite(id) {
  return favoritesList().includes(id);
}

function sanitize(text) {
  return String(text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isAdultAnime(anime) {
  const rating = String(anime?.rating || '');
  if (rating.includes('Rx - Hentai')) return true;
  const genres = (anime?.genres || []).map((g) => String(g?.name || '').toLowerCase());
  return genres.includes('hentai') || genres.includes('erotica');
}

function applyAgeFilter(list) {
  if (state.userAge >= 18) return list;
  return list.filter((anime) => !isAdultAnime(anime));
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function setRouteMeta() {
  const meta = routes[state.route] || routes['/home'];
  els.heroTitle.textContent = meta.title;
  els.heroDesc.textContent = `${meta.desc} Сегодня: ${dayKey()}`;
}

function setPageText(text) {
  els.pageText.textContent = text || `Стр. ${state.page}`;
}

function showSkeleton(count = 8) {
  els.grid.innerHTML = Array.from({ length: count }, () => '<div class="skeleton"></div>').join('');
}

function updateNavActive() {
  const links = els.nav.querySelectorAll('a[data-route-link]');
  links.forEach((link) => {
    link.classList.toggle('active', link.getAttribute('href') === state.route);
  });
}

function updateFavoritesButton() {
  els.btnFavorites.textContent = state.onlyFavorites ? 'Все' : 'Избранное';
}

function parseSortValue(value) {
  const map = {
    score_desc: ['score', 'desc'],
    popularity_desc: ['popularity', 'desc'],
    title_asc: ['title', 'asc'],
    start_date_desc: ['start_date', 'desc']
  };
  return map[value] || map.score_desc;
}

async function apiGet(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function apiPost(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  return response.json();
}

function addTitleToWatchlist(title, silent = false) {
  const clean = title.trim();
  if (!clean) return;

  const list = readJSON(WATCHLIST_KEY, []);
  const withoutDup = list.filter((x) => x.toLowerCase() !== clean.toLowerCase());
  withoutDup.unshift(clean);
  const limited = withoutDup.slice(0, WATCHLIST_LIMIT);
  writeJSON(WATCHLIST_KEY, limited);

  renderWatchlist();
  if (!silent) {
    const full = limited.length >= WATCHLIST_LIMIT;
    setStatus(full ? `Добавлено. Лимит ${WATCHLIST_LIMIT}` : `Добавлено в MyList: ${clean}`);
  }
}

function toCards(list, isNews = false) {
  if (!list.length) {
    els.grid.innerHTML = '<div class="empty">Ничего не найдено.</div>';
    return;
  }

  els.grid.innerHTML = list.map((anime, i) => {
    const title = sanitize(anime.title_english || anime.title || 'Без названия');
    const image = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || '';
    const score = anime.score ? anime.score.toFixed(2) : 'N/A';
    const year = anime.year || anime.aired?.prop?.from?.year || '?';
    const rank = anime.rank ? `#${anime.rank}` : '-';
    const genres = (anime.genres || []).slice(0, 2).map((g) => g.name).join(', ') || 'Без жанра';
    const favClass = isFavorite(anime.mal_id) ? 'active' : '';
    const dateTag = isNews && anime.aired?.from ? `<span class="news-date">NEWS • ${new Date(anime.aired.from).toLocaleDateString('ru-RU')}</span>` : '';

    return `
      <article class="card-item" style="animation-delay:${Math.min(i * 0.04, 0.3)}s">
        <img src="${image}" alt="${title}" loading="lazy" />
        <div class="card-body">
          <h3 class="card-title">${title}</h3>
          <p class="card-meta">${rank} | ${score} | ${year}</p>
          <p class="card-meta">${sanitize(genres)}</p>
          ${dateTag}
          <div class="card-actions">
            <span class="pill">Anime</span>
            <button type="button" class="mini-btn" data-detail="${anime.mal_id}">Подробнее</button>
            <button type="button" class="mini-btn ${favClass}" data-fav="${anime.mal_id}">${favClass ? 'В избранном' : 'В избранное'}</button>
            <button type="button" class="mini-btn" data-addlist="${title}">+ MyList</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function applyFavoritesFilter(list) {
  if (!state.onlyFavorites) return list;
  const set = new Set(favoritesList());
  return list.filter((item) => set.has(item.mal_id));
}

function renderFeatured(anime) {
  if (!anime) {
    els.featuredBox.innerHTML = '<p class="muted">Нет данных</p>';
    return;
  }

  const title = sanitize(anime.title_english || anime.title || 'Без названия');
  const image = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || '';
  const text = sanitize((anime.synopsis || 'Описание отсутствует').slice(0, 180)) + '...';

  els.featuredBox.innerHTML = `
    <img src="${image}" alt="${title}" loading="lazy" />
    <h3>${title}</h3>
    <p class="muted">Оценка: ${anime.score ? anime.score.toFixed(2) : 'N/A'} | Эпизоды: ${anime.episodes || '?'}</p>
    <p class="muted">${text}</p>
  `;
}

function buildDailyQuery(limit) {
  const params = new URLSearchParams({
    page: String(state.page),
    limit: String(limit),
    day_seed: String(daySeed())
  });
  return params.toString();
}

async function loadByRoute() {
  setRouteMeta();
  updateNavActive();
  setStatus('Загрузка...');
  if (els.topSizeSelect) {
    els.topSizeSelect.classList.toggle('hidden', state.route !== '/top');
  }
  if (els.btnRandomRefresh) {
    els.btnRandomRefresh.classList.toggle('hidden', state.route !== '/random');
  }

  if (state.route === '/mylist') {
    els.catalogControls.classList.add('hidden');
    els.grid.classList.add('hidden');
    els.myListSection.classList.remove('hidden');
    setPageText('MyList');
    renderWatchlist();
    setStatus(`Личный список (${readJSON(WATCHLIST_KEY, []).length}/${WATCHLIST_LIMIT})`);
    return;
  }

  els.catalogControls.classList.remove('hidden');
  els.grid.classList.remove('hidden');
  els.myListSection.classList.add('hidden');

  if (state.route === '/top') {
    setPageText(`Top ${state.topSize} • стр ${state.page}`);
  } else if (state.route === '/random') {
    setPageText(`Random • mix ${state.page}`);
  } else {
    setPageText(`Стр. ${state.page}`);
  }

  showSkeleton();

  try {
    let data;
    const hasSearchFilters = Boolean(
      state.query || state.type || state.status || state.minScore > 0 || state.genre
    );

    if (state.route === '/home' && hasSearchFilters) {
      const qs = new URLSearchParams({
        page: String(state.page),
        limit: String(LIMIT),
        day_seed: String(daySeed()),
        q: state.query,
        type: state.type,
        status: state.status,
        min_score: state.minScore > 0 ? String(state.minScore) : '',
        genres: state.genre,
        order_by: state.orderBy,
        sort: state.sort
      });
      data = await apiGet(`/api/search?${qs.toString()}`);
    } else if (state.route === '/home') {
      data = await apiGet(`/api/home?${buildDailyQuery(LIMIT)}`);
    } else if (state.route === '/news') {
      data = await apiGet(`/api/news?${buildDailyQuery(LIMIT)}`);
    } else if (state.route === '/top') {
      data = await apiGet(`/api/top?${buildDailyQuery(state.topSize)}`);
    } else if (state.route === '/thebest') {
      data = await apiGet(`/api/thebest?${buildDailyQuery(LIMIT)}`);
    } else if (state.route === '/popular') {
      data = await apiGet(`/api/popular?${buildDailyQuery(LIMIT)}`);
    } else if (state.route === '/random') {
      const exclude = state.current.map((x) => x.mal_id).filter(Boolean).join(',');
      const qs = new URLSearchParams({
        count: String(LIMIT),
        day_seed: String(daySeed()),
        page: String(state.page),
        adult: state.userAge >= 18 ? '1' : '0',
        exclude
      });
      data = await apiGet(`/api/random?${qs.toString()}`);
    } else {
      data = await apiGet(`/api/home?${buildDailyQuery(LIMIT)}`);
    }

    const rawList = Array.isArray(data.data) ? data.data : [];
    state.current = rawList;

    const visible = applyFavoritesFilter(applyAgeFilter(rawList));
    toCards(visible, state.route === '/news');
    renderFeatured(visible[0] || rawList[0]);

    const hasPrev = Boolean(data.pagination?.has_previous_page);
    const hasNext = Boolean(data.pagination?.has_next_page);

    if (state.route === '/random') {
      els.btnPrev.disabled = state.page <= 1;
      els.btnNext.disabled = false;
    } else {
      els.btnPrev.disabled = state.page <= 1 || !hasPrev;
      els.btnNext.disabled = !hasNext;
    }

    const ageMode = state.userAge >= 18 ? '18+' : 'safe mode';
    setStatus(`Загружено: ${visible.length} • ${ageMode} • обновление дня: ${dayKey()}`);
  } catch (error) {
    els.grid.innerHTML = `<div class="empty">${sanitize(error.message || 'Ошибка загрузки')}</div>`;
    setStatus('Ошибка');
  }
}

async function loadGenres() {
  const fallbackGenres = [
    { mal_id: '1', name: 'Action' },
    { mal_id: '2', name: 'Adventure' },
    { mal_id: '4', name: 'Comedy' },
    { mal_id: '8', name: 'Drama' },
    { mal_id: '10', name: 'Fantasy' },
    { mal_id: '22', name: 'Romance' },
    { mal_id: '24', name: 'Sci-Fi' },
    { mal_id: '36', name: 'Slice of Life' }
  ];

  try {
    const data = await apiGet('/api/genres');
    const genres = Array.isArray(data.data) && data.data.length ? data.data.slice(0, 18) : fallbackGenres;

    els.genreChips.innerHTML = '<button class="chip active" data-genre="" type="button">Все</button>' +
      genres.map((g) => `<button class="chip" data-genre="${g.mal_id}" type="button">${sanitize(g.name)}</button>`).join('');
  } catch {
    els.genreChips.innerHTML = '<button class="chip active" data-genre="" type="button">Все</button>' +
      fallbackGenres.map((g) => `<button class="chip" data-genre="${g.mal_id}" type="button">${sanitize(g.name)}</button>`).join('');
  }
}

function syncGenres() {
  const chips = els.genreChips.querySelectorAll('.chip');
  chips.forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.genre === state.genre);
  });
}

function applyFiltersFromUI() {
  state.query = els.searchInput.value.trim();
  state.type = els.typeSelect.value;
  state.status = els.statusSelect.value;
  state.minScore = Number(els.scoreSelect.value || 0);
  state.topSize = Number(els.topSizeSelect.value || 10);

  const [orderBy, sort] = parseSortValue(els.sortSelect.value);
  state.orderBy = orderBy;
  state.sort = sort;

  if (state.route !== '/top') state.route = '/home';
  state.page = 1;
  navigate(state.route);
}

function resetFilters() {
  state.query = '';
  state.type = '';
  state.status = '';
  state.minScore = 0;
  state.genre = '';
  state.orderBy = 'score';
  state.sort = 'desc';
  state.topSize = 10;

  els.searchInput.value = '';
  els.typeSelect.value = '';
  els.statusSelect.value = '';
  els.scoreSelect.value = '0';
  els.sortSelect.value = 'score_desc';
  els.topSizeSelect.value = '10';

  syncGenres();
  state.route = '/home';
  state.page = 1;
  navigate('/home');
}

function toggleFavorite(id) {
  const list = favoritesList();
  const idx = list.indexOf(id);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(id);
  writeJSON(FAVORITES_KEY, list);
}

async function openDetail(id) {
  els.modalBody.innerHTML = '<p class="muted">Загрузка...</p>';
  els.modal.showModal();

  try {
    const data = await apiGet(`/api/anime/${id}/full`);
    const anime = data.data;

    const title = sanitize(anime.title_english || anime.title || 'Без названия');
    const image = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || '';
    const synopsis = sanitize(anime.synopsis || 'Описание отсутствует');
    const studios = (anime.studios || []).map((s) => s.name).join(', ') || 'Не указаны';

    els.modalBody.innerHTML = `
      <img src="${image}" alt="${title}" />
      <div>
        <h3 class="modal-title">${title}</h3>
        <p class="modal-text">Оценка: ${anime.score ? anime.score.toFixed(2) : 'N/A'} | Ранг: ${anime.rank ? '#' + anime.rank : '-'} | Эпизоды: ${anime.episodes || '?'}</p>
        <p class="modal-text">Студии: ${sanitize(studios)}</p>
        <p class="modal-text" id="modalSynopsis">${synopsis}</p>
        <div class="modal-actions">
          <button class="btn btn-primary" id="translateBtn" type="button">Сделать перевод</button>
          <button class="btn btn-ghost" id="addFromModal" type="button">В MyList</button>
        </div>
      </div>
    `;

    const translateBtn = document.getElementById('translateBtn');
    const synopsisNode = document.getElementById('modalSynopsis');
    const addFromModal = document.getElementById('addFromModal');

    addFromModal?.addEventListener('click', () => {
      addTitleToWatchlist(anime.title_english || anime.title || 'Без названия');
    });

    translateBtn?.addEventListener('click', async () => {
      translateBtn.disabled = true;
      translateBtn.textContent = 'Перевод...';

      try {
        const translated = await apiPost('/api/translate', { text: anime.synopsis || '', target: 'ru' });
        synopsisNode.textContent = translated.translatedText || 'Перевод пуст.';
        translateBtn.textContent = 'Готово';
      } catch (error) {
        translateBtn.textContent = 'Ошибка';
        synopsisNode.textContent = `Перевод недоступен: ${error.message}`;
      }
    });
  } catch (error) {
    els.modalBody.innerHTML = `<p class="muted">Ошибка: ${sanitize(error.message)}</p>`;
  }
}

function renderWatchlist() {
  const list = readJSON(WATCHLIST_KEY, []);
  if (!list.length) {
    els.watchItems.innerHTML = '<li><span>Список пуст.</span></li>';
    return;
  }

  els.watchItems.innerHTML = list.map((item, idx) => `
    <li>
      <span>${sanitize(item)}</span>
      <button class="watch-del" type="button" data-watch-del="${idx}">Удалить</button>
    </li>
  `).join('');
}

function addToWatchlist() {
  addTitleToWatchlist(els.watchInput.value);
  els.watchInput.value = '';
}

function applyView() {
  const view = localStorage.getItem(VIEW_KEY) || 'grid';
  document.body.classList.toggle('list-view', view === 'list');
  els.btnView.textContent = view === 'list' ? 'Вид: список' : 'Вид: сетка';
}

function toggleView() {
  const list = document.body.classList.toggle('list-view');
  localStorage.setItem(VIEW_KEY, list ? 'list' : 'grid');
  els.btnView.textContent = list ? 'Вид: список' : 'Вид: сетка';
}

function navigate(path, replace = false) {
  if (!routes[path]) path = '/home';

  const prevRoute = state.route;
  state.route = path;
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);

  if (path !== '/mylist') {
    if (path === '/random' && prevRoute !== '/random') state.page = 1;
    if (path !== '/random') state.page = 1;
  }
  if (path === '/top') els.topSizeSelect.value = String(state.topSize);

  loadByRoute();
}

function setupEvents() {
  let timer;

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const routeLink = target.closest('[data-route-link]');
    if (routeLink instanceof HTMLAnchorElement) {
      event.preventDefault();
      navigate(routeLink.getAttribute('href') || '/home');
      return;
    }

    const favBtn = target.closest('[data-fav]');
    if (favBtn instanceof HTMLButtonElement) {
      toggleFavorite(Number(favBtn.dataset.fav));
      toCards(applyFavoritesFilter(applyAgeFilter(state.current)), state.route === '/news');
      return;
    }

    const detailBtn = target.closest('[data-detail]');
    if (detailBtn instanceof HTMLButtonElement) {
      openDetail(Number(detailBtn.dataset.detail));
      return;
    }

    const addBtn = target.closest('[data-addlist]');
    if (addBtn instanceof HTMLButtonElement) {
      addTitleToWatchlist(addBtn.dataset.addlist || '');
    }
  });

  els.searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      applyFiltersFromUI();
    }, 450);
  });

  els.btnApply.addEventListener('click', applyFiltersFromUI);
  els.btnReset.addEventListener('click', resetFilters);

  els.topSizeSelect?.addEventListener('change', () => {
    state.topSize = Number(els.topSizeSelect.value || 10);
    if (state.route === '/top') {
      state.page = 1;
      loadByRoute();
    }
  });

  els.btnFavorites.addEventListener('click', () => {
    state.onlyFavorites = !state.onlyFavorites;
    updateFavoritesButton();

    if (state.current.length) {
      const visible = applyFavoritesFilter(applyAgeFilter(state.current));
      toCards(visible, state.route === '/news');
      renderFeatured(visible[0] || state.current[0]);
      setStatus(state.onlyFavorites ? 'Режим избранного' : 'Показаны все');
      return;
    }

    loadByRoute();
  });

  els.btnView.addEventListener('click', toggleView);

  els.btnPrev.addEventListener('click', () => {
    if (state.route === '/mylist' || state.page <= 1) return;
    state.page -= 1;
    loadByRoute();
  });

  els.btnNext.addEventListener('click', () => {
    if (state.route === '/mylist') return;
    state.page += 1;
    loadByRoute();
  });

  els.btnRandomRefresh?.addEventListener('click', () => {
    if (state.route !== '/random') return;
    state.page += 1;
    loadByRoute();
  });

  els.genreChips.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;

    const g = target.dataset.genre;
    if (g === undefined) return;

    state.genre = g;
    state.page = 1;
    syncGenres();

    state.route = '/home';
    navigate('/home');
  });

  els.watchAdd.addEventListener('click', addToWatchlist);
  els.watchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addToWatchlist();
    }
  });

  els.watchItems.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;

    const idx = Number(target.dataset.watchDel);
    if (Number.isNaN(idx)) return;

    const list = readJSON(WATCHLIST_KEY, []);
    list.splice(idx, 1);
    writeJSON(WATCHLIST_KEY, list);
    renderWatchlist();
    setStatus(`Удалено. В списке: ${list.length}/${WATCHLIST_LIMIT}`);
  });

  els.modalClose.addEventListener('click', () => els.modal.close());
  els.modal.addEventListener('click', (e) => {
    const rect = els.modal.getBoundingClientRect();
    const inside = rect.top <= e.clientY && e.clientY <= rect.bottom && rect.left <= e.clientX && e.clientX <= rect.right;
    if (!inside) els.modal.close();
  });

  window.addEventListener('popstate', () => {
    const path = location.pathname;
    state.route = routes[path] ? path : '/home';
    loadByRoute();
  });
}

function setupDailyAutoRefresh() {
  localStorage.setItem(DAY_KEY_STORAGE, dayKey());

  setInterval(() => {
    const stored = localStorage.getItem(DAY_KEY_STORAGE);
    const now = dayKey();

    if (stored !== now) {
      localStorage.setItem(DAY_KEY_STORAGE, now);
      state.page = 1;
      loadByRoute();
    }
  }, 60 * 1000);
}

function ensureAgeGate() {
  const saved = Number(localStorage.getItem(AGE_KEY) || 0);
  if (saved > 0) {
    state.userAge = saved;
    els.ageGate?.classList.add('hidden');
    return Promise.resolve();
  }

  if (els.ageGate) {
    els.ageGate.classList.remove('hidden');
  }

  return new Promise((resolve) => {
    const handler = () => {
      const age = Number(els.ageInput?.value || 0);
      if (!Number.isFinite(age) || age <= 0) return;
      state.userAge = age;
      localStorage.setItem(AGE_KEY, String(age));
      els.ageGate?.classList.add('hidden');
      els.ageEnterBtn?.removeEventListener('click', handler);
      resolve();
    };

    els.ageEnterBtn?.addEventListener('click', handler);
  });
}

async function init() {
  await ensureAgeGate();
  applyView();
  renderWatchlist();
  updateFavoritesButton();
  setupEvents();
  setupDailyAutoRefresh();

  if (els.topSizeSelect) {
    els.topSizeSelect.value = String(state.topSize);
  }

  await loadGenres();
  syncGenres();

  const currentPath = routes[location.pathname] ? location.pathname : '/home';
  navigate(currentPath, true);
}

init();
