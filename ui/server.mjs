import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.MEMORY_UI_PORT || '3460');
const USER = process.env.MEMORY_UI_USER || 'admin';
const PASS = process.env.MEMORY_UI_PASS || 'admin';
const QDRANT = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = process.env.QDRANT_COLLECTION || 'memory-smart';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

function checkAuth(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Memory Explorer"' });
    res.end('Unauthorized');
    return false;
  }
  const [u, p] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  if (u !== USER || p !== PASS) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Memory Explorer"' });
    res.end('Unauthorized');
    return false;
  }
  return true;
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString();
}

async function qdrant(method, endpoint, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${QDRANT}${endpoint}`, opts);
  return r.json();
}

async function embed(text) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text })
  });
  const d = await r.json();
  return d.data[0].embedding;
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  if (!checkAuth(req, res)) return;

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    // API routes
    if (p === '/api/stats' && req.method === 'GET') {
      const data = await qdrant('GET', `/collections/${COLLECTION}`);
      return json(res, 200, data.result || data);
    }

    if (p === '/api/memories' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const offset = url.searchParams.get('offset') || null;
      const category = url.searchParams.get('category') || null;

      const body = {
        limit,
        with_payload: true,
        with_vector: false,
      };
      if (offset) body.offset = offset;

      let filter = null;
      if (category) {
        filter = { must: [{ key: 'category', match: { value: category } }] };
        body.filter = filter;
      }

      const data = await qdrant('POST', `/collections/${COLLECTION}/points/scroll`, body);
      return json(res, 200, data.result || data);
    }

    if (p === '/api/search' && req.method === 'POST') {
      const { query, limit = 20 } = JSON.parse(await readBody(req));
      if (!OPENAI_KEY) return json(res, 500, { error: 'OPENAI_API_KEY not configured' });
      const vector = await embed(query);
      const data = await qdrant('POST', `/collections/${COLLECTION}/points/query`, {
        query: vector,
        limit,
        with_payload: true,
      });
      return json(res, 200, data.result || data);
    }

    if (p === '/api/export' && req.method === 'GET') {
      // Export all memories as JSON
      const all = [];
      let offset = null;
      while (true) {
        const body = { limit: 100, with_payload: true, with_vector: false };
        if (offset) body.offset = offset;
        const data = await qdrant('POST', `/collections/${COLLECTION}/points/scroll`, body);
        const result = data.result || data;
        all.push(...(result.points || []));
        if (!result.next_page_offset) break;
        offset = result.next_page_offset;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="memory-smart-export-${new Date().toISOString().slice(0,10)}.json"`
      });
      res.end(JSON.stringify({ exported: new Date().toISOString(), count: all.length, memories: all }, null, 2));
      return;
    }

    if (p.startsWith('/api/memories/') && req.method === 'DELETE') {
      const id = p.split('/').pop();
      const data = await qdrant('POST', `/collections/${COLLECTION}/points/delete`, {
        points: [id]
      });
      return json(res, 200, data);
    }

    // Static files
    let filePath = path.join(__dirname, 'public', p === '/' ? 'index.html' : p);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      // SPA fallback
      res.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(path.join(__dirname, 'public', 'index.html')).pipe(res);
    }
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Memory Explorer running on http://localhost:${PORT}`));
