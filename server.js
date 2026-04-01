// server.js
// API + persistência (SQLite) + atualização a partir do Dependency.json remoto
// Requisitos: npm i express axios sqlite3

const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// --- DB (SQLite no arquivo apps.db) ---
const db = new sqlite3.Database('./apps.db');

// Helpers promisificados
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, function (err, rows) {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// --- Criação do schema, se não existir ---
async function ensureSchema() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS available_apps (
      app_name TEXT PRIMARY KEY,
      repoName TEXT,
      version TEXT,
      description TEXT,
      gitUrl TEXT
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS available_apps_dependency (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      component_id TEXT,   -- ex: tax4b.icms-js (o dependente)
      parent_id TEXT,      -- ex: app que depende dele
      version TEXT,
      type TEXT,
      resourceName TEXT
    )
  `);

  await dbRun(`CREATE INDEX IF NOT EXISTS idx_dep_component ON available_apps_dependency (component_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_dep_parent ON available_apps_dependency (parent_id)`);
}
ensureSchema().catch(console.error);

// --- Rota: baixa JSON e atualiza as tabelas ---
app.get('/api/update-apps', async (req, res) => {
  try {
    const { data } = await axios.get(
      'https://onesource4sap-repository.thomsonreuters.com/content/raw/release/Dependency.json',
      { timeout: 30_000 }
    );

    const availableApps = Array.isArray(data?.components) ? data.components : [];

    for (let index = 0; index < availableApps.length; index++) {
      const appRec = availableApps[index];

      // Limpa dados antigos desse app (pela chave app.id)
      await dbRun("DELETE FROM available_apps WHERE app_name = ?", [appRec.id]);
      await dbRun("DELETE FROM available_apps_dependency WHERE parent_id = ?", [appRec.id]);

      // Insere o app (registro 'topo')
      await dbRun(
        "INSERT INTO available_apps (app_name, repoName, version, description, gitUrl) VALUES (?,?,?,?,?)",
        [appRec.id, appRec.repoName || null, appRec.version || null, appRec.description || null, appRec.gitUrl || null]
      );

      // Dependências tax4b.*
      const requires = Array.isArray(appRec.requires) ? appRec.requires : [];
      const onlyTax4b = requires.filter(q => typeof q.id === 'string' && q.id.startsWith('tax4b.'));
      for (let r = 0; r < onlyTax4b.length; r++) {
        const dep = onlyTax4b[r];
        await dbRun(
          "INSERT INTO available_apps_dependency (component_id, parent_id, version, type, resourceName) VALUES (?,?,?,?,?)",
          [dep.id, appRec.id, dep.version || null, dep.type || null, dep.resourceName || null]
        );
      }
    }

    res.json({ ok: true, updated: availableApps.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// --- API: lista todos os objetos conhecidos (IDs) ---
// Une nomes do topo e nomes que aparecem como dependência
app.get('/api/apps', async (req, res) => {
  try {
    const rowsTop = await dbAll(`SELECT app_name AS id FROM available_apps`);
    const rowsDeps = await dbAll(`SELECT DISTINCT component_id AS id FROM available_apps_dependency`);
    const set = new Set();
    rowsTop.forEach(r => r.id && set.add(r.id));
    rowsDeps.forEach(r => r.id && set.add(r.id));
    const list = Array.from(set).sort((a,b) => a.localeCompare(b));
    res.json({ items: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// --- API: versões por objeto (combina topo + versões como dependência) ---
app.get('/api/versions/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const top = await dbAll(
      `SELECT version FROM available_apps WHERE app_name = ? AND version IS NOT NULL`,
      [id]
    );
    const deps = await dbAll(
      `SELECT DISTINCT version FROM available_apps_dependency WHERE component_id = ? AND version IS NOT NULL`,
      [id]
    );

    const versions = new Set();
    top.forEach(r => versions.add(r.version));
    deps.forEach(r => versions.add(r.version));

    const out = Array.from(versions)
      .filter(Boolean)
      .sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));

    res.json({ id, versions: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// --- UI estática: index.html ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Sobe o servidor ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`> API rodando em http://localhost:${PORT}`));
