const apiUrl = 'https://api.animetop.info/v1/';
const cdnVideoUrl = 'http://video.animetop.info/720/';
let page = 1;
const quantity = 12;
let isLoading = false;
var isMainPage = false;

async function fetchSeriesList(data) {
    const list = document.getElementById('series-list');
    //debugger
    data.forEach(item => {
        const card = document.createElement('div');
        card.className = "md:flex bg-gray-800 shadow rounded-lg overflow-hidden";
        card.innerHTML = `
          <div class="md:w-[200px] shrink-0 h-[300px] md:h-full overflow-hidden"> <a href="#/anime/${item.id}/1"><img src="${item.urlImagePreview}" data-id="${item.id}" class="w-full h-full object-cover object-center"> </a></div>
          <div class="p-4 space-y-2">
            <a href="#/anime/${item.id}/1" data-id="${item.id}" class="text-xl font-bold text-gray-100 hover:underline cursor-pointer">${item.title}</a>
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
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `name=${encodeURIComponent(name)}`
    });
    const json = await res.json();
    fetchSeriesList(json.data);
}

async function showAnimePage(id, currentEpisode) {
	currentEpisode = currentEpisode - 1;
    const main = document.querySelector('main');
    main.innerHTML += '<div class="space-y-4" id="anime-page"><h1 id="anime-title" class="font-bold">Title</h1><div id="player-container" class="aspect-video bg-black"></div><div id="episode-buttons" class="flex flex-wrap gap-2"></div><div class="text-sm text-gray-300" id="anime-description">Описание сериала будет здесь...</div></div>';

    const res = await fetch(`${apiUrl}info`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `id=${id}`
    });
    var data = (await res.json())["data"][0];
    const player = document.getElementById('player-container');
    const episodeButtons = document.getElementById('episode-buttons');

    const title = document.getElementById('anime-title');
    const description = document.getElementById('anime-description');
    title.innerText = data["title"]
    description.innerHTML = data["description"] // NOT SAFE, BUT NVM
	const series = Object.entries(JSON.parse(data["series"].replaceAll("'", '"'))).map(([name, id]) => {
		return { name, id };
	});;
	if (series.length < currentEpisode) {
		currentEpisode = series.length;
		location.hash = `#/anime/${id}/${currentEpisode}`;
	}
	
    const video = document.createElement('video');
    video.className = 'w-full h-full';
    video.controls = true;
    video.src = `${cdnVideoUrl}${series[currentEpisode].id}.mp4`;
    player.appendChild(video);
    series.keys().forEach(idx => {
		const episode = series[idx]
        const btn = document.createElement('button');
        btn.className = 'px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm';
		if (currentEpisode == idx) btn.className += " bg-[#87969f]"
        btn.textContent = episode.name;
        btn.addEventListener('click', () => {
            video.src = `${cdnVideoUrl}${episode.id}.mp4`;
			location.hash = `#/anime/${id}/${idx+1}`;
			document.querySelectorAll('#episode-buttons > button').forEach(btn => btn.classList.remove('bg-[#87969f]'));
			btn.classList.add('bg-[#87969f]');
            // video.play();
        });
        episodeButtons.appendChild(btn);
    });

}

function handleScroll() {
    if (!isMainPage) return;
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 100) {
        if (!isLoading) {
            page++;
            console.log(page);
            fetchSeries();
        }
    }
}

function checkInitialRoute(e) {
    const hash = location.hash;
    var oldHash = '';
	if (e) oldHash = e.oldURL.split('#')[1];
    	
	const match = hash.match(/#\/anime\/(\d+)\/(\d+)/);
    if (match) {
		const animeID = match[1]
		const episodeID = match[2]
		
		if (oldHash.startsWith(`/anime/${animeID}/`)) return;
		showAnimePage(animeID, episodeID);
	};
	
	const list = document.getElementById('series-list');
    const animePage = document.getElementById('anime-page');
    if (list) list.innerHTML = '';

    isMainPage = (hash.length < 2);
    if (!isMainPage) page = 1;
    if (animePage && isMainPage) animePage.remove();
	
    if (isMainPage) {
        fetchSeries();
    }
}


window.addEventListener('scroll', handleScroll);
window.addEventListener('DOMContentLoaded', () => {
    checkInitialRoute();
    document.getElementById('search-form').addEventListener('submit', e => {
        e.preventDefault();
        const searchValue = e.target.elements.search.value.trim();
        if (searchValue) searchSeries(searchValue);
    });
});
window.addEventListener('hashchange', checkInitialRoute);
