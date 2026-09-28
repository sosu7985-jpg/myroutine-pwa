import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const port = 18780;
const base = `http://127.0.0.1:${port}`;
let child;
let temp;

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body;
}

test.before(async () => {
  temp = await mkdtemp(join(tmpdir(), 'myroutine-test-'));
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      ROUTINE_PORT: String(port),
      ROUTINE_DATA_DIR: join(temp, 'data'),
      ROUTINE_BACKUP_DIR: join(temp, 'backups')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Test server did not start');
});

test.after(async () => {
  child?.kill('SIGTERM');
  await new Promise((resolve) => child?.once('exit', resolve));
  await rm(temp, { recursive: true, force: true });
});

test('empty database starts clean', async () => {
  const data = await request('/api/habits');
  assert.deepEqual(data.habits, []);
});

test('habit CRUD and numeric progress normalization work', async () => {
  const created = await request('/api/habits', {
    method: 'POST',
    body: JSON.stringify({
      title: '팔굽혀펴기', type: 'number', unit: '회', target_value: 50,
      color: '#ef4444', schedule_days: [1, 2, 3, 4, 5]
    })
  });
  assert.equal(created.habit.title, '팔굽혀펴기');
  assert.deepEqual(created.habit.schedule_days, [1, 2, 3, 4, 5]);
  assert.equal(created.habit.schedule_type, 'weekly');

  const partial = await request(`/api/logs/${created.habit.id}/2026-09-25`, {
    method: 'PUT', body: JSON.stringify({ status: 'record', numeric_value: 25 })
  });
  assert.equal(partial.log.status, 'partial');

  const complete = await request(`/api/logs/${created.habit.id}/2026-09-25`, {
    method: 'PUT', body: JSON.stringify({ status: 'record', numeric_value: 50 })
  });
  assert.equal(complete.log.status, 'completed');

  const archived = await request(`/api/habits/${created.habit.id}`, {
    method: 'PUT', body: JSON.stringify({ archived: true })
  });
  assert.equal(archived.habit.archived, true);
});

test('interval and monthly routines preserve their recurrence settings', async () => {
  const interval = await request('/api/habits', {
    method: 'POST',
    body: JSON.stringify({
      title: '손톱 자르기', type: 'check', color: '#3b82f6',
      schedule_type: 'interval', interval_days: 14, anchor_date: '2026-09-28'
    })
  });
  assert.equal(interval.habit.schedule_type, 'interval');
  assert.equal(interval.habit.interval_days, 14);
  assert.equal(interval.habit.anchor_date, '2026-09-28');

  const monthly = await request('/api/habits', {
    method: 'POST',
    body: JSON.stringify({
      title: '가계부 최신화', type: 'check', color: '#10b981',
      schedule_type: 'monthly', anchor_date: '2026-09-28'
    })
  });
  assert.equal(monthly.habit.schedule_type, 'monthly');
  assert.equal(monthly.habit.interval_days, 14);
});

test('export and backup endpoints work', async () => {
  const exported = await request('/api/export');
  assert.equal(exported.format, 'myroutine-backup');
  assert.equal(exported.habits.length, 3);
  assert.equal(exported.logs.length, 1);
  const backedUp = await request('/api/backup', { method: 'POST', body: '{}' });
  assert.equal(backedUp.ok, true);
  assert.match(backedUp.file, /^routine-.*\.db$/);
});

test('static app is served without external dependencies', async () => {
  const response = await fetch(`${base}/`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /MyRoutine/);
  assert.doesNotMatch(html, /cdn\.|supabase/i);

  const workerResponse = await fetch(`${base}/sw.js`);
  const worker = await workerResponse.text();
  assert.equal(workerResponse.status, 200);
  assert.match(worker, /respondWith\(fetch\(event\.request\)\)/);
  assert.match(worker, /requestUrl\.origin === self\.location\.origin/);
  assert.doesNotMatch(worker, /caches\./);
});

test('GitHub Pages origin is the only cross-origin API client', async () => {
  const allowed = await fetch(`${base}/api/health`, {
    headers: { Origin: 'https://sosu7985-jpg.github.io' }
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://sosu7985-jpg.github.io');

  const preflight = await fetch(`${base}/api/habits`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://sosu7985-jpg.github.io',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
      'Access-Control-Request-Private-Network': 'true'
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');

  const denied = await fetch(`${base}/api/health`, {
    headers: { Origin: 'https://example.com' }
  });
  assert.equal(denied.status, 403);
});
