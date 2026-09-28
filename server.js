import { createServer } from 'node:http';
import { readFile, stat, mkdir, readdir, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = process.env.ROUTINE_DATA_DIR || join(ROOT, 'data');
const BACKUP_DIR = process.env.ROUTINE_BACKUP_DIR || join(ROOT, 'backups');
const DB_PATH = join(DATA_DIR, 'routine.db');
const HOST = process.env.ROUTINE_HOST || '127.0.0.1';
const PORT = Number(process.env.ROUTINE_PORT || 8780);
const MAX_BODY = 1_000_000;
const BACKUP_KEEP_DAYS = 30;
const PAGES_ORIGIN = 'https://sosu7985-jpg.github.io';

await mkdir(DATA_DIR, { recursive: true });
await mkdir(BACKUP_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
    type TEXT NOT NULL CHECK(type IN ('check', 'number')),
    unit TEXT NOT NULL DEFAULT '',
    target_value REAL NOT NULL DEFAULT 1 CHECK(target_value > 0),
    color TEXT NOT NULL DEFAULT '#6366f1',
    schedule_days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    sort_order INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS habit_logs (
    id TEXT PRIMARY KEY,
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    log_date TEXT NOT NULL CHECK(length(log_date) = 10),
    status TEXT NOT NULL CHECK(status IN ('completed', 'partial', 'rest')),
    numeric_value REAL NOT NULL DEFAULT 0 CHECK(numeric_value >= 0),
    updated_at TEXT NOT NULL,
    UNIQUE(habit_id, log_date)
  );

  CREATE INDEX IF NOT EXISTS idx_habits_order ON habits(archived, sort_order);
  CREATE INDEX IF NOT EXISTS idx_logs_date ON habit_logs(log_date);
  CREATE INDEX IF NOT EXISTS idx_logs_habit_date ON habit_logs(habit_id, log_date);
`);

const habitColumns = new Set(db.prepare('PRAGMA table_info(habits)').all().map((column) => column.name));
if (!habitColumns.has('schedule_type')) {
  db.exec("ALTER TABLE habits ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'weekly'");
}
if (!habitColumns.has('interval_days')) {
  db.exec('ALTER TABLE habits ADD COLUMN interval_days INTEGER NOT NULL DEFAULT 14');
}
if (!habitColumns.has('anchor_date')) {
  db.exec('ALTER TABLE habits ADD COLUMN anchor_date TEXT');
}

const sql = {
  habits: db.prepare('SELECT * FROM habits ORDER BY archived ASC, sort_order ASC, created_at ASC'),
  habit: db.prepare('SELECT * FROM habits WHERE id = ?'),
  insertHabit: db.prepare(`
    INSERT INTO habits (id, title, type, unit, target_value, color, schedule_days, schedule_type, interval_days, anchor_date, sort_order, archived, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `),
  updateHabit: db.prepare(`
    UPDATE habits SET title=?, type=?, unit=?, target_value=?, color=?, schedule_days=?, schedule_type=?, interval_days=?, anchor_date=?, archived=?, updated_at=?
    WHERE id=?
  `),
  setOrder: db.prepare('UPDATE habits SET sort_order=?, updated_at=? WHERE id=?'),
  logsAll: db.prepare('SELECT * FROM habit_logs ORDER BY log_date ASC'),
  logsRange: db.prepare('SELECT * FROM habit_logs WHERE log_date BETWEEN ? AND ? ORDER BY log_date ASC'),
  log: db.prepare('SELECT * FROM habit_logs WHERE habit_id=? AND log_date=?'),
  upsertLog: db.prepare(`
    INSERT INTO habit_logs (id, habit_id, log_date, status, numeric_value, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(habit_id, log_date) DO UPDATE SET
      status=excluded.status, numeric_value=excluded.numeric_value, updated_at=excluded.updated_at
  `),
  deleteLog: db.prepare('DELETE FROM habit_logs WHERE habit_id=? AND log_date=?'),
  clearLogs: db.prepare('DELETE FROM habit_logs'),
  clearHabits: db.prepare('DELETE FROM habits')
};

function now() {
  return new Date().toISOString();
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function parseDays(value) {
  const input = Array.isArray(value) ? value : [];
  const days = [...new Set(input.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  if (days.length === 0) throw new HttpError(400, '실행 요일을 하나 이상 선택해 주세요.');
  return days;
}

function cleanColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : '#6366f1';
}

function rowHabit(row) {
  return {
    ...row,
    archived: Boolean(row.archived),
    schedule_days: JSON.parse(row.schedule_days),
    schedule_type: ['weekly', 'interval', 'monthly'].includes(row.schedule_type) ? row.schedule_type : 'weekly',
    interval_days: Math.max(1, Number(row.interval_days) || 14),
    anchor_date: isDate(row.anchor_date) ? row.anchor_date : row.created_at.slice(0, 10)
  };
}

function cleanHabit(input, current = null) {
  const title = String(input.title ?? current?.title ?? '').trim();
  if (!title || title.length > 100) throw new HttpError(400, '습관 이름은 1~100자로 입력해 주세요.');
  const type = input.type ?? current?.type ?? 'check';
  if (!['check', 'number'].includes(type)) throw new HttpError(400, '지원하지 않는 습관 유형입니다.');
  const target = type === 'number' ? Number(input.target_value ?? current?.target_value ?? 1) : 1;
  if (!Number.isFinite(target) || target <= 0) throw new HttpError(400, '목표 수치는 0보다 커야 합니다.');
  const unit = type === 'number' ? String(input.unit ?? current?.unit ?? '회').trim().slice(0, 20) : '';
  const scheduleType = input.schedule_type ?? current?.schedule_type ?? 'weekly';
  if (!['weekly', 'interval', 'monthly'].includes(scheduleType)) throw new HttpError(400, '지원하지 않는 반복 방식입니다.');
  const intervalDays = Number(input.interval_days ?? current?.interval_days ?? 14);
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) {
    throw new HttpError(400, '반복 간격은 1~365일로 입력해 주세요.');
  }
  const requestedAnchor = input.anchor_date ?? current?.anchor_date ?? new Date().toISOString().slice(0, 10);
  if (!isDate(requestedAnchor)) throw new HttpError(400, '첫 예정일이 올바르지 않습니다.');
  return {
    title,
    type,
    unit,
    target_value: target,
    color: cleanColor(input.color ?? current?.color),
    schedule_days: scheduleType === 'weekly'
      ? parseDays(input.schedule_days ?? current?.schedule_days ?? [0, 1, 2, 3, 4, 5, 6])
      : (current?.schedule_days || [0, 1, 2, 3, 4, 5, 6]),
    schedule_type: scheduleType,
    interval_days: intervalDays,
    anchor_date: requestedAnchor,
    archived: Boolean(input.archived ?? current?.archived ?? false)
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(data);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, '요청 데이터가 너무 큽니다.');
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw new HttpError(400, '올바른 JSON 형식이 아닙니다.');
  }
}

function getHabitOrThrow(id) {
  const row = sql.habit.get(id);
  if (!row) throw new HttpError(404, '습관을 찾을 수 없습니다.');
  return rowHabit(row);
}

function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

async function createBackup(force = false) {
  const day = new Date().toISOString().slice(0, 10);
  const target = join(BACKUP_DIR, `routine-${day}.db`);
  if (!force) {
    try {
      await stat(target);
      return target;
    } catch {}
  }
  const actualTarget = force ? join(BACKUP_DIR, `routine-${new Date().toISOString().replace(/[:.]/g, '-')}.db`) : target;
  await sqliteBackup(db, actualTarget);
  const cutoff = Date.now() - BACKUP_KEEP_DAYS * 86400000;
  for (const name of await readdir(BACKUP_DIR)) {
    if (!/^routine-.*\.db$/.test(name)) continue;
    const path = join(BACKUP_DIR, name);
    const info = await stat(path);
    if (info.mtimeMs < cutoff) await unlink(path);
  }
  return actualTarget;
}

async function handleApi(req, res, url) {
  const method = req.method || 'GET';
  if (method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'MyRoutine',
      version: '2.0.0',
      server_time: now(),
      user: req.headers['tailscale-user-login'] || null
    });
  }

  if (method === 'GET' && url.pathname === '/api/habits') {
    return sendJson(res, 200, { habits: sql.habits.all().map(rowHabit) });
  }

  if (method === 'POST' && url.pathname === '/api/habits') {
    const body = await readJson(req);
    const habit = cleanHabit(body);
    const id = randomUUID();
    const stamp = now();
    const maxOrder = Number(db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM habits').get().value);
    sql.insertHabit.run(id, habit.title, habit.type, habit.unit, habit.target_value, habit.color, JSON.stringify(habit.schedule_days), habit.schedule_type, habit.interval_days, habit.anchor_date, maxOrder + 1, stamp, stamp);
    return sendJson(res, 201, { habit: getHabitOrThrow(id) });
  }

  const habitMatch = url.pathname.match(/^\/api\/habits\/([0-9a-f-]{36})$/i);
  if (method === 'PUT' && habitMatch) {
    const current = getHabitOrThrow(habitMatch[1]);
    const habit = cleanHabit(await readJson(req), current);
    sql.updateHabit.run(habit.title, habit.type, habit.unit, habit.target_value, habit.color, JSON.stringify(habit.schedule_days), habit.schedule_type, habit.interval_days, habit.anchor_date, habit.archived ? 1 : 0, now(), current.id);
    return sendJson(res, 200, { habit: getHabitOrThrow(current.id) });
  }

  if (method === 'POST' && url.pathname === '/api/habits/reorder') {
    const body = await readJson(req);
    if (!Array.isArray(body.ids)) throw new HttpError(400, '정렬할 습관 목록이 필요합니다.');
    const stamp = now();
    transaction(() => body.ids.forEach((id, index) => sql.setOrder.run(index, stamp, String(id))));
    return sendJson(res, 200, { habits: sql.habits.all().map(rowHabit) });
  }

  if (method === 'GET' && url.pathname === '/api/logs') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const logs = from && to && isDate(from) && isDate(to) ? sql.logsRange.all(from, to) : sql.logsAll.all();
    return sendJson(res, 200, { logs });
  }

  const logMatch = url.pathname.match(/^\/api\/logs\/([0-9a-f-]{36})\/(\d{4}-\d{2}-\d{2})$/i);
  if (method === 'PUT' && logMatch) {
    const habit = getHabitOrThrow(logMatch[1]);
    const date = logMatch[2];
    if (!isDate(date)) throw new HttpError(400, '날짜 형식이 올바르지 않습니다.');
    const body = await readJson(req);
    const requested = String(body.status || 'none');
    if (requested === 'none') {
      sql.deleteLog.run(habit.id, date);
      return sendJson(res, 200, { log: null });
    }
    let status;
    let numericValue = 0;
    if (requested === 'rest') {
      status = 'rest';
    } else if (habit.type === 'number') {
      numericValue = Math.max(0, Number(body.numeric_value) || 0);
      if (numericValue === 0) {
        sql.deleteLog.run(habit.id, date);
        return sendJson(res, 200, { log: null });
      }
      status = numericValue >= habit.target_value ? 'completed' : 'partial';
    } else {
      status = 'completed';
      numericValue = 1;
    }
    const existing = sql.log.get(habit.id, date);
    sql.upsertLog.run(existing?.id || randomUUID(), habit.id, date, status, numericValue, now());
    return sendJson(res, 200, { log: sql.log.get(habit.id, date) });
  }

  if (method === 'GET' && url.pathname === '/api/export') {
    return sendJson(res, 200, {
      format: 'myroutine-backup',
      version: 2,
      exported_at: now(),
      habits: sql.habits.all().map(rowHabit),
      logs: sql.logsAll.all()
    });
  }

  if (method === 'POST' && url.pathname === '/api/import') {
    const body = await readJson(req);
    if (body.format !== 'myroutine-backup' || !Array.isArray(body.habits) || !Array.isArray(body.logs)) {
      throw new HttpError(400, 'MyRoutine 백업 파일이 아닙니다.');
    }
    await createBackup(true);
    transaction(() => {
      sql.clearLogs.run();
      sql.clearHabits.run();
      const stamp = now();
      body.habits.forEach((raw, index) => {
        const habit = cleanHabit(raw);
        const id = /^[0-9a-f-]{36}$/i.test(String(raw.id || '')) ? raw.id : randomUUID();
        sql.insertHabit.run(id, habit.title, habit.type, habit.unit, habit.target_value, habit.color, JSON.stringify(habit.schedule_days), habit.schedule_type, habit.interval_days, habit.anchor_date, index, raw.created_at || stamp, raw.updated_at || stamp);
        if (habit.archived) db.prepare('UPDATE habits SET archived=1 WHERE id=?').run(id);
      });
      body.logs.forEach((raw) => {
        if (!sql.habit.get(raw.habit_id) || !isDate(raw.log_date) || !['completed', 'partial', 'rest'].includes(raw.status)) return;
        sql.upsertLog.run(/^[0-9a-f-]{36}$/i.test(String(raw.id || '')) ? raw.id : randomUUID(), raw.habit_id, raw.log_date, raw.status, Math.max(0, Number(raw.numeric_value) || 0), raw.updated_at || stamp);
      });
    });
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'POST' && url.pathname === '/api/backup') {
    const path = await createBackup(true);
    return sendJson(res, 201, { ok: true, file: path.split(/[\\/]/).pop() });
  }

  throw new HttpError(404, 'API 경로를 찾을 수 없습니다.');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

async function serveStatic(req, res, url) {
  const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const path = normalize(join(PUBLIC_DIR, requested));
  if (!path.startsWith(resolve(PUBLIC_DIR) + sep) && path !== join(PUBLIC_DIR, 'index.html')) throw new HttpError(403, '접근할 수 없습니다.');
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new HttpError(404, '파일을 찾을 수 없습니다.');
  }
  if (!info.isFile()) throw new HttpError(404, '파일을 찾을 수 없습니다.');
  res.writeHead(200, {
    'Content-Type': MIME[extname(path).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  createReadStream(path).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      const origin = req.headers.origin;
      const sameHostOrigins = new Set([`https://${req.headers.host}`, `http://${req.headers.host}`]);
      if (origin && origin !== PAGES_ORIGIN && !sameHostOrigins.has(origin)) {
        throw new HttpError(403, '허용되지 않은 웹앱 출처입니다.');
      }
      if (origin === PAGES_ORIGIN) {
        res.setHeader('Access-Control-Allow-Origin', PAGES_ORIGIN);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.setHeader('Vary', 'Origin, Access-Control-Request-Private-Network');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
      } else await handleApi(req, res, url);
    }
    else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, url);
    else throw new HttpError(405, '허용되지 않는 요청입니다.');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? '서버 오류가 발생했습니다.' : error.message });
    else res.destroy();
  }
});

await createBackup(false);
setInterval(() => createBackup(false).catch(console.error), 6 * 60 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  console.log(`[MyRoutine] http://${HOST}:${PORT}`);
  console.log(`[MyRoutine] DB: ${DB_PATH}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
