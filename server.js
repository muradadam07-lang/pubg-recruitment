const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const initSqlJs = require('sql.js');
const ytSearch = require('yt-search');

const app = express();
const DB_PATH = path.join(__dirname, 'recruitment.db');

// sql.js wrapper — provides better-sqlite3 compatible API
let db;
function prepareDb(sqlDb) {
  function Statement(sql) {
    this.sql = sql;
  }
  Statement.prototype = {
    get(params) {
      params = params || [];
      if (!Array.isArray(params)) params = [params];
      try {
        const stmt = sqlDb.prepare(this.sql);
        if (params.length > 0) stmt.bind(params);
        const has = stmt.step();
        const row = has ? stmt.getAsObject() : undefined;
        stmt.free();
        return row;
      } catch(e) { return undefined; }
    },
    all(params) {
      params = params || [];
      if (!Array.isArray(params)) params = [params];
      try {
        const stmt = sqlDb.prepare(this.sql);
        if (params.length > 0) stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      } catch(e) { return []; }
    },
    run(params) {
      params = params || [];
      if (!Array.isArray(params)) params = [params];
      try {
        sqlDb.run(this.sql, params);
        const res = { changes: sqlDb.getRowsModified(), lastInsertRowid: sqlDb.exec("SELECT last_insert_rowid()")[0]?.values[0][0] };
        db.save();
        return res;
      } catch(e) { throw e; }
    }
  };
  const wrap = {
    prepare: (sql) => new Statement(sql),
    exec: (sql) => { try { return sqlDb.run(sql); } catch(e) { throw e; } },
    transaction: (fn) => (...args) => { sqlDb.run("BEGIN"); try { const r = fn(...args); sqlDb.run("COMMIT"); return r; } catch(e) { sqlDb.run("ROLLBACK"); throw e; } },
    save: () => { try { const d = sqlDb.export(); fs.writeFileSync(DB_PATH, Buffer.from(d)); } catch(e) {} }
  };
  return wrap;
}

function placementPoints(pos) {
  if (pos <= 0) return 0;
  if (pos === 1) return 10;
  if (pos === 2) return 6;
  if (pos === 3) return 5;
  if (pos === 4) return 4;
  if (pos === 5) return 3;
  if (pos === 6) return 2;
  if (pos === 7) return 1;
  if (pos === 8) return 1;
  return 0;
}

async function initDb() {
  const SQL = await initSqlJs();
  let buf;
  try { buf = fs.readFileSync(DB_PATH); } catch(e) {}
  const sqlDb = new SQL.Database(buf);
  sqlDb.run(`CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT NOT NULL,
    ign TEXT NOT NULL, pubg_id TEXT NOT NULL, role TEXT NOT NULL,
    tier TEXT NOT NULL, kd REAL, wins INTEGER, experience TEXT,
    about TEXT, cv_path TEXT, status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  sqlDb.run(`CREATE TABLE IF NOT EXISTS replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL, admin_name TEXT NOT NULL,
    message TEXT NOT NULL, status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id)
  )`);
  sqlDb.run(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL, password TEXT NOT NULL
  )`);
  sqlDb.run(`CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  sqlDb.run(`CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, game_count INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  sqlDb.run(`CREATE TABLE IF NOT EXISTS match_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    game_number INTEGER DEFAULT 1,
    placement INTEGER DEFAULT 0,
    kills INTEGER DEFAULT 0,
    points INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
    FOREIGN KEY (team_id) REFERENCES teams(id)
  )`);

  // Migration check
  try {
    const cols = sqlDb.exec("PRAGMA table_info(match_results)");
    const colNames = cols[0] ? cols[0].values.map(v => v[1]) : [];
    if (colNames.includes('player_id') && !colNames.includes('team_id')) {
      sqlDb.run("DROP TABLE IF EXISTS match_results");
      sqlDb.run(`CREATE TABLE match_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tournament_id INTEGER NOT NULL,
        team_id INTEGER NOT NULL,
        game_number INTEGER DEFAULT 1,
        placement INTEGER DEFAULT 0,
        kills INTEGER DEFAULT 0,
        points INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
        FOREIGN KEY (team_id) REFERENCES teams(id)
      )`);
    }
  } catch(e) {}
  try { sqlDb.run("DROP TABLE IF EXISTS results"); } catch(e) {}

  db = prepareDb(sqlDb);

  const adminExists = db.prepare('SELECT COUNT(*) as count FROM admins').get();
  if (adminExists && adminExists.count === 0) {
    db.prepare('INSERT INTO admins (username, password) VALUES (?, ?)').run('admin', bcrypt.hashSync('admin123', 10));
  }
  db.save();

  // Auto-save periodically
  setInterval(() => db.save(), 30000);

  return db;
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(session({ secret: 'pubg-recruitment-secret-key', resave: false, saveUninitialized: true }));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => { const a = ['.pdf','.doc','.docx','.png','.jpg','.jpeg']; cb(null, a.includes(path.extname(file.originalname).toLowerCase())); }
});

