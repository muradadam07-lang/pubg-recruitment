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

let db;
function prepareDb(sqlDb) {
  function Statement(sql) { this.sql = sql; }
  Statement.prototype = {
    get() {
      let p = arguments.length === 0 ? [] : (arguments.length === 1 ? arguments[0] : Array.from(arguments));
      if (!Array.isArray(p)) p = [p];
      try { const s = sqlDb.prepare(this.sql); if (p.length) s.bind(p); const h = s.step(); const r = h ? s.getAsObject() : undefined; s.free(); return r; } catch(e) { return undefined; }
    },
    all() {
      let p = arguments.length === 0 ? [] : (arguments.length === 1 ? arguments[0] : Array.from(arguments));
      if (!Array.isArray(p)) p = [p];
      try { const s = sqlDb.prepare(this.sql); if (p.length) s.bind(p); const r = []; while (s.step()) r.push(s.getAsObject()); s.free(); return r; } catch(e) { return []; }
    },
    run() {
      let p = arguments.length === 0 ? [] : (arguments.length === 1 ? arguments[0] : Array.from(arguments));
      if (!Array.isArray(p)) p = [p];
      try { sqlDb.run(this.sql, p); const r = { changes: sqlDb.getRowsModified(), lastInsertRowid: sqlDb.exec("SELECT last_insert_rowid()")[0]?.values[0][0] }; db.save(); return r; } catch(e) { throw e; }
    }
  };
  return { prepare: (s) => new Statement(s), exec: (s) => { try { return sqlDb.run(s); } catch(e) { throw e; } }, transaction: (fn) => (...a) => { sqlDb.run("BEGIN"); try { const r = fn(...a); sqlDb.run("COMMIT"); return r; } catch(e) { sqlDb.run("ROLLBACK"); throw e; } }, save: () => { try { fs.writeFileSync(DB_PATH, Buffer.from(sqlDb.export())); } catch(e) {} } };
}

function placementPoints(pos) {
  if (pos <= 0) return 0;
  if (pos === 1) return 10; if (pos === 2) return 6; if (pos === 3) return 5;
  if (pos === 4) return 4; if (pos === 5) return 3; if (pos === 6) return 2;
  if (pos === 7) return 1; if (pos === 8) return 1; return 0;
}

