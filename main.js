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
    currentEpisode = currentEpisode - 1; // 1-based -> 0-based

    const main = document.querySelector('main');
    main.innerHTML += `
    <div class="space-y-4" id="anime-page">
      <h1 id="anime-title" class="font-bold">Title</h1>
      <div id="player-container" class="aspect-video bg-black"></div>
      <div id="continue-wrap"></div>
      <div id="episode-buttons" class="flex flex-wrap gap-2"></div>
      <div class="text-sm text-gray-300" id="anime-description">Описание сериала будет здесь...</div>
    </div>`;

    const res = await fetch(`${apiUrl}info`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `id=${id}`
    });
    const data = (await res.json()).data[0];

    const title = document.getElementById('anime-title');
    const description = document.getElementById('anime-description');
    const player = document.getElementById('player-container');
    const episodeButtons = document.getElementById('episode-buttons');
    const continueWrap = document.getElementById('continue-wrap');

    title.innerText = data.title;
    description.innerHTML = data.description; // not safe, но пофиг

    const series = Object.entries(JSON.parse(data.series.replaceAll("'", '"')))
        .map(([name, sid]) => ({
            name,
            id: sid
        }));

    if (currentEpisode >= series.length) {
        currentEpisode = series.length - 1;
        location.hash = `#/anime/${id}/${currentEpisode + 1}`;
    }

    // === localStorage helpers ===
    const STORAGE_KEY = `anime_progress:${id}`;

    function readProgress() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        try {
            const obj = JSON.parse(raw);
            if (!Number.isFinite(obj.time) || !Number.isInteger(obj.episode)) return null;
            return obj;
        } catch {
            return null;
        }
    }

    function writeProgress(episodeIndex, timeSec) {
        timeSec = Math.floor(timeSec || 0);
        if (timeSec <= 0) return; // не затираем прогресс нулём
        const obj = {
            episode: episodeIndex,
            time: timeSec
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    }

    function clearProgress() {
        localStorage.removeItem(STORAGE_KEY);
    }

    function formatTime(sec) {
        sec = Math.max(0, Math.floor(sec));
        const hh = Math.floor(sec / 3600);
        const mm = Math.floor((sec % 3600) / 60);
        const ss = sec % 60;
        return hh > 0 ?
            `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` :
            `${mm}:${String(ss).padStart(2, '0')}`;
    }

    // === video + сохранение ===
    const video = document.createElement('video');
    video.className = 'w-full h-full';
    video.controls = true;
    player.appendChild(video);

    let saveInterval = null;
    let currentEp = currentEpisode;

    function setupVideoForEpisode(epIndex, seekTime) {
        // очистка предыдущего интервала
        if (saveInterval) {
            clearInterval(saveInterval);
            saveInterval = null;
        }
		
		// debugger
		if ((currentEp != epIndex) || (!seekTime)) { // seekTime = undefined on init
			currentEp = epIndex;
			video.pause();
			video.src = `${cdnVideoUrl}${series[epIndex].id}.mp4`;
		}

        // если нужно сразу перемотать
        if (seekTime && seekTime > 0) {
            const t = seekTime;
            if (video.readyState >= 1) {
                video.currentTime = t;
            } else {
                const onMeta = () => {
                    video.removeEventListener('loadedmetadata', onMeta);
                    video.currentTime = Math.min(t, video.duration || t);
                };
                video.addEventListener('loadedmetadata', onMeta);
            }
        }

        // каждые 2 секунды сохраняем эпизод + время, если > 0
        saveInterval = setInterval(() => {
            const t = Math.floor(video.currentTime || 0);
            if (t > 0) writeProgress(currentEp, t);
        }, 2000);

        // если эпизод досмотрен до конца — очищаем прогресс
        video.onended = () => {
            clearProgress();
        };
    }

    // === кнопка "Продолжить просмотр" по id ===
    (function setupContinueButton() {
        continueWrap.innerHTML = '';
        const saved = readProgress();
        if (!saved) return;

        // Если сохранённый эпизод за пределами — игнорируем
        if (saved.episode < 0 || saved.episode >= series.length) return;

        const btn = document.createElement('button');
        btn.className = 'px-3 py-1 bg-green-600 hover:bg-green-400 rounded text-sm text-white';
        btn.textContent = `Продолжить: серия ${saved.episode + 1}, ${formatTime(saved.time)}`;
        btn.addEventListener('click', () => {
            // визуально переключаем активную кнопку серии
            document.querySelectorAll('#episode-buttons > button').forEach(b => b.classList.remove('bg-[#87969f]'));
            const targetBtn = episodeButtons.children[saved.episode];
            if (targetBtn) targetBtn.classList.add('bg-[#87969f]');

            setupVideoForEpisode(saved.episode, saved.time);
            video.play().catch(() => {});
            location.hash = `#/anime/${id}/${saved.episode + 1}`;
        });
        continueWrap.appendChild(btn);
    })();

    // === кнопки эпизодов ===
    series.forEach((ep, idx) => {
        const b = document.createElement('button');
        b.className = 'px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm';
        if (idx === currentEpisode) b.classList.add('bg-[#87969f]');
        b.textContent = ep.name;

        b.addEventListener('click', () => {
            // перед переключением — если был просмотр, сохраним текущий прогресс
            const t = Math.floor(video.currentTime || 0);
            if (t > 0) writeProgress(currentEp, t);

            document.querySelectorAll('#episode-buttons > button')
                .forEach(x => x.classList.remove('bg-[#87969f]'));
            b.classList.add('bg-[#87969f]');

            location.hash = `#/anime/${id}/${idx + 1}`;
            setupVideoForEpisode(idx);
        });

        episodeButtons.appendChild(b);
    });

    // стартовый эпизод (без автопрыжка к сохранённому — это делает кнопка)
    setupVideoForEpisode(currentEpisode);

    // на выходе со страницы — тоже попробуем сохранить
    window.addEventListener('beforeunload', () => {
        const t = Math.floor(video.currentTime || 0);
        if (t > 0) writeProgress(currentEp, t);
    });
}

function handleScroll() {
    if (!isMainPage) return;
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 800) {
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
	if (oldHash === undefined) oldHash = '';
    	
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
    if (animePage && !match) animePage.remove();

    isMainPage = (hash.length < 2);
    if (!isMainPage) page = 1;
	
    if (isMainPage) {
		console.log("a")
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