function requireAdmin(req, res, next) { if (!req.session.adminId) return res.redirect('/login'); next(); }

// Public
app.get('/', (req, res) => res.render('index'));
app.get('/apply', (req, res) => res.render('apply'));
app.get('/staff', (req, res) => res.render('staff'));
app.get('/videos', (req, res) => res.render('videos', { results: null, query: '' }));

app.get('/api/search-videos', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ results: [] });
    const r = await ytSearch(q);
    const results = r.videos.slice(0, 12).map(v => ({
      id: v.videoId, title: v.title, url: v.url,
      thumbnail: v.thumbnail, timestamp: v.timestamp,
      views: v.views, author: v.author.name
    }));
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Public calculator - paste data, get instant leaderboard
app.get('/calculate', (req, res) => res.render('calculator', { result: null, data: '' }));

app.post('/calculate', (req, res) => {
  const lines = req.body.data.split('\n').filter(l => l.trim());
  const teams = {};

  for (const line of lines) {
    // Normalize: remove dots after "kill", fix doubled parens
    let clean = line.replace(/kill\.?\s*\(/i, 'kill (').replace(/\)\(/g, ') (');
    // Extract all (TOP#) and kill (K1-K2-...)
    let tops = [...clean.matchAll(/TOP(\d+)/gi)].map(m => parseInt(m[1]));
    let kills = [...clean.matchAll(/kill\s*\(([\d-]+)\)/ig)];
    let killVals = kills.length > 0 ? kills[0][1].split('-').map(Number) : [];

    if (tops.length === 0) continue;

    // Team name: everything before the first "(TOP"
    let nameMatch = clean.match(/^(.+?)\s+\(TOP/i);
    if (!nameMatch) continue;
    let name = nameMatch[1].trim();
    if (!teams[name]) teams[name] = { totalKills: 0, totalPoints: 0, games: [], bestPlace: 999 };

    for (let i = 0; i < tops.length; i++) {
      let p = tops[i];
      let k = i < killVals.length ? killVals[i] : 0;
      if (p <= 0 || p > 99) continue; // skip invalid placements
      let pts = placementPoints(p) + k;
      teams[name].totalKills += k;
      teams[name].totalPoints += pts;
      teams[name].games.push({ game: i + 1, placement: p, kills: k, points: pts });
      if (p < teams[name].bestPlace) teams[name].bestPlace = p;
    }
  }

  const leaderboard = Object.entries(teams).map(([name, data]) => ({
    name, ...data, games_played: data.games.length
  })).sort((a, b) => b.totalPoints - a.totalPoints || b.totalKills - a.totalKills);

  const totalScore = leaderboard.reduce((sum, t) => sum + t.totalPoints, 0);

  res.render('calculator', { result: { leaderboard, totalScore }, data: req.body.data });
});
app.post('/apply', upload.single('cv'), (req, res) => {
  try {
    const { name, email, phone, ign, pubg_id, role, tier, kd, wins, experience, about } = req.body;
    db.prepare(`INSERT INTO players (name,email,phone,ign,pubg_id,role,tier,kd,wins,experience,about,cv_path) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(name, email, phone, ign, pubg_id, role, tier, kd||null, wins||null, experience, about, req.file ? req.file.filename : null);
    res.render('success');
  } catch { res.status(400).render('apply', { error: 'Email already registered.' }); }
});
app.get('/status', (req, res) => {
  const { email } = req.query;
  if (!email) return res.render('status', { player: null, replies: [] });
  const player = db.prepare('SELECT * FROM players WHERE email = ?').get(email);
  const replies = player ? db.prepare('SELECT * FROM replies WHERE player_id = ? ORDER BY created_at DESC').all(player.id) : [];
  res.render('status', { player, replies });
});

// Auth
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  const a = db.prepare('SELECT * FROM admins WHERE username = ?').get(req.body.username);
  if (a && bcrypt.compareSync(req.body.password, a.password)) {
    req.session.adminId = a.id; req.session.adminName = a.username;
    return res.redirect('/dashboard');
  }
  res.render('login', { error: 'Invalid credentials' });
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// Dashboard (player applications)
app.get('/dashboard', requireAdmin, (req, res) => {
  const s = req.query.status || 'all';
  const players = s === 'all' ? db.prepare('SELECT * FROM players ORDER BY created_at DESC').all()
    : db.prepare('SELECT * FROM players WHERE status = ? ORDER BY created_at DESC').all(s);
  const counts = db.prepare(`SELECT SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending, SUM(CASE WHEN status='reviewed' THEN 1 ELSE 0 END) reviewed, SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) accepted, SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) rejected, COUNT(*) total FROM players`).get();
  res.render('dashboard', { players, counts, currentStatus: s, adminName: req.session.adminName });
});
app.get('/dashboard/player/:id', requireAdmin, (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.redirect('/dashboard');
  const replies = db.prepare('SELECT * FROM replies WHERE player_id = ? ORDER BY created_at DESC').all(player.id);
  res.render('player-detail', { player, replies, adminName: req.session.adminName });
});
app.post('/dashboard/player/:id/status', requireAdmin, (req, res) => {
  db.prepare('UPDATE players SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
  res.redirect('/dashboard/player/' + req.params.id);
});
app.post('/dashboard/player/:id/reply', requireAdmin, (req, res) => {
  db.prepare('INSERT INTO replies (player_id, admin_name, message) VALUES (?,?,?)').run(req.params.id, req.session.adminName, req.body.message);
  db.prepare('UPDATE players SET status = ? WHERE id = ?').run('reviewed', req.params.id);
  res.redirect('/dashboard/player/' + req.params.id);
});

// ========================
// TEAM TOURNAMENT SYSTEM
// ========================

// List tournaments
app.get('/dashboard/tournaments', requireAdmin, (req, res) => {
  const tournaments = db.prepare('SELECT * FROM tournaments ORDER BY created_at DESC').all().map(t => {
    const info = db.prepare(`SELECT COUNT(DISTINCT team_id) teams, COUNT(*) results FROM match_results WHERE tournament_id=?`).get(t.id);
    return { ...t, team_count: info.teams, result_count: info.results };
  });
  res.render('tournaments', { tournaments, adminName: req.session.adminName });
});

// Create tournament
app.post('/dashboard/tournaments/create', requireAdmin, (req, res) => {
  db.prepare('INSERT INTO tournaments (name, game_count) VALUES (?,?)').run(req.body.name, req.body.game_count || 1);
  res.redirect('/dashboard/tournaments');
});

// Single tournament with leaderboard
app.get('/dashboard/tournaments/:id', requireAdmin, (req, res) => {
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id=?').get(req.params.id);
  if (!tournament) return res.redirect('/dashboard/tournaments');
  const teams = db.prepare('SELECT * FROM teams ORDER BY name ASC').all();

  const results = db.prepare(`SELECT mr.*, t.name as team_name FROM match_results mr JOIN teams t ON mr.team_id=t.id WHERE mr.tournament_id=? ORDER BY mr.game_number ASC, mr.placement ASC`).all(req.params.id);

  const leaderboard = db.prepare(`
    SELECT t.id, t.name,
      COUNT(mr.id) games_played,
      COALESCE(SUM(mr.kills),0) total_kills,
      COALESCE(SUM(mr.points),0) total_points,
      COALESCE(AVG(mr.placement),0) avg_placement
    FROM teams t
    JOIN match_results mr ON mr.team_id=t.id
    WHERE mr.tournament_id=?
    GROUP BY t.id
    ORDER BY total_points DESC, total_kills DESC
  `).all(req.params.id);

  const bestP = db.prepare(`SELECT team_id, MIN(placement) best FROM match_results WHERE tournament_id=? GROUP BY team_id`).all(req.params.id);
  const bestMap = {}; bestP.forEach(b => bestMap[b.team_id] = b.best);

  const enriched = leaderboard.map(t => ({ ...t, best_placement: bestMap[t.id] || '-' }));

  res.render('tournament-detail', { tournament, teams, results, leaderboard: enriched, adminName: req.session.adminName });
});

// Add single team result
app.post('/dashboard/tournaments/:id/add-result', requireAdmin, (req, res) => {
  const { team_id, game_number, placement, kills } = req.body;
  const pts = placementPoints(parseInt(placement)) + parseInt(kills || 0);
  db.prepare(`INSERT INTO match_results (tournament_id, team_id, game_number, placement, kills, points) VALUES (?,?,?,?,?,?)`)
    .run(req.params.id, team_id, game_number||1, placement||0, kills||0, pts);
  res.redirect('/dashboard/tournaments/' + req.params.id);
});

// Batch import
app.post('/dashboard/tournaments/:id/batch-results', requireAdmin, (req, res) => {
  const lines = req.body.batch_data.split('\n').filter(l => l.trim());
  const insertResult = db.prepare(`INSERT INTO match_results (tournament_id, team_id, game_number, placement, kills, points) VALUES (?,?,?,?,?,?)`);
  const findTeam = db.prepare('SELECT id FROM teams WHERE LOWER(name)=?');
  const createTeam = db.prepare('INSERT INTO teams (name) VALUES (?)');

  const getTeam = (name) => {
    let t = findTeam.get(name.toLowerCase());
    if (!t) { createTeam.run(name); t = findTeam.get(name.toLowerCase()); }
    return t;
  };

  const txn = db.transaction((lines) => {
    for (const line of lines) {
      if (!line.trim()) continue;
      let clean = line.replace(/kill\.?\s*\(/i, 'kill (').replace(/\)\(/g, ') (');
      let tops = [...clean.matchAll(/TOP(\d+)/gi)].map(m => parseInt(m[1]));
      let kills = [...clean.matchAll(/kill\s*\(([\d-]+)\)/ig)];
      let killVals = kills.length > 0 ? kills[0][1].split('-').map(Number) : [];
      if (tops.length === 0) continue;
      let nameMatch = clean.match(/^(.+?)\s+\(TOP/i);
      if (!nameMatch) continue;
      const team = getTeam(nameMatch[1].trim());
      for (let i = 0; i < tops.length; i++) {
        let p = tops[i];
        let k = i < killVals.length ? killVals[i] : 0;
        if (p <= 0 || p > 99) continue;
        insertResult.run(req.params.id, team.id, i + 1, p, k, placementPoints(p) + k);
      }
    }
  });

  txn(lines);
  res.redirect('/dashboard/tournaments/' + req.params.id);
});

// Delete result
app.post('/dashboard/tournaments/:tid/delete-result/:rid', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM match_results WHERE id=?').run(req.params.rid);
  res.redirect('/dashboard/tournaments/' + req.params.tid);
});

// Finish tournament
app.post('/dashboard/tournaments/:id/finish', requireAdmin, (req, res) => {
  db.prepare('UPDATE tournaments SET status=? WHERE id=?').run('finished', req.params.id);
  res.redirect('/dashboard/tournaments');
});

// Public leaderboard
app.get('/leaderboard/:id', (req, res) => {
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id=?').get(req.params.id);
  if (!tournament) return res.status(404).send('Tournament not found');
  const teams = db.prepare(`
    SELECT t.id, t.name, COUNT(mr.id) games_played, COALESCE(SUM(mr.kills),0) total_kills,
      COALESCE(SUM(mr.points),0) total_points
    FROM teams t JOIN match_results mr ON mr.team_id=t.id
    WHERE mr.tournament_id=? GROUP BY t.id ORDER BY total_points DESC, total_kills DESC
  `).all(req.params.id);
  const bestP = db.prepare(`SELECT team_id, MIN(placement) best FROM match_results WHERE tournament_id=? GROUP BY team_id`).all(req.params.id);
  const bm = {}; bestP.forEach(b => bm[b.team_id] = b.best);
  const allResults = db.prepare(`SELECT mr.*, t.name as team_name FROM match_results mr JOIN teams t ON mr.team_id=t.id WHERE mr.tournament_id=? ORDER BY mr.team_id, mr.game_number`).all(req.params.id);
  const resultsByTeam = {};
  allResults.forEach(r => {
    if (!resultsByTeam[r.team_id]) resultsByTeam[r.team_id] = [];
    resultsByTeam[r.team_id].push({ game: r.game_number, placement: r.placement, kills: r.kills, points: r.points });
  });
  const enriched = teams.map(t => ({
    name: t.name,
    total_kills: t.total_kills,
    total_points: t.total_points,
    games_played: t.games_played,
    best_placement: bm[t.id] || '-',
    games: resultsByTeam[t.id] || []
  }));
  res.render('public-leaderboard', { tournament, leaderboard: enriched });
});

initDb().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });
