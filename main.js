const apiUrl = 'https://api.animetop.info/v1/';
    let page = 1;
    const quantity = 12;
    let isLoading = false;
	var isSearchOpen = false;

    async function fetchSeriesList(data) {
      const list = document.getElementById('series-list');
      //debugger
	  data.forEach(item => {
        const card = document.createElement('div');
        card.className = "flex bg-gray-800 shadow rounded-lg overflow-hidden";
        card.innerHTML = `
          <img src="${item.urlImagePreview}" data-id="${item.id}" alt="Series Cover" class="h-56 rounded-br-2xl object-cover cursor-pointer">
          <div class="p-4 space-y-2">
            <a href="#/anime/${item.id}" data-id="${item.id}" class="text-xl font-bold text-gray-100 hover:underline cursor-pointer">${item.title}</a>
            <div class="flex flex-wrap gap-1">
              ${item.genre.split(', ').map(g => `<span class='text-xs bg-gray-700 text-gray-200 px-2 py-1 rounded'>${g}</span>`).join('')}
            </div>
            <p class="text-sm text-gray-300 line-clamp-6">${item.description.replace(/<br\s*\/?>/g, '')}</p>
          </div>
        `;
        if (list) list.appendChild(card);
      });
    }

    async function fetchSeries() {
      if (isLoading) return;
      isLoading = true;
      const res = await fetch(`${apiUrl}last?page=${page}&quantity=${quantity}`);
      const json = await res.json();
      fetchSeriesList(json.data);
      isLoading = false;
    }

    async function searchSeries(name) {
	  location.hash = `#/search`;
	    const res = await fetch(`${apiUrl}search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `name=${encodeURIComponent(name)}`
      });
      const json = await res.json();
      fetchSeriesList(json.data);
    }

    async function showAnimePage(id) {
      location.hash = `#/anime/${id}`;
      const main = document.querySelector('main');
      main.innerHTML = '<div class="space-y-4"><div id="player-container" class="aspect-video bg-black"></div><div id="episode-buttons" class="flex flex-wrap gap-2"></div><div class="text-sm text-gray-300">Описание сериала будет здесь...</div></div>';

      const res = await fetch(`${apiUrl}playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `id=${id}`
      });
      const data = await res.json();

      const player = document.getElementById('player-container');
      const episodeButtons = document.getElementById('episode-buttons');

      if (data.length > 0) {
        const video = document.createElement('video');
        video.className = 'w-full h-full';
        video.controls = true;
        video.src = data[0].hd || data[0].std;
        player.appendChild(video);

        data.forEach(episode => {
          const btn = document.createElement('button');
          btn.className = 'px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm';
          btn.textContent = episode.name;
          btn.addEventListener('click', () => {
            video.src = episode.hd || episode.std;
            video.play();
          });
          episodeButtons.appendChild(btn);
        });
      }
    }

    function handleScroll() {
      if (isSearchOpen) return;
      if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 100) {
        if (!isLoading) {
          page++;
          console.log(page);
          fetchSeries();
        }
      }
    }

    function checkInitialRoute() {
	  const list = document.getElementById('series-list');
	  list.innerHTML = '';

      const hash = location.hash;
	  isSearchOpen = (hash == "#/search");
	  console.log(isSearchOpen);
	  if (hash != "#") page = 1;
	  
      const match = hash.match(/#\/anime\/(\d+)/);
      if (match) showAnimePage(match[1]);
      if (!isSearchOpen) {
        fetchSeries();
        window.addEventListener('scroll', handleScroll);
      }
    }

    window.addEventListener('DOMContentLoaded', () => {
      checkInitialRoute();
      document.getElementById('search-form').addEventListener('submit', e => {
        e.preventDefault();
        const searchValue = e.target.elements.search.value.trim();
        if (searchValue) searchSeries(searchValue);
      });
    });
    window.addEventListener('hashchange', checkInitialRoute);