async function initDb() {
  const SQL = await initSqlJs();
  let buf; try { buf = fs.readFileSync(DB_PATH); } catch(e) {}
  const s = new SQL.Database(buf);
  s.run(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,phone TEXT NOT NULL,ign TEXT NOT NULL,pubg_id TEXT NOT NULL,role TEXT NOT NULL,tier TEXT NOT NULL,kd REAL,wins INTEGER,experience TEXT,about TEXT,cv_path TEXT,status TEXT DEFAULT 'pending',created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  s.run(`CREATE TABLE IF NOT EXISTS replies (id INTEGER PRIMARY KEY AUTOINCREMENT,player_id INTEGER NOT NULL,admin_name TEXT NOT NULL,message TEXT NOT NULL,status TEXT DEFAULT 'pending',created_at DATETIME DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(player_id) REFERENCES players(id))`);
  s.run(`CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL)`);
  s.run(`CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE NOT NULL,created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  s.run(`CREATE TABLE IF NOT EXISTS tournaments (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,game_count INTEGER DEFAULT 1,status TEXT DEFAULT 'active',created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  s.run(`CREATE TABLE IF NOT EXISTS match_results (id INTEGER PRIMARY KEY AUTOINCREMENT,tournament_id INTEGER NOT NULL,team_id INTEGER NOT NULL,game_number INTEGER DEFAULT 1,placement INTEGER DEFAULT 0,kills INTEGER DEFAULT 0,points INTEGER DEFAULT 0,created_at DATETIME DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(tournament_id) REFERENCES tournaments(id),FOREIGN KEY(team_id) REFERENCES teams(id))`);
  try { const c = s.exec("PRAGMA table_info(match_results)"); const n = c[0]?.values.map(v => v[1]) || []; if (n.includes('player_id') && !n.includes('team_id')) { s.run("DROP TABLE IF EXISTS match_results"); s.run(`CREATE TABLE match_results (id INTEGER PRIMARY KEY AUTOINCREMENT,tournament_id INTEGER NOT NULL,team_id INTEGER NOT NULL,game_number INTEGER DEFAULT 1,placement INTEGER DEFAULT 0,kills INTEGER DEFAULT 0,points INTEGER DEFAULT 0,created_at DATETIME DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(tournament_id) REFERENCES tournaments(id),FOREIGN KEY(team_id) REFERENCES teams(id))`); } } catch(e) {}
  try { s.run("DROP TABLE IF EXISTS results"); } catch(e) {}
  db = prepareDb(s);
  const a = db.prepare('SELECT COUNT(*) as count FROM admins').get();
  if (a && a.count === 0) db.prepare('INSERT INTO admins (username, password) VALUES (?, ?)').run('admin', bcrypt.hashSync('admin123', 10));
  db.save();
  setInterval(() => db.save(), 30000);
  return db;
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(session({ secret: 'pubg-recruitment-secret-key', resave: false, saveUninitialized: true }));

const storage = multer.diskStorage({ destination: (r,f,c) => c(null, path.join(__dirname, 'uploads')), filename: (r,f,c) => c(null, Date.now()+'-'+Math.round(Math.random()*1E9)+path.extname(f.originalname)) });
const upload = multer({ storage, limits: { fileSize: 5*1024*1024 }, fileFilter: (r,f,c) => { const a=['.pdf','.doc','.docx','.png','.jpg','.jpeg']; c(null, a.includes(path.extname(f.originalname).toLowerCase())); } });

function requireAdmin(req, res, next) { if (!req.session.adminId) return res.status(401).json({ error: 'Unauthorized' }); next(); }
function adminName(req) { return req.session.adminName || 'Admin'; }

// ========== API ROUTES ==========

// Auth
app.post('/api/login', (req, res) => {
  const a = db.prepare('SELECT * FROM admins WHERE username = ?').get(req.body.username);
  if (a && bcrypt.compareSync(req.body.password, a.password)) {
    req.session.adminId = a.id; req.session.adminName = a.username;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.get('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/session', (req, res) => res.json({ loggedIn: !!req.session.adminId, name: req.session.adminName || null }));

// Apply
app.post('/api/apply', upload.single('cv'), (req, res) => {
  try {
    const { name, email, phone, ign, pubg_id, role, tier, kd, wins, experience, about } = req.body;
    db.prepare('INSERT INTO players (name,email,phone,ign,pubg_id,role,tier,kd,wins,experience,about,cv_path) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(name, email, phone, ign, pubg_id, role, tier, kd||null, wins||null, experience, about, req.file ? req.file.filename : null);
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: 'Email already registered.' }); }
});

// Status check
app.get('/api/status', (req, res) => {
  const { email } = req.query;
  if (!email) return res.json({ player: null, replies: [] });
  const player = db.prepare('SELECT * FROM players WHERE email = ?').get(email);
  const replies = player ? db.prepare('SELECT * FROM replies WHERE player_id = ? ORDER BY created_at DESC').all(player.id) : [];
  res.json({ player, replies });
});

// Calculator
app.post('/api/calculate', (req, res) => {
  const lines = (req.body.data || '').split('\n').filter(l => l.trim());
  const teams = {};
  for (const line of lines) {
    let clean = line.replace(/kill\.?\s*\(/i, 'kill (').replace(/\)\(/g, ') (');
    let tops = [...clean.matchAll(/TOP(\d+)/gi)].map(m => parseInt(m[1]));
    let kills = [...clean.matchAll(/kill\s*\(([\d-]+)\)/ig)];
    let killVals = kills.length > 0 ? kills[0][1].split('-').map(Number) : [];
    if (tops.length === 0) continue;
    let nameMatch = clean.match(/^(.+?)\s+\(TOP/i);
    if (!nameMatch) continue;
    let name = nameMatch[1].trim();
    if (!teams[name]) teams[name] = { totalKills: 0, totalPoints: 0, games: [], bestPlace: 999 };
    for (let i = 0; i < tops.length; i++) {
      let p = tops[i], k = i < killVals.length ? killVals[i] : 0;
      if (p <= 0 || p > 99) continue;
      let pts = placementPoints(p) + k;
      teams[name].totalKills += k; teams[name].totalPoints += pts;
      teams[name].games.push({ game: i+1, placement: p, kills: k, points: pts });
      if (p < teams[name].bestPlace) teams[name].bestPlace = p;
    }
  }
  const leaderboard = Object.entries(teams).map(([n,d]) => ({ name: n, ...d, games_played: d.games.length })).sort((a,b) => b.totalPoints - a.totalPoints || b.totalKills - a.totalKills);
  res.json({ leaderboard, totalScore: leaderboard.reduce((s,t) => s + t.totalPoints, 0) });
});

// YouTube search
app.get('/api/search-videos', async (req, res) => {
  try {
    if (!req.query.q) return res.json({ results: [] });
    const r = await ytSearch(req.query.q);
    res.json({ results: r.videos.slice(0,12).map(v => ({ id: v.videoId, title: v.title, url: v.url, thumbnail: v.thumbnail, timestamp: v.timestamp, views: v.views, author: v.author.name })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Dashboard - players
app.get('/api/players', requireAdmin, (req, res) => {
  const s = req.query.status || 'all';
  const players = s === 'all' ? db.prepare('SELECT * FROM players ORDER BY created_at DESC').all() : db.prepare('SELECT * FROM players WHERE status = ? ORDER BY created_at DESC').all(s);
  const counts = db.prepare("SELECT SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending, SUM(CASE WHEN status='reviewed' THEN 1 ELSE 0 END) reviewed, SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) accepted, SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) rejected, COUNT(*) total FROM players").get();
  res.json({ players, counts, currentStatus: s, adminName: adminName(req) });
});

app.get('/api/players/:id', requireAdmin, (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Not found' });
  const replies = db.prepare('SELECT * FROM replies WHERE player_id = ? ORDER BY created_at DESC').all(player.id);
  res.json({ player, replies, adminName: adminName(req) });
});

app.post('/api/players/:id/status', requireAdmin, (req, res) => {
  db.prepare('UPDATE players SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
  res.json({ success: true });
});

app.post('/api/players/:id/reply', requireAdmin, (req, res) => {
  db.prepare('INSERT INTO replies (player_id, admin_name, message) VALUES (?,?,?)').run(req.params.id, adminName(req), req.body.message);
  db.prepare('UPDATE players SET status = ? WHERE id = ?').run('reviewed', req.params.id);
  res.json({ success: true });
});

// Tournaments
app.get('/api/tournaments', requireAdmin, (req, res) => {
  const tournaments = db.prepare('SELECT * FROM tournaments ORDER BY created_at DESC').all().map(t => {
    const info = db.prepare('SELECT COUNT(DISTINCT team_id) teams, COUNT(*) results FROM match_results WHERE tournament_id=?').get(t.id);
    return { ...t, team_count: (info && info.teams) || 0, result_count: (info && info.results) || 0 };
  });
  res.json({ tournaments, adminName: adminName(req) });
});

app.post('/api/tournaments', requireAdmin, (req, res) => {
  db.prepare('INSERT INTO tournaments (name, game_count) VALUES (?,?)').run(req.body.name, req.body.game_count || 1);
  res.json({ success: true });
});

app.get('/api/tournaments/:id', requireAdmin, (req, res) => {
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id=?').get(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Not found' });
  const teams = db.prepare('SELECT * FROM teams ORDER BY name ASC').all();
  const results = db.prepare('SELECT mr.*, t.name as team_name FROM match_results mr JOIN teams t ON mr.team_id=t.id WHERE mr.tournament_id=? ORDER BY mr.game_number ASC, mr.placement ASC').all(req.params.id);
  const leaderboard = db.prepare('SELECT t.id, t.name, COUNT(mr.id) games_played, COALESCE(SUM(mr.kills),0) total_kills, COALESCE(SUM(mr.points),0) total_points, COALESCE(AVG(mr.placement),0) avg_placement FROM teams t JOIN match_results mr ON mr.team_id=t.id WHERE mr.tournament_id=? GROUP BY t.id ORDER BY total_points DESC, total_kills DESC').all(req.params.id);
  const bestP = db.prepare('SELECT team_id, MIN(placement) best FROM match_results WHERE tournament_id=? GROUP BY team_id').all(req.params.id);
  const bm = {}; bestP.forEach(b => bm[b.team_id] = b.best);
  res.json({ tournament, teams, results, leaderboard: leaderboard.map(t => ({ ...t, best_placement: bm[t.id] || '-' })), adminName: adminName(req) });
});

app.post('/api/tournaments/:id/add-result', requireAdmin, (req, res) => {
  const pts = placementPoints(parseInt(req.body.placement)) + parseInt(req.body.kills || 0);
  db.prepare('INSERT INTO match_results (tournament_id, team_id, game_number, placement, kills, points) VALUES (?,?,?,?,?,?)').run(req.params.id, req.body.team_id, req.body.game_number||1, req.body.placement||0, req.body.kills||0, pts);
  res.json({ success: true });
});

app.post('/api/tournaments/:id/batch', requireAdmin, (req, res) => {
  const lines = (req.body.batch_data || '').split('\n').filter(l => l.trim());
  const ins = db.prepare('INSERT INTO match_results (tournament_id, team_id, game_number, placement, kills, points) VALUES (?,?,?,?,?,?)');
  const find = db.prepare('SELECT id FROM teams WHERE LOWER(name)=?');
  const cre = db.prepare('INSERT INTO teams (name) VALUES (?)');
  const getTeam = (n) => { let t = find.get(n.toLowerCase()); if (!t) { cre.run(n); t = find.get(n.toLowerCase()); } return t; };
  db.transaction((ls) => {
    for (const line of ls) {
      if (!line.trim()) continue;
      let clean = line.replace(/kill\.?\s*\(/i, 'kill (').replace(/\)\(/g, ') (');
      let tops = [...clean.matchAll(/TOP(\d+)/gi)].map(m => parseInt(m[1]));
      let kills = [...clean.matchAll(/kill\s*\(([\d-]+)\)/ig)];
      let kv = kills.length > 0 ? kills[0][1].split('-').map(Number) : [];
      if (tops.length === 0) continue;
      let nm = clean.match(/^(.+?)\s+\(TOP/i); if (!nm) continue;
      const team = getTeam(nm[1].trim());
      for (let i = 0; i < tops.length; i++) { let p = tops[i], k = i < kv.length ? kv[i] : 0; if (p <= 0 || p > 99) continue; ins.run(req.params.id, team.id, i+1, p, k, placementPoints(p)+k); }
    }
  })(lines);
  res.json({ success: true });
});

app.post('/api/results/:id/delete', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM match_results WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/tournaments/:id/finish', requireAdmin, (req, res) => {
  db.prepare('UPDATE tournaments SET status=? WHERE id=?').run('finished', req.params.id);
  res.json({ success: true });
});

// Public leaderboard
app.get('/api/leaderboard/:id', (req, res) => {
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id=?').get(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Not found' });
  const teams = db.prepare('SELECT t.id, t.name, COUNT(mr.id) games_played, COALESCE(SUM(mr.kills),0) total_kills, COALESCE(SUM(mr.points),0) total_points FROM teams t JOIN match_results mr ON mr.team_id=t.id WHERE mr.tournament_id=? GROUP BY t.id ORDER BY total_points DESC, total_kills DESC').all(req.params.id);
  const bestP = db.prepare('SELECT team_id, MIN(placement) best FROM match_results WHERE tournament_id=? GROUP BY team_id').all(req.params.id);
  const bm = {}; bestP.forEach(b => bm[b.team_id] = b.best);
  const allResults = db.prepare('SELECT mr.*, t.name as team_name FROM match_results mr JOIN teams t ON mr.team_id=t.id WHERE mr.tournament_id=? ORDER BY mr.team_id, mr.game_number').all(req.params.id);
  const rbt = {}; allResults.forEach(r => { if (!rbt[r.team_id]) rbt[r.team_id] = []; rbt[r.team_id].push({ game: r.game_number, placement: r.placement, kills: r.kills, points: r.points }); });
  res.json({ tournament, leaderboard: teams.map(t => ({ name: t.name, total_kills: t.total_kills, total_points: t.total_points, games_played: t.games_played, best_placement: bm[t.id] || '-', games: rbt[t.id] || [] })) });
});

// ========== PAGE ROUTES (serve HTML) ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/apply', (req, res) => res.sendFile(path.join(__dirname, 'public', 'apply.html')));
app.get('/status', (req, res) => res.sendFile(path.join(__dirname, 'public', 'status.html')));
app.get('/calculate', (req, res) => res.sendFile(path.join(__dirname, 'public', 'calculator.html')));
app.get('/staff', (req, res) => res.sendFile(path.join(__dirname, 'public', 'staff.html')));
app.get('/videos', (req, res) => res.sendFile(path.join(__dirname, 'public', 'videos.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/success', (req, res) => res.sendFile(path.join(__dirname, 'public', 'success.html')));
app.get('/dashboard', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/dashboard/player/:id', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'player-detail.html')));
app.get('/dashboard/tournaments', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'tournaments.html')));
app.get('/dashboard/tournaments/:id', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'tournament-detail.html')));
app.get('/leaderboard/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'public-leaderboard.html')));
app.get('/admin-check', (req, res) => { if (!req.session.adminId) return res.redirect('/login'); res.redirect('/dashboard'); });

initDb().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });