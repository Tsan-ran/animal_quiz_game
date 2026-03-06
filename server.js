import dotenv from 'dotenv';
import express from 'express';
import { Pool } from 'pg';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('Missing DATABASE_URL in environment.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl
});

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 15;
const rateMap = new Map();

app.use(express.json({ limit: '32kb' }));
app.use(express.static('.'));

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function rateLimit(req, res, next) {
  const now = Date.now();
  const ip = getClientIp(req);
  const entry = rateMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  entry.count += 1;
  next();
}

app.get('/api/leaderboard', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT name, score, rank, date
       FROM leaderboard
       ORDER BY score DESC, date DESC
       LIMIT 50`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('GET /api/leaderboard failed:', error);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

app.post('/api/leaderboard', rateLimit, async (req, res) => {
  try {
    const { name, score, rank, date } = req.body || {};

    if (typeof name !== 'string' || name.length < 2 || name.length > 12) {
      return res.status(400).json({ error: 'Invalid name' });
    }
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      return res.status(400).json({ error: 'Invalid score' });
    }
    if (typeof rank !== 'string' || rank.length < 1 || rank.length > 20) {
      return res.status(400).json({ error: 'Invalid rank' });
    }

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date' });
    }

    await pool.query(
      `INSERT INTO leaderboard (name, score, rank, date)
       VALUES ($1, $2, $3, $4)`,
      [name, score, rank, parsedDate.toISOString()]
    );

    res.status(201).json({ ok: true });
  } catch (error) {
    console.error('POST /api/leaderboard failed:', error);
    res.status(500).json({ error: 'Failed to save score' });
  }
});

app.get('/api/admin/leaderboard', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, score, rank, date
       FROM leaderboard
       ORDER BY date DESC
       LIMIT 500`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('GET /api/admin/leaderboard failed:', error);
    res.status(500).json({ error: 'Failed to load admin leaderboard' });
  }
});

app.patch('/api/admin/leaderboard/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, score, rank, date } = req.body || {};

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    if (typeof name !== 'string' || name.length < 2 || name.length > 12) {
      return res.status(400).json({ error: 'Invalid name' });
    }
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      return res.status(400).json({ error: 'Invalid score' });
    }
    if (typeof rank !== 'string' || rank.length < 1 || rank.length > 20) {
      return res.status(400).json({ error: 'Invalid rank' });
    }
    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date' });
    }

    const result = await pool.query(
      `UPDATE leaderboard
       SET name = $1, score = $2, rank = $3, date = $4
       WHERE id = $5`,
      [name, score, rank, parsedDate.toISOString(), id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('PATCH /api/admin/leaderboard/:id failed:', error);
    res.status(500).json({ error: 'Failed to update record' });
  }
});

app.delete('/api/admin/leaderboard/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const result = await pool.query(
      `DELETE FROM leaderboard
       WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/admin/leaderboard/:id failed:', error);
    res.status(500).json({ error: 'Failed to delete record' });
  }
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

const initSql = `
CREATE TABLE IF NOT EXISTS leaderboard (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(12) NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0),
  rank VARCHAR(20) NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function start() {
  try {
    await pool.query(initSql);
    app.listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

start();
