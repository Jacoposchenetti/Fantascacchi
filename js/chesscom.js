/* ---------------------------------------------------------------
   Client per le API pubbliche di chess.com.

   Due cose imparate dai dati veri, che spiegano il codice qui sotto:

   1. Gli ID dei Titled Tuesday finiscono con un numero opaco
      (titled-tuesday-blitz-august-25-2026-31064127), quindi NON si
      possono costruire da una data: vanno scoperti dalla lista tornei
      di giocatori che partecipano quasi sempre.

   2. La classifica finale sta nel gruppo dell'ULTIMO turno
      (/tournament/{id}/{ultimoTurno}/1): i `points` li' dentro sono
      cumulativi di fine torneo. Una sola chiamata basta per tutti.
      Chi si ritira prima non compare: per quelli si ripiega su
      /player/{user}/tournaments, che ha placement e wins/draws/losses.
   --------------------------------------------------------------- */

const API = "https://api.chess.com/pub";

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const TT_RE = /^titled-tuesday-(?:blitz-)?([a-z]+)-(\d{1,2})-(\d{4})-(\d+)$/;

// Giocatori usati solo per scoprire gli ID: partecipano quasi sempre.
const ANCHORS = ["hikaru", "polish_fighter3000", "ghandeevam2003", "nikotheodorou"];

const cache = new Map();

async function get(path, { ttl = 6 * 60 * 60 * 1000 } = {}) {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.data;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`chess.com ${res.status} su ${path}`);
  const data = await res.json();
  cache.set(url, { at: Date.now(), data });
  return data;
}

export function parseTitledTuesdayId(id) {
  const m = TT_RE.exec(id);
  if (!m) return null;
  const [, month, day, year] = m;
  if (!(month in MONTHS)) return null;
  const iso = `${year}-${String(MONTHS[month]).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { id, date: iso, label: prettyLabel(iso) };
}

function prettyLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const nomi = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  return `${d} ${nomi[m - 1]} ${y}`;
}

/**
 * Ultimi Titled Tuesday disponibili, dal piu' recente.
 * @returns {Promise<Array<{id,date,label}>>}
 */
export async function discoverTitledTuesdays(limit = 12) {
  const found = new Map();
  for (const anchor of ANCHORS) {
    let data;
    try { data = await get(`/player/${anchor}/tournaments`, { ttl: 30 * 60 * 1000 }); }
    catch { continue; }
    for (const t of data?.finished || []) {
      const id = String(t["@id"] || "").split("/").pop();
      const parsed = parseTitledTuesdayId(id);
      if (parsed) found.set(id, parsed);
    }
    if (found.size >= limit * 3) break;
  }
  if (!found.size) throw new Error("Nessun Titled Tuesday trovato. API di chess.com irraggiungibile?");
  return [...found.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

/**
 * Classifica finale di un torneo.
 * @returns {Promise<{tournamentId, name, total, standings: Map<string,{points,rank}>}>}
 */
export async function fetchStandings(tournamentId, onProgress = () => {}) {
  onProgress("Leggo il torneo…");
  const root = await get(`/tournament/${tournamentId}`);
  if (!root) throw new Error("Torneo non trovato su chess.com");

  const nRounds = root.rounds?.length || root.settings?.total_rounds || 11;

  let players = null;
  for (let r = nRounds; r >= 1 && !players; r--) {
    onProgress(`Scarico la classifica (turno ${r})…`);
    let grp;
    try { grp = await get(`/tournament/${tournamentId}/${r}/1`); }
    catch { continue; }
    if (grp?.players?.length) players = grp.players;
  }
  if (!players) throw new Error("Classifica non disponibile per questo torneo");

  const rows = players
    .map((p) => ({ user: String(p.username || "").toLowerCase(), points: Number(p.points) || 0 }))
    .filter((p) => p.user)
    .sort((a, b) => b.points - a.points);

  // Pari merito standard: 1, 2, 2, 4
  const standings = new Map();
  let rank = 0, prev = null;
  rows.forEach((row, i) => {
    if (row.points !== prev) { rank = i + 1; prev = row.points; }
    standings.set(row.user, { points: row.points, rank });
  });

  return {
    tournamentId,
    name: root.name || tournamentId,
    finishTime: root.finish_time || null,
    total: root.settings?.registered_user_count || rows.length,
    standings,
  };
}

/**
 * Ripiego per chi non compare nella classifica finale (ritirato a meta').
 * Costa una chiamata per giocatore, quindi si usa solo sui pochi mancanti.
 */
export async function fetchPlayerResult(username, tournamentId) {
  let data;
  try { data = await get(`/player/${username}/tournaments`, { ttl: 30 * 60 * 1000 }); }
  catch { return null; }
  const row = (data?.finished || []).find(
    (t) => String(t["@id"] || "").split("/").pop() === tournamentId
  );
  if (!row) return null;
  return {
    points: (Number(row.wins) || 0) + (Number(row.draws) || 0) * 0.5,
    rank: Number(row.placement) || null,
    total: Number(row.total_players) || null,
    withdrew: row.status === "withdrew",
  };
}

/**
 * Statistiche live per formato, per la scheda giocatore.
 *
 * chess.com NON espone lo storico dei rating: da qui si ottiene solo la foto
 * di adesso (piu' il record e il massimo storico). La curva nel tempo la
 * ricostruiamo altrove, dai rating letti nelle partite dei Titled Tuesday.
 */
export async function fetchStats(username) {
  const u = String(username).toLowerCase();
  const [prof, stats] = await Promise.all([
    get(`/player/${u}`, { ttl: 24 * 60 * 60 * 1000 }),
    get(`/player/${u}/stats`, { ttl: 30 * 60 * 1000 }),
  ]);

  const fmt = (key) => {
    const s = stats?.[key];
    if (!s?.last?.rating) return null;
    const rec = s.record || {};
    const played = (rec.win || 0) + (rec.loss || 0) + (rec.draw || 0);
    return {
      rating: s.last.rating,
      best: s.best?.rating || null,
      win: rec.win || 0,
      loss: rec.loss || 0,
      draw: rec.draw || 0,
      played,
      winRate: played ? Math.round(((rec.win || 0) / played) * 100) : null,
    };
  };

  return {
    username: prof?.username || u,
    url: prof?.url || `https://www.chess.com/member/${u}`,
    joined: prof?.joined || null,
    lastOnline: prof?.last_online || null,
    followers: prof?.followers || null,
    fide: stats?.fide || null,
    formats: {
      bullet: fmt("chess_bullet"),
      blitz: fmt("chess_blitz"),
      rapid: fmt("chess_rapid"),
      daily: fmt("chess_daily"),
    },
    tactics: stats?.tactics?.highest?.rating || null,
  };
}

/** Profilo pubblico, usato quando si aggiunge un giocatore fuori listone. */
export async function fetchProfile(username) {
  const u = String(username).trim().toLowerCase().replace(/^@/, "");
  if (!/^[\w-]{3,25}$/.test(u)) throw new Error("Username non valido");
  const [prof, stats] = await Promise.all([
    get(`/player/${u}`, { ttl: 24 * 60 * 60 * 1000 }),
    get(`/player/${u}/stats`, { ttl: 60 * 60 * 1000 }).catch(() => null),
  ]);
  if (!prof) throw new Error(`Nessun giocatore chess.com con username "${u}"`);
  return {
    id: u,
    username: prof.username || u,
    name: prof.name || prof.username || u,
    title: prof.title || "",
    country: String(prof.country || "").split("/").pop(),
    avatar: prof.avatar || "",
    rating: stats?.chess_blitz?.last?.rating || 2400,
  };
}
