(() => {
  'use strict';

  const CONFIG = Object.freeze({
    apiUrl: 'https://api.animetop.info/v1/',
    cdnVideoUrl: 'https://fhd.trn.su/1080/',
    pageSize: 12,
    progressPrefix: 'anime_progress:'
  });

  const dom = {
    form: document.getElementById('search-form'),
    searchInput: document.getElementById('search-input'),
    view: document.getElementById('app-view'),
    status: document.getElementById('app-status')
  };

  const html = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  const formatTime = (seconds) => {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${minutes}:${String(secs).padStart(2, '0')}`;
  };

  const stripMarkup = (value) => String(value ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .trim();

  const parseSeries = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];

    try {
      return Object.entries(JSON.parse(value.replaceAll("'", '"')))
        .map(([name, id]) => ({ name, id }));
    } catch {
      return [];
    }
  };

  const parseRoute = () => {
    const hash = location.hash.replace(/^#\/?/, '');
    if (!hash) return { name: 'home' };

    const [route, first, second] = hash.split('/');
    if (route === 'anime' && /^\d+$/.test(first) && /^\d+$/.test(second)) {
      return { name: 'anime', id: first, episode: Math.max(1, Number(second)) };
    }
    if (route === 'search') {
      return { name: 'search', query: first ? decodeURIComponent(first) : '' };
    }
    return { name: 'home' };
  };

  const setStatus = (message, type = 'info') => {
    dom.status.textContent = message || '';
    dom.status.className = message
      ? `rounded-lg border p-4 text-sm ${type === 'error'
        ? 'border-red-900 bg-red-950/40 text-red-200'
        : 'border-gray-700 bg-gray-800 text-gray-300'}`
      : 'hidden';
  };

  class ApiClient {
    async request(endpoint, options = {}) {
      const response = await fetch(`${CONFIG.apiUrl}${endpoint}`, options);
      if (!response.ok) throw new Error(`Ошибка API: ${response.status}`);
      const payload = await response.json();
      if (payload?.error) throw new Error(payload.error);
      return payload?.data ?? [];
    }

    getLatest(page, signal) {
      return this.request(`last?page=${page}&quantity=${CONFIG.pageSize}`, { signal });
    }

    search(name, signal) {
      return this.request('search', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ name })
      });
    }

    getAnime(id, signal) {
      return this.request('info', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id })
      });
    }
  }

  class ProgressStore {
    constructor(animeId) {
      this.key = `${CONFIG.progressPrefix}${animeId}`;
    }

    read() {
      try {
        const value = JSON.parse(localStorage.getItem(this.key) || 'null');
        return value && Number.isInteger(value.episode) && Number.isFinite(value.time)
          ? value
          : null;
      } catch {
        return null;
      }
    }

    save(episode, time) {
      const safeTime = Math.floor(Number(time) || 0);
      if (safeTime <= 0) return;
      localStorage.setItem(this.key, JSON.stringify({ episode, time: safeTime }));
    }

    clear() {
      localStorage.removeItem(this.key);
    }
  }

  class ListView {
    constructor(items) {
      this.items = items;
      this.element = html('div', 'grid grid-cols-1 gap-6 md:grid-cols-2 mb-4');
    }

    render() {
      this.items.forEach((item) => this.element.appendChild(this.createCard(item)));
      return this.element;
    }

    createCard(item) {
      const card = html('article', 'overflow-hidden rounded-lg bg-gray-800 shadow md:flex');
      const imageLink = html('a', 'block h-[300px] shrink-0 overflow-hidden md:h-auto md:w-[200px]');
      imageLink.href = `#/anime/${item.id}/1`;

      const image = html('img', 'h-full w-full object-cover object-center transition duration-300 hover:scale-105');
      image.src = item.urlImagePreview || '';
      image.alt = item.title || 'Аниме';
      image.loading = 'lazy';
      imageLink.appendChild(image);

      const content = html('div', 'space-y-2 p-4');
      const title = html('a', 'text-xl font-bold text-gray-100 hover:underline', item.title || 'Без названия');
      title.href = imageLink.href;

      const genres = html('div', 'flex flex-wrap gap-1');
      String(item.genre || '').split(',').map((genre) => genre.trim()).filter(Boolean).forEach((genre) => {
        genres.appendChild(html('span', 'rounded bg-gray-700 px-2 py-1 text-xs text-gray-200', genre));
      });

      const description = html('p', 'line-clamp-6 whitespace-pre-line text-sm text-gray-300', stripMarkup(item.description));
      content.append(title, genres, description);
      card.append(imageLink, content);
      return card;
    }
  }

  class HomeView {
    constructor(api, { searchQuery = '' } = {}) {
      this.api = api;
      this.searchQuery = searchQuery;
      this.page = 1;
      this.loading = false;
      this.hasMore = true;
      this.controller = null;
      this.observer = null;
      this.element = html('div', 'space-y-6');
      this.list = html('div');
      this.sentinel = html('div', 'h-2');
    }

    async mount() {
      this.element.append(this.list, this.sentinel);
      dom.view.replaceChildren(this.element);
      this.observer = new IntersectionObserver(() => this.loadNextPage(), { rootMargin: '800px' });
      this.observer.observe(this.sentinel);
      await this.loadNextPage();
    }

    async loadNextPage() {
      if (this.loading || !this.hasMore) return;
      this.loading = true;
      this.controller?.abort();
      this.controller = new AbortController();
      setStatus(this.page === 1 ? 'Загрузка каталога…' : 'Загрузка…');

      try {
        const data = this.searchQuery
          ? await this.api.search(this.searchQuery, this.controller.signal)
          : await this.api.getLatest(this.page, this.controller.signal);
        const items = Array.isArray(data) ? data : [];
        this.list.appendChild(new ListView(items).render());
        this.hasMore = !this.searchQuery && items.length >= CONFIG.pageSize;
        this.page += 1;
        if (this.searchQuery || !items.length) this.observer?.disconnect();
        setStatus(items.length ? '' : 'Ничего не найдено.');
      } catch (error) {
        if (error.name !== 'AbortError') setStatus('Не удалось загрузить данные. Попробуйте ещё раз.', 'error');
      } finally {
        this.loading = false;
      }
    }

    destroy() {
      this.controller?.abort();
      this.observer?.disconnect();
    }
  }

  class AnimeView {
    constructor(api, animeId, initialEpisode) {
      this.api = api;
      this.animeId = animeId;
      this.episodeIndex = Math.max(0, initialEpisode - 1);
      this.anime = null;
      this.series = [];
      this.video = null;
      this.videoQuality = '1080';
      this.saveTimer = null;
      this.loadToken = 0;
      this.controller = null;
      this.progress = new ProgressStore(animeId);
      this.element = html('section', 'space-y-4');
    }

    async mount() {
      dom.view.replaceChildren(this.element);
      setStatus('Загрузка информации об аниме…');
      this.controller = new AbortController();
      try {
        const response = await this.api.getAnime(this.animeId, this.controller.signal);
        this.anime = Array.isArray(response) ? response[0] : response;
        this.series = parseSeries(this.anime?.series);
        if (!this.anime || !this.series.length) throw new Error('Пустые данные сериала');
        this.episodeIndex = Math.min(this.episodeIndex, this.series.length - 1);
        this.render();
        this.loadEpisode(this.episodeIndex);
        setStatus('');
      } catch (error) {
        if (error.name !== 'AbortError') setStatus('Не удалось загрузить аниме.', 'error');
      }
    }

    render() {
      const title = html('h1', 'text-2xl font-bold', this.anime.title || 'Без названия');
      const playerContainer = html('div', 'relative aspect-video overflow-hidden rounded-lg bg-black');
      const description = html('p', 'whitespace-pre-line text-sm text-gray-300', stripMarkup(this.anime.description));
      const continueWrap = html('div');
      const episodes = html('div', 'flex flex-wrap gap-2');

      this.video = html('video', 'h-full w-full', undefined);
      this.video.controls = true;
      this.video.preload = 'metadata';
      playerContainer.appendChild(this.video);
      this.video.addEventListener('timeupdate', () => this.saveProgress());
      this.video.addEventListener('ended', () => this.progress.clear());
      this.video.addEventListener('error', () => this.handleVideoError());

      this.series.forEach((episode, index) => {
        const button = html('button', 'rounded bg-gray-700 px-3 py-1 text-sm transition hover:bg-gray-600', episode.name || `Серия ${index + 1}`);
        button.dataset.episode = String(index);
        button.addEventListener('click', () => this.selectEpisode(index));
        episodes.appendChild(button);
      });

      const saved = this.progress.read();
      if (saved && saved.episode >= 0 && saved.episode < this.series.length) {
        const resume = html('button', 'rounded bg-green-600 px-3 py-1 text-sm text-white transition hover:bg-green-500', `Продолжить: серия ${saved.episode + 1}, ${formatTime(saved.time)}`);
        resume.addEventListener('click', () => this.selectEpisode(saved.episode, saved.time, true));
        continueWrap.appendChild(resume);
      }

      this.element.replaceChildren(title, playerContainer, continueWrap, episodes, description);
      this.episodeButtons = episodes;
    }

    selectEpisode(index, seekTime = 0, autoplay = false) {
      if (index < 0 || index >= this.series.length) return;
      this.saveProgress();
      this.episodeIndex = index;
      const targetHash = `#/anime/${this.animeId}/${index + 1}`;
      if (location.hash !== targetHash) history.replaceState(null, '', targetHash);
      this.loadEpisode(index, seekTime, autoplay);
    }

    loadEpisode(index, seekTime = 0, autoplay = false) {
      const episode = this.series[index];
      if (!episode || !this.video) return;
      this.saveTimer && clearInterval(this.saveTimer);
      this.loadToken += 1;
      this.videoQuality = '1080';
      this.video.pause();
      this.video.src = buildVideoUrl(episode.id, this.videoQuality);
      this.video.load();
      this.updateEpisodeButtons();

      const token = this.loadToken;
      const seekAndPlay = () => {
        if (token !== this.loadToken) return;
        if (seekTime > 0) this.video.currentTime = Math.min(seekTime, this.video.duration || seekTime);
        if (autoplay) this.video.play().catch(() => {});
      };
      this.video.addEventListener('loadedmetadata', seekAndPlay, { once: true });
      this.saveTimer = setInterval(() => this.saveProgress(), 2000);
    }

    updateEpisodeButtons() {
      this.episodeButtons?.querySelectorAll('button').forEach((button) => {
        button.classList.toggle('bg-[#87969f]', Number(button.dataset.episode) === this.episodeIndex);
      });
    }

    handleVideoError() {
      if (this.videoQuality === '1080') {
        this.videoQuality = '720';
        this.video.src = buildVideoUrl(this.series[this.episodeIndex].id, '720');
        this.video.load();
        return;
      }
      setStatus('Видео для этой серии не найдено.', 'error');
    }

    saveProgress() {
      if (this.video && this.video.currentTime > 0) this.progress.save(this.episodeIndex, this.video.currentTime);
    }

    destroy() {
      this.saveProgress();
      this.controller?.abort();
      if (this.saveTimer) clearInterval(this.saveTimer);
      this.video?.pause();
      this.video?.removeAttribute('src');
    }
  }

  const buildVideoUrl = (videoId, quality) => `${CONFIG.cdnVideoUrl.replace('/1080/', `/${quality}/`)}${videoId}.mp4`;

  class App {
    constructor() {
      this.api = new ApiClient();
      this.currentView = null;
      this.currentRoute = null;
      this.renderToken = 0;
    }

    async renderRoute() {
      const route = parseRoute();
      const renderToken = ++this.renderToken;
      if (route.name === 'anime' && this.currentRoute?.name === 'anime' && this.currentRoute.id === route.id && this.currentView) {
        this.currentView.selectEpisode(route.episode - 1);
        this.currentRoute = route;
        return;
      }

      this.currentView?.destroy();
      this.currentRoute = route;
      this.currentView = null;
      dom.searchInput.value = route.name === 'search' ? route.query : '';

      if (route.name === 'anime') {
        this.currentView = new AnimeView(this.api, route.id, route.episode);
      } else {
        this.currentView = new HomeView(this.api, { searchQuery: route.name === 'search' ? route.query : '' });
      }
      const view = this.currentView;
      await view.mount();
      if (renderToken !== this.renderToken) view.destroy();
    }

    init() {
      dom.form.addEventListener('submit', (event) => {
        event.preventDefault();
        const query = dom.searchInput.value.trim();
        location.hash = query ? `#/search/${encodeURIComponent(query)}` : '#/';
      });
      window.addEventListener('hashchange', () => this.renderRoute());
      window.addEventListener('beforeunload', () => this.currentView?.destroy());
      this.renderRoute();
    }
  }

  const app = new App();
  app.init();
})();
