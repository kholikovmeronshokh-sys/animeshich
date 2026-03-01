import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFromFile(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFromFile(path.join(__dirname, '.env'));
const PORT = Number(process.env.PORT || 3000);
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

const cache = new Map();
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function getCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (item.expireAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function setCache(key, value, ttlMs) {
  cache.set(key, { value, expireAt: Date.now() + ttlMs });
}

async function fetchJson(url, { retries = 2, timeoutMs = 12000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timeout);

      if (response.status === 429 && attempt < retries) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 1000));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeout);
      if (attempt >= retries) throw error;
      await new Promise((r) => setTimeout(r, (attempt + 1) * 800));
    }
  }

  throw new Error('Request failed');
}

async function proxyCached(res, url, ttlMs = 60000) {
  const cached = getCache(url);
  if (cached) {
    json(res, 200, cached);
    return;
  }

  const data = await fetchJson(url);
  setCache(url, data, ttlMs);
  json(res, 200, data);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function routePage(pathname) {
  const routes = new Set(['/','/home','/news','/top','/thebest','/popular','/random','/mylist']);
  return routes.has(pathname);
}

async function serveFile(res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(__dirname, safePath);
  const ext = path.extname(filePath).toLowerCase();

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

async function handleApi(req, res, url) {
  const page = Number(url.searchParams.get('page') || '1');
  const limit = Number(url.searchParams.get('limit') || '12');
  const daySeed = Number(url.searchParams.get('day_seed') || '0');
  const rotatePage = (basePage, modulo = 4) => basePage + (daySeed % modulo);

  if (url.pathname === '/api/home') {
    const p = rotatePage(page, 3);
    await proxyCached(res, `https://api.jikan.moe/v4/top/anime?page=${p}&limit=${limit}&filter=airing`);
    return;
  }

  if (url.pathname === '/api/top') {
    const p = rotatePage(page, 5);
    const cappedLimit = Math.min(Math.max(limit, 1), 100);
    const pagesNeeded = Math.ceil(cappedLimit / 25);
    const cacheKey = `top:${p}:${cappedLimit}:airing`;
    const cached = getCache(cacheKey);
    if (cached) {
      json(res, 200, cached);
      return;
    }

    const chunks = await Promise.all(
      Array.from({ length: pagesNeeded }, (_, idx) =>
        fetchJson(`https://api.jikan.moe/v4/top/anime?page=${p + idx}&limit=25&filter=airing`)
      )
    );

    const all = chunks.flatMap((item) => item?.data || []).slice(0, cappedLimit);
    const merged = {
      data: all,
      pagination: {
        has_previous_page: p > 1,
        has_next_page: all.length === cappedLimit
      }
    };
    setCache(cacheKey, merged, 60000);
    json(res, 200, merged);
    return;
  }

  if (url.pathname === '/api/popular') {
    const p = rotatePage(page, 4);
    await proxyCached(res, `https://api.jikan.moe/v4/top/anime?page=${p}&limit=${limit}&filter=bypopularity`);
    return;
  }

  if (url.pathname === '/api/thebest') {
    const p = rotatePage(page, 4);
    await proxyCached(res, `https://api.jikan.moe/v4/top/anime?page=${p}&limit=${limit}&filter=favorite`);
    return;
  }

  if (url.pathname === '/api/random') {
    const count = Math.min(Math.max(Number(url.searchParams.get('count') || '12'), 1), 20);
    const allowAdult = url.searchParams.get('adult') === '1';
    const p = rotatePage(page, 7);
    const excludeParam = url.searchParams.get('exclude') || '';
    const excludeIds = new Set(
      excludeParam
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isFinite(x) && x > 0)
    );

    const poolKey = `random_pool:${p}:${daySeed}`;
    let pool = getCache(poolKey);

    if (!pool) {
      const sources = [
        `https://api.jikan.moe/v4/top/anime?page=${p}&limit=25&filter=bypopularity`,
        `https://api.jikan.moe/v4/top/anime?page=${p + 1}&limit=25&filter=airing`,
        `https://api.jikan.moe/v4/top/anime?page=${p + 2}&limit=25&filter=favorite`
      ];

      const chunks = await Promise.all(sources.map((src) => fetchJson(src)));
      const map = new Map();

      for (const chunk of chunks) {
        for (const anime of chunk?.data || []) {
          if (!anime?.mal_id) continue;
          if (!allowAdult) {
            if (Array.isArray(anime.explicit_genres) && anime.explicit_genres.length > 0) continue;
            if (anime.rating === 'Rx - Hentai') continue;
            const genreNames = (anime.genres || []).map((g) => String(g?.name || '').toLowerCase());
            if (genreNames.includes('hentai') || genreNames.includes('erotica')) continue;
          }
          map.set(anime.mal_id, anime);
        }
      }

      pool = Array.from(map.values());
      setCache(poolKey, pool, 300000);
    }

    const available = pool.filter((anime) => !excludeIds.has(anime.mal_id));
    const source = available.length >= count ? available : pool;
    const shuffled = [...source].sort(() => Math.random() - 0.5);
    const list = shuffled.slice(0, count);

    json(res, 200, { data: list });
    return;
  }

  if (url.pathname === '/api/news') {
    const p = rotatePage(page, 6);
    await proxyCached(res, `https://api.jikan.moe/v4/seasons/upcoming?page=${p}&limit=${limit}`, 45000);
    return;
  }

  if (url.pathname === '/api/genres') {
    await proxyCached(res, 'https://api.jikan.moe/v4/genres/anime', 300000);
    return;
  }

  if (url.pathname === '/api/search') {
    const q = url.searchParams.get('q') || '';
    const type = url.searchParams.get('type') || '';
    const status = url.searchParams.get('status') || '';
    const minScore = url.searchParams.get('min_score') || '';
    const genres = url.searchParams.get('genres') || '';
    const orderBy = url.searchParams.get('order_by') || 'score';
    const sort = url.searchParams.get('sort') || 'desc';

    const params = new URLSearchParams({ page: String(page), limit: String(limit), q, order_by: orderBy, sort });
    if (type) params.set('type', type);
    if (status) params.set('status', status);
    if (minScore) params.set('min_score', minScore);
    if (genres) params.set('genres', genres);

    await proxyCached(res, `https://api.jikan.moe/v4/anime?${params.toString()}`, 35000);
    return;
  }

  if (url.pathname.startsWith('/api/anime/') && url.pathname.endsWith('/full')) {
    const id = url.pathname.split('/')[3];
    await proxyCached(res, `https://api.jikan.moe/v4/anime/${id}/full`, 90000);
    return;
  }

  if (url.pathname === '/api/translate' && req.method === 'POST') {
    if (!GROQ_API_KEY) {
      json(res, 503, { error: 'GROQ_API_KEY отсутствует на сервере' });
      return;
    }

    const body = await parseBody(req);
    const text = String(body.text || '').trim();
    const target = String(body.target || 'ru');

    if (!text) {
      json(res, 400, { error: 'Пустой текст' });
      return;
    }

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `Ты переводчик. Переведи текст на ${target}. Сохраняй имена и термины. Верни только перевод без объяснений.`
          },
          { role: 'user', content: text }
        ]
      })
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      json(res, 502, { error: `Ошибка перевода: ${errText.slice(0, 300)}` });
      return;
    }

    const groqJson = await groqRes.json();
    const translatedText = groqJson?.choices?.[0]?.message?.content?.trim() || '';
    json(res, 200, { translatedText });
    return;
  }

  json(res, 404, { error: 'API route not found' });
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    if (routePage(url.pathname)) {
      await serveFile(res, '/index.html');
      return;
    }

    await serveFile(res, url.pathname);
  } catch (error) {
    json(res, 500, { error: error.message || 'Internal server error' });
  }
}

const server = http.createServer(handleRequest);

if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`AnimeVerse server running at http://localhost:${PORT}`);
  });
}

export default handleRequest;

