/* Vocab Arena – Englisch-Vokabeltrainer */
(() => {
  'use strict';

  // ---------- Speicher ----------
  const KEY = 'vocabArena_v1';
  const DEFAULT = {
    name: 'Paul', xp: 0, trophies: 0,
    streak: { count: 0, last: null }, bestCombo: 0,
    boxes: {},          // vocabId -> { box, right, wrong, last }
    learned: {},        // vocabId -> { de: [...], en: [...] } selbst als richtig markierte Antworten
    tests: [],          // gespeicherte Tests
    badges: [],         // freigeschaltete Abzeichen-IDs
    settings: { sound: true, autoSpeak: true, unit: null, dir: 'en-de', mode: 'type', count: 10, hardOnly: false }
  };
  let S = load();
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (raw) return Object.assign({}, DEFAULT, raw, { settings: Object.assign({}, DEFAULT.settings, raw.settings) });
    } catch (e) { /* ignore */ }
    return JSON.parse(JSON.stringify(DEFAULT));
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(S)); }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ---------- Vokabeln ----------
  const VOCAB = (window.VOCAB || []).map(v => Object.assign({}, v, { id: v.unit + '|' + v.en }));
  const BY_ID = Object.fromEntries(VOCAB.map(v => [v.id, v]));
  const UNITS = [...new Set(VOCAB.map(v => v.unit))].sort((a, b) => {
    if (a === 'Demo') return 1; if (b === 'Demo') return -1;
    return a.localeCompare(b, 'de', { numeric: true });
  });
  const unitWords = u => VOCAB.filter(v => v.unit === u);
  const boxOf = id => (S.boxes[id] ? S.boxes[id].box : 0);
  const unitMastery = u => {
    const w = unitWords(u); if (!w.length) return 0;
    return Math.round(w.reduce((s, v) => s + Math.min(boxOf(v.id), 5), 0) / (w.length * 5) * 100);
  };
  const isHard = id => { const b = S.boxes[id]; return b && b.wrong > 0 && b.box <= 2; };

  // ---------- Helfer ----------
  const $app = document.getElementById('app');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const fmtDate = ts => new Date(ts).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const today = () => new Date().toISOString().slice(0, 10);
  const DIRS = { 'en-de': 'Englisch → Deutsch', 'de-en': 'Deutsch → Englisch' };
  const MODES = { type: 'Schreiben', mc: 'Auswahl', gap: 'Lückentext', mix: 'Mix' };

  function toast(msg, ms = 2200) {
    const t = document.getElementById('toast');
    t.innerHTML = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
  }
  function confetti(n = 80) {
    const colors = ['#facc15', '#22c55e', '#38bdf8', '#ef4444', '#a855f7', '#fb923c'];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = 1.5 + Math.random() * 2 + 's';
      c.style.animationDelay = Math.random() * .5 + 's';
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 4500);
    }
  }

  // ---------- Sound ----------
  let actx = null;
  function beep(type) {
    if (!S.settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const seq = { right: [[660, .08], [880, .12]], almost: [[660, .1], [740, .12]], wrong: [[220, .18], [180, .2]], win: [[523, .1], [659, .1], [784, .1], [1047, .25]], tap: [[500, .04]] }[type] || [];
      let t = actx.currentTime;
      seq.forEach(([f, d]) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type === 'wrong' ? 'sawtooth' : 'square';
        o.frequency.value = f; g.gain.setValueAtTime(.08, t); g.gain.exponentialRampToValueAtTime(.001, t + d);
        o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d); t += d;
      });
    } catch (e) { /* ignore */ }
  }
  let enVoice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices();
    enVoice = vs.find(v => v.lang === 'en-GB') || vs.find(v => v.lang && v.lang.startsWith('en')) || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/\(|\)/g, ''));
    u.lang = 'en-GB'; if (enVoice) u.voice = enVoice; u.rate = .9;
    speechSynthesis.speak(u);
  }

  // ---------- Fortschritt / Ränge ----------
  const RANKS = [
    [0, 'Bronze', '🥉'], [100, 'Silber', '🥈'], [300, 'Gold', '🥇'], [600, 'Diamant', '💎'],
    [1000, 'Mythisch', '🔮'], [1600, 'Legendär', '👑'], [2500, 'Meister', '🏆'], [4000, 'Vocab-Champion', '🐉']
  ];
  function rankInfo(t) {
    let i = 0; while (i + 1 < RANKS.length && t >= RANKS[i + 1][0]) i++;
    const cur = RANKS[i], next = RANKS[i + 1];
    return { name: cur[1], icon: cur[2], next, pct: next ? Math.round((t - cur[0]) / (next[0] - cur[0]) * 100) : 100 };
  }
  function levelInfo(xp) {
    let lvl = 1, need = 100, rest = xp;
    while (rest >= need) { rest -= need; lvl++; need = 100 + (lvl - 1) * 50; }
    return { lvl, rest, need, pct: Math.round(rest / need * 100) };
  }

  const BADGES = [
    { id: 'first', ico: '🎮', name: 'Erstes Match', desc: 'Ersten Test gemacht', ok: s => s.tests.length >= 1 },
    { id: 'perfect', ico: '💯', name: 'Perfekt!', desc: 'Test mit 100 %', ok: s => s.tests.some(t => t.total >= 5 && t.correct === t.total) },
    { id: 'ten', ico: '🔟', name: 'Dauerzocker', desc: '10 Tests gemacht', ok: s => s.tests.length >= 10 },
    { id: 'fifty', ico: '🏟️', name: 'Arena-Profi', desc: '50 Tests gemacht', ok: s => s.tests.length >= 50 },
    { id: 'combo5', ico: '🔥', name: 'Combo x5', desc: '5 richtig in Folge', ok: s => s.bestCombo >= 5 },
    { id: 'combo15', ico: '⚡', name: 'Combo x15', desc: '15 richtig in Folge', ok: s => s.bestCombo >= 15 },
    { id: 'streak3', ico: '📅', name: '3-Tage-Serie', desc: '3 Tage hintereinander geübt', ok: s => s.streak.count >= 3 },
    { id: 'streak7', ico: '🗓️', name: 'Wochen-Held', desc: '7 Tage hintereinander geübt', ok: s => s.streak.count >= 7 },
    { id: 'master25', ico: '🧠', name: 'Wortschatz 25', desc: '25 Vokabeln gemeistert', ok: s => Object.values(s.boxes).filter(b => b.box >= 4).length >= 25 },
    { id: 'master100', ico: '📚', name: 'Wortschatz 100', desc: '100 Vokabeln gemeistert', ok: s => Object.values(s.boxes).filter(b => b.box >= 4).length >= 100 },
    { id: 'both', ico: '🔄', name: 'Beidhänder', desc: 'Beide Richtungen getestet', ok: s => s.tests.some(t => t.dir === 'en-de') && s.tests.some(t => t.dir === 'de-en') },
    { id: 'unitmaster', ico: '⭐', name: 'Unit-Boss', desc: 'Eine Unit zu 80 % gemeistert', ok: () => UNITS.some(u => unitMastery(u) >= 80) }
  ];
  function checkBadges() {
    const fresh = BADGES.filter(b => !S.badges.includes(b.id) && b.ok(S));
    fresh.forEach(b => S.badges.push(b.id));
    return fresh;
  }

  // ---------- Antwort prüfen ----------
  const FILLER = new Set(['sb', 'sth', 'somebody', 'something', 'etw', 'jdn', 'jdm', 'jds', 'jmd', 'jmdn', 'jmdm', 'jemanden', 'jemandem']);
  function norm(s, lang) {
    let t = String(s).toLowerCase().replace(/[’`´]/g, "'").replace(/[.,!?;:"“”„()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    t = t.split(' ').filter(w => !FILLER.has(w)).join(' ');
    if (lang === 'en') t = t.replace(/^to /, '').replace(/^(a|an|the) /, '');
    if (lang === 'de') t = t.replace(/^(der|die|das|ein|eine|einen|sich) /, '');
    return t.trim();
  }
  const fold = s => s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[-']/g, '').replace(/\s/g, '');
  function alternatives(ans) {
    const out = new Set();
    // "der/die/das schlechteste" -> der schlechteste | die schlechteste | das schlechteste
    const expand = a => a.split(' ').reduce((acc, tok) => {
      const opts = tok.includes('/') ? tok.split('/').filter(Boolean) : [tok];
      return acc.flatMap(pre => opts.map(o => (pre ? pre + ' ' : '') + o));
    }, ['']);
    String(ans).split(/[,;]/).map(x => x.trim()).filter(Boolean).forEach(a => {
      expand(a).forEach(e => {
        out.add(e.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()); // ohne optionale Teile
        out.add(e.replace(/[()]/g, ''));                                     // mit optionalen Teilen
      });
    });
    return [...out].filter(Boolean);
  }
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function checkAnswer(given, answer, lang, extra = []) {
    const g = norm(given, lang);
    if (!g) return { result: 'wrong' };
    const alts = alternatives(answer).concat(extra);
    let best = null;
    for (const a of alts) {
      const n = norm(a, lang);
      if (n === g) return { result: 'right' };
      const d = lev(fold(g), fold(n));
      if (d === 0) return { result: 'right' }; // nur ae/ä, Apostroph o. Ä.
      const L = fold(n).length;
      const allowed = L <= 3 ? 0 : L <= 6 ? 1 : L <= 10 ? 2 : 3;
      if (d <= allowed && (!best || d < best.d)) best = { d, a };
    }
    if (best) return { result: 'almost', best: best.a };
    return { result: 'wrong' };
  }

  // ---------- Lückentext ----------
  function findInSentence(v) {
    if (!v.example) return null;
    const words = alternatives(v.en).map(a => norm(a, 'en')).filter(Boolean);
    for (const w of words) {
      const parts = w.split(' ');
      const stem = parts.map((p, i) => {
        const base = (i === parts.length - 1 && p.length > 4) ? p.replace(/(e|y)$/, '') : p;
        return base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('\\s+');
      const re = new RegExp('\\b(' + stem + "[a-z']*)", 'i');
      const m = v.example.match(re);
      if (m) return { form: m[1], index: m.index };
    }
    return null;
  }

  // ---------- Fragen bauen ----------
  function pickWords(unit, count, hardOnly) {
    let pool = unitWords(unit);
    if (hardOnly) { const h = pool.filter(v => isHard(v.id)); if (h.length) pool = h; }
    if (count === 'all' || count >= pool.length) return shuffle(pool);
    // Gewichtet: neue und schwierige Wörter kommen öfter dran
    const items = pool.map(v => ({ v, w: S.boxes[v.id] ? Math.pow(6 - Math.min(boxOf(v.id), 5), 2) : 30 }));
    const out = [];
    while (out.length < count && items.length) {
      const total = items.reduce((s, x) => s + x.w, 0);
      let r = Math.random() * total, i = 0;
      while (r > items[i].w) { r -= items[i].w; i++; }
      out.push(items.splice(i, 1)[0].v);
    }
    return out;
  }
  function buildQuestion(v, dir, mode) {
    let m = mode === 'mix' ? ['type', 'mc', 'gap'][Math.floor(Math.random() * 3)] : mode;
    const hit = m === 'gap' ? findInSentence(v) : null;
    if (m === 'gap' && !hit) m = 'type';
    const q = { id: v.id, dir, mode: m, prompt: dir === 'en-de' ? v.en : v.de, answer: dir === 'en-de' ? v.de : v.en, lang: dir === 'en-de' ? 'de' : 'en' };
    if (m === 'gap') q.hit = hit;
    // Synonyme in derselben Unit akzeptieren (z. B. "anziehen" = to put on / to get dressed)
    const from = dir === 'en-de' ? 'en' : 'de', to = dir === 'en-de' ? 'de' : 'en', fromLang = dir === 'en-de' ? 'en' : 'de';
    const mine = new Set(alternatives(v[from]).map(a => norm(a, fromLang)));
    q.also = alternatives((dir === 'en-de' ? v.alsoDe : v.alsoEn) || '');
    q.extra = unitWords(v.unit).filter(x => x.id !== v.id && alternatives(x[from]).some(a => mine.has(norm(a, fromLang)))).flatMap(x => alternatives(x[to]));
    if (m === 'mc') {
      const key = dir === 'en-de' ? 'de' : 'en';
      const same = shuffle(unitWords(v.unit).filter(x => x.id !== v.id && x[key] !== v[key]));
      const other = shuffle(VOCAB.filter(x => x.unit !== v.unit && x[key] !== v[key]));
      const opts = [...new Set(same.concat(other).map(x => x[key]))].slice(0, 3);
      q.options = shuffle(opts.concat(v[key]));
    }
    return q;
  }

  // ---------- Router ----------
  let quiz = null;
  function go(screen, arg) {
    window.scrollTo(0, 0);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    ({ home, setup, quiz: quizScreen, result, history, detail, learn, cards, trophies, settings })[screen](arg);
  }
  function topbar() {
    const L = levelInfo(S.xp), R = rankInfo(S.trophies);
    return `<div class="topbar">
      <div class="lvl outline" title="Level">${L.lvl}</div>
      <div class="xpbar"><div class="small muted">XP ${L.rest} / ${L.need}</div><div class="bar"><i style="width:${L.pct}%"></i></div></div>
      <span class="pill" title="Trophäen">🏆 ${S.trophies}</span>
      <span class="pill" title="Tage in Folge">🔥 ${S.streak.count}</span>
    </div>`;
  }
  const backBtn = (to = 'home', label = '◀ Zurück') => `<button class="back" data-go="${to}">${label}</button>`;
  function bindGo() { $app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { beep('tap'); go(b.dataset.go); }); }

  // ---------- Startseite ----------
  function home() {
    const R = rankInfo(S.trophies);
    const hard = VOCAB.filter(v => isHard(v.id)).length;
    const playedToday = S.streak.last === today();
    $app.innerHTML = `${topbar()}
      <div class="panel hello pop">
        <div class="avatar">🎮</div>
        <div>
          <h1 class="outline">Hey ${esc(S.name)}!</h1>
          <div class="muted">${playedToday ? 'Tagesziel geschafft ✅ – weiter so!' : 'Bereit fürs nächste Match? Ein Test pro Tag hält deine 🔥-Serie am Leben.'}</div>
        </div>
      </div>
      <div class="panel">
        <div class="row"><span style="font-size:40px">${R.icon}</span>
          <div class="spacer"><div class="head" style="font-size:24px">Rang: ${R.name}</div>
          ${R.next ? `<div class="small muted">Noch ${R.next[0] - S.trophies} 🏆 bis ${R.next[2]} ${R.next[1]}</div>` : '<div class="small muted">Höchster Rang erreicht!</div>'}
          <div class="bar" style="margin-top:6px"><i style="width:${R.pct}%"></i></div></div>
        </div>
      </div>
      <button class="btn green big outline" data-go="setup">⚔️ TEST STARTEN</button>
      <div style="height:20px"></div>
      <div class="menu">
        <button class="btn blue" data-go="learn">📖 Lernen</button>
        <button class="btn" data-go="history">📜 Meine Tests</button>
        <button class="btn" data-go="trophies">🏅 Abzeichen</button>
        <button class="btn gray" data-go="settings">⚙️ Einstellungen</button>
      </div>
      ${hard ? `<p class="center muted" style="margin-top:22px">💡 Du hast <b>${hard}</b> schwierige Vokabeln. Wähle beim Test „Nur schwierige Wörter“, um sie gezielt zu trainieren.</p>` : ''}
      ${!VOCAB.length ? '<p class="center">Noch keine Vokabeln eingetragen.</p>' : ''}`;
    bindGo();
  }

  // ---------- Test einstellen ----------
  function setup() {
    const st = S.settings;
    if (!UNITS.includes(st.unit)) st.unit = UNITS[0] || null;
    const opt = (group, val, label, sub, cur) => `<button class="opt ${cur === val ? 'sel' : ''}" data-g="${group}" data-v="${val}">${label}${sub ? `<small>${sub}</small>` : ''}</button>`;
    const hardCount = st.unit ? unitWords(st.unit).filter(v => isHard(v.id)).length : 0;
    $app.innerHTML = `${backBtn()}
      <h2 class="outline">Test einstellen</h2>
      <div class="label">1. Unit wählen</div>
      <div class="grid" style="margin-bottom:18px">
        ${UNITS.map(u => `<button class="unit ${st.unit === u ? 'sel' : ''}" data-unit="${esc(u)}">
          <div class="head">${esc(u)}</div>
          <div class="small">${unitWords(u).length} Vokabeln · ${unitMastery(u)} % gemeistert</div>
          <div class="bar green"><i style="width:${unitMastery(u)}%"></i></div>
        </button>`).join('')}
      </div>
      <div class="label">2. Richtung</div>
      <div class="choice">${opt('dir', 'en-de', '🇬🇧 → 🇩🇪', 'Englisch → Deutsch', st.dir)}${opt('dir', 'de-en', '🇩🇪 → 🇬🇧', 'Deutsch → Englisch', st.dir)}</div>
      <div class="label">3. Spielmodus</div>
      <div class="choice">
        ${opt('mode', 'type', '⌨️ Schreiben', 'Antwort eintippen', st.mode)}
        ${opt('mode', 'mc', '🎯 Auswahl', '4 Antworten', st.mode)}
        ${opt('mode', 'gap', '🧩 Lückentext', 'mit Beispielsatz', st.mode)}
        ${opt('mode', 'mix', '🎲 Mix', 'alles gemischt', st.mode)}
      </div>
      <div class="label">4. Anzahl</div>
      <div class="choice">
        ${opt('count', '10', '10', 'Quick Match', String(st.count))}
        ${opt('count', '20', '20', 'Ranked', String(st.count))}
        ${opt('count', 'all', 'Alle', 'Boss-Fight', String(st.count))}
        ${opt('hard', st.hardOnly ? 'on' : 'off', st.hardOnly ? '✅ Nur schwierige' : '⬜ Nur schwierige', hardCount ? hardCount + ' Wörter' : 'noch keine', 'on')}
      </div>
      <button class="btn green big outline" id="start" ${st.unit ? '' : 'disabled'}>▶ LOS GEHT'S</button>`;
    bindGo();
    $app.querySelectorAll('[data-unit]').forEach(b => b.onclick = () => { beep('tap'); st.unit = b.dataset.unit; save(); setup(); });
    $app.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
      beep('tap');
      const g = b.dataset.g, v = b.dataset.v;
      if (g === 'count') st.count = v === 'all' ? 'all' : Number(v);
      else if (g === 'hard') st.hardOnly = !st.hardOnly;
      else st[g] = v;
      save(); setup();
    });
    document.getElementById('start').onclick = () => {
      const words = pickWords(st.unit, st.count, st.hardOnly);
      if (!words.length) return toast('Keine Vokabeln in dieser Unit.');
      startQuiz(words, { unit: st.unit, dir: st.dir, mode: st.mode, label: st.hardOnly ? 'Schwierige Wörter' : null });
    };
  }

  // ---------- Quiz ----------
  function startQuiz(words, cfg) {
    quiz = Object.assign({}, cfg, { qs: words.map(v => buildQuestion(v, cfg.dir, cfg.mode)), i: 0, items: [], combo: 0, maxCombo: 0, xp: 0, start: Date.now() });
    go('quiz');
  }
  function quizScreen() {
    const q = quiz.qs[quiz.i], v = BY_ID[q.id];
    const pct = Math.round(quiz.i / quiz.qs.length * 100);
    const enShown = q.dir === 'en-de';
    let card = '';
    if (q.mode === 'gap') {
      const ex = v.example, h = q.hit;
      if (q.dir === 'de-en') {
        card = `<div class="card pop"><div class="tag">🧩 Ergänze das Wort</div>
          <div class="sentence">${esc(ex.slice(0, h.index))}<span class="gap">&nbsp;</span>${esc(ex.slice(h.index + h.form.length))}</div>
          <div class="hint">💡 ${esc(v.de)}</div></div>`;
      } else {
        card = `<div class="card pop"><div class="tag">🧩 Was heißt das markierte Wort?</div>
          <button class="iconbtn speak" id="spk">🔊</button>
          <div class="sentence">${esc(ex.slice(0, h.index))}<u style="background:#fde047">${esc(h.form)}</u>${esc(ex.slice(h.index + h.form.length))}</div></div>`;
      }
    } else {
      card = `<div class="card pop"><div class="tag">${enShown ? '🇬🇧 Was heißt das auf Deutsch?' : '🇩🇪 Was heißt das auf Englisch?'}</div>
        ${enShown ? '<button class="iconbtn speak" id="spk">🔊</button>' : ''}
        <div class="word">${esc(q.prompt)}</div></div>`;
    }
    const input = q.mode === 'mc'
      ? `<div class="mc">${q.options.map((o, i) => `<button class="btn" data-mc="${i}">${esc(o)}</button>`).join('')}</div>`
      : `<form id="f" autocomplete="off"><input class="answer" id="ans" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="${q.lang === 'en' ? 'English…' : 'Deutsch…'}">
         <div style="height:14px"></div><button class="btn green big outline" type="submit" id="check">PRÜFEN</button></form>`;
    $app.innerHTML = `<div class="quizhead">
        <button class="iconbtn" id="quit" title="Abbrechen">✖</button>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="head">${quiz.i + 1}/${quiz.qs.length}</div>
        <div class="combo">${quiz.combo >= 2 ? '🔥x' + quiz.combo : ''}</div>
      </div>
      ${card}${input}<div id="fb"></div>`;
    document.getElementById('quit').onclick = () => { if (confirm('Test abbrechen? Der Fortschritt dieses Tests geht verloren.')) go('home'); };
    const spk = document.getElementById('spk');
    if (spk) spk.onclick = () => speak(q.mode === 'gap' ? v.example : v.en);
    if (enShown && S.settings.autoSpeak && q.mode !== 'gap') setTimeout(() => speak(v.en), 250);
    if (q.mode === 'mc') {
      $app.querySelectorAll('[data-mc]').forEach(b => b.onclick = () => {
        if (quiz.answered) return;
        const given = q.options[+b.dataset.mc];
        const ok = given === q.answer;
        $app.querySelectorAll('[data-mc]').forEach(x => { if (q.options[+x.dataset.mc] === q.answer) x.classList.add('right'); });
        if (!ok) b.classList.add('wrong');
        answered(q, given, ok ? 'right' : 'wrong');
      });
    } else {
      const inp = document.getElementById('ans');
      setTimeout(() => inp.focus(), 50);
      document.getElementById('f').onsubmit = e => {
        e.preventDefault();
        if (quiz.answered) return next();
        if (!inp.value.trim()) { inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 300); return; }
        const learned = ((S.learned || {})[q.id] || {})[q.lang] || [];
        const extra = (q.extra || []).concat(q.also || [], learned, q.mode === 'gap' && q.dir === 'de-en' ? [q.hit.form] : []);
        const r = checkAnswer(inp.value, q.answer, q.lang, extra);
        inp.readOnly = true; inp.blur();
        answered(q, inp.value.trim(), r.result, r.best);
      };
    }
    quiz.answered = false;
  }
  function answered(q, given, result, best) {
    quiz.answered = true;
    const v = BY_ID[q.id];
    const item = { id: q.id, q: q.prompt, a: q.answer, given, result, mode: q.mode };
    quiz.items.push(item);
    applyResult(item);
    const fb = document.getElementById('fb');
    const ex = v.example ? `<div class="ex">📝 ${esc(v.example)}</div>` : '';
    const alsoList = [...new Set((q.also || []).concat(((S.learned || {})[q.id] || {})[q.lang] || []))]
      .filter(a => norm(a, q.lang) !== norm(given, q.lang)).slice(0, 5);
    const also = alsoList.length ? `<div class="also">Auch richtig: ${alsoList.map(esc).join(' · ')}</div>` : '';
    const sol = `<div class="sol">${esc(q.dir === 'en-de' ? v.en : v.de)} = ${esc(q.answer)}</div>${also}`;
    let html;
    if (result === 'right') {
      const praise = ['Stark! 💪', 'Treffer! 🎯', 'Mega! ⭐', 'Richtig! ✅', 'Nice! 😎', 'Volltreffer! 💥'];
      html = `<div class="feedback ok"><div class="head outline">${praise[Math.floor(Math.random() * praise.length)]}</div>${sol}${ex}</div>`;
    } else if (result === 'almost') {
      html = `<div class="feedback almost"><div class="head">Fast perfekt! 👍 Zählt als richtig.</div>
        <div>Du hast geschrieben: <b>${esc(given)}</b></div><div class="sol">Richtig geschrieben: ${esc(best || q.answer)}</div>${ex}</div>`;
    } else {
      html = `<div class="feedback bad"><div class="head outline">Leider falsch 😬</div>
        ${given ? `<div>Deine Antwort: <b>${esc(given)}</b></div>` : ''}${sol}${ex}
        ${q.mode !== 'mc' ? '<button class="linkbtn" id="override">Meine Antwort war doch richtig 🙋</button>' : ''}</div>`;
    }
    fb.innerHTML = html + `<button class="btn big ${result === 'wrong' ? 'red' : 'green'} outline" id="next">${quiz.i + 1 < quiz.qs.length ? 'WEITER ➜' : 'ERGEBNIS 🏁'}</button>`;
    beep(result);
    if (result === 'wrong') document.querySelector('.card').classList.add('shake');
    if (S.settings.autoSpeak) setTimeout(() => speak(v.en), 300);
    document.getElementById('next').onclick = next;
    const ov = document.getElementById('override');
    if (ov) ov.onclick = () => {
      undoResult(item); item.result = 'right'; item.override = true; applyResult(item);
      // Antwort merken: nächstes Mal automatisch richtig
      S.learned = S.learned || {};
      const L = S.learned[q.id] = S.learned[q.id] || {};
      L[q.lang] = [...new Set((L[q.lang] || []).concat(given))];
      save();
      ov.parentElement.className = 'feedback ok';
      ov.parentElement.querySelector('.head').textContent = 'OK, als richtig gewertet ✅ – wird gemerkt';
      ov.remove();
      document.getElementById('next').className = 'btn big green outline';
    };
    const chk = document.getElementById('check'); if (chk) chk.style.display = 'none';
    setTimeout(() => { const n = document.getElementById('next'); if (n) n.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
  }
  function applyResult(item) {
    const b = S.boxes[item.id] = S.boxes[item.id] || { box: 0, right: 0, wrong: 0, last: 0 };
    item._prev = { box: b.box, combo: quiz.combo };
    if (item.result === 'wrong') { b.box = 0; b.wrong++; quiz.combo = 0; item._xp = 0; }
    else {
      b.box = Math.min(b.box + 1, 6); b.right++; quiz.combo++;
      item._xp = (item.result === 'right' ? 10 : 7) + (quiz.combo >= 3 ? Math.min(quiz.combo, 10) : 0);
    }
    b.last = Date.now();
    quiz.xp += item._xp;
    quiz.maxCombo = Math.max(quiz.maxCombo, quiz.combo);
  }
  function undoResult(item) {
    const b = S.boxes[item.id];
    b.box = item._prev.box; if (item.result === 'wrong') b.wrong--; else b.right--;
    quiz.combo = item._prev.combo; quiz.xp -= item._xp;
  }
  function next() {
    quiz.i++;
    if (quiz.i < quiz.qs.length) go('quiz'); else finish();
  }
  function grade(p) {
    if (p >= 90) return [1, 'Sehr gut']; if (p >= 80) return [2, 'Gut']; if (p >= 65) return [3, 'Befriedigend'];
    if (p >= 50) return [4, 'Genügend']; return [5, 'Nicht genügend'];
  }
  function finish() {
    const total = quiz.items.length;
    const right = quiz.items.filter(x => x.result === 'right').length;
    const almost = quiz.items.filter(x => x.result === 'almost').length;
    const correct = right + almost;
    const pct = Math.round(correct / total * 100);
    let trophies = correct * 2 + (pct === 100 && total >= 5 ? 10 : 0) + (pct >= 90 ? 5 : 0);
    const levelBefore = levelInfo(S.xp).lvl, rankBefore = rankInfo(S.trophies).name;
    S.xp += quiz.xp; S.trophies += trophies;
    S.bestCombo = Math.max(S.bestCombo, quiz.maxCombo);
    // Tages-Serie
    const t = today();
    if (S.streak.last !== t) {
      const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      S.streak.count = S.streak.last === y ? S.streak.count + 1 : 1;
      S.streak.last = t;
    }
    const test = {
      id: Date.now(), date: Date.now(), unit: quiz.unit, dir: quiz.dir, mode: quiz.mode, label: quiz.label || null,
      total, correct, right, almost, pct, xp: quiz.xp, trophies, combo: quiz.maxCombo, secs: Math.round((Date.now() - quiz.start) / 1000),
      items: quiz.items.map(({ id, q, a, given, result, mode, override }) => ({ id, q, a, given, result, mode, override }))
    };
    S.tests.push(test);
    const newBadges = checkBadges();
    save();
    go('result', { test, newBadges, levelUp: levelInfo(S.xp).lvl > levelBefore, rankUp: rankInfo(S.trophies).name !== rankBefore });
  }

  // ---------- Auswertung ----------
  function result({ test, newBadges = [], levelUp, rankUp }) {
    const [g, gName] = grade(test.pct);
    const stars = test.pct >= 90 ? 3 : test.pct >= 70 ? 2 : test.pct >= 50 ? 1 : 0;
    const wrong = test.items.filter(x => x.result === 'wrong');
    const almost = test.items.filter(x => x.result === 'almost');
    const msg = test.pct === 100 ? 'PERFEKTES MATCH! 🏆' : test.pct >= 90 ? 'SIEG! 🎉' : test.pct >= 70 ? 'Gut gekämpft! 💪' : test.pct >= 50 ? 'Knapp geschafft! 😅' : 'Nächstes Mal holst du dir den Sieg! 💥';
    $app.innerHTML = `<div class="panel center pop">
        <h2 class="outline">${msg}</h2>
        <div class="stars">${[0, 1, 2].map(i => `<span class="${i < stars ? '' : 'off'}">⭐</span>`).join('')}</div>
        <div class="bigscore outline">${test.pct} %</div>
        <div class="grade">Note ${g} · ${gName}</div>
        <div class="stats">
          <div class="stat"><div class="head">${test.correct}/${test.total}</div><div class="small">richtig</div></div>
          <div class="stat"><div class="head">+${test.xp}</div><div class="small">XP</div></div>
          <div class="stat"><div class="head">+${test.trophies} 🏆</div><div class="small">Trophäen</div></div>
        </div>
        <div class="small muted">${esc(test.unit)} · ${DIRS[test.dir]} · ${MODES[test.mode]} · beste Combo 🔥${test.combo} · ${Math.floor(test.secs / 60)}:${String(test.secs % 60).padStart(2, '0')} min</div>
      </div>
      ${levelUp ? `<div class="panel center"><h3>⬆️ LEVEL UP! Du bist jetzt Level ${levelInfo(S.xp).lvl}</h3></div>` : ''}
      ${rankUp ? `<div class="panel center"><h3>${rankInfo(S.trophies).icon} Neuer Rang: ${rankInfo(S.trophies).name}!</h3></div>` : ''}
      ${newBadges.length ? `<div class="panel"><h3>🏅 Neue Abzeichen!</h3><div class="badges" style="margin-top:10px">${newBadges.map(b => `<div class="badge"><div class="ico">${b.ico}</div><b>${b.name}</b>${b.desc}</div>`).join('')}</div></div>` : ''}
      ${wrong.length ? `<div class="panel"><h3>❌ Diese Wörter üben wir nochmal</h3><ul class="list" style="margin-top:10px">${wrong.map(itemRow).join('')}</ul></div>` : ''}
      ${almost.length ? `<div class="panel"><h3>✍️ Auf die Schreibweise achten</h3><ul class="list" style="margin-top:10px">${almost.map(itemRow).join('')}</ul></div>` : ''}
      <div class="menu">
        ${wrong.length ? '<button class="btn red" id="retryWrong">🔁 Fehler üben</button>' : ''}
        <button class="btn blue" id="again">⚔️ Neuer Test</button>
        <button class="btn" data-go="history">📜 Alle Tests</button>
        <button class="btn gray" data-go="home">🏠 Start</button>
      </div>`;
    bindGo();
    bindSpeakRows();
    if (stars === 3) { confetti(); beep('win'); } else if (stars >= 1) beep('win');
    if (levelUp) setTimeout(() => toast('⬆️ LEVEL UP!'), 600);
    document.getElementById('again').onclick = () => go('setup');
    const rw = document.getElementById('retryWrong');
    if (rw) rw.onclick = () => startQuiz(wrong.map(x => BY_ID[x.id]).filter(Boolean), { unit: test.unit, dir: test.dir, mode: test.mode === 'mc' ? 'type' : test.mode, label: 'Fehlertraining' });
  }
  function itemRow(x) {
    const v = BY_ID[x.id];
    const cls = x.result === 'right' ? 'r' : x.result === 'almost' ? 'a' : 'w';
    const ico = x.result === 'right' ? '✅' : x.result === 'almost' ? '✍️' : '❌';
    return `<li><span>${ico}</span><div class="grow"><b>${esc(x.q)}</b> = ${esc(x.a)}
      ${x.result !== 'right' ? `<div class="small ${cls}">Deine Antwort: ${esc(x.given || '–')}</div>` : ''}
      ${x.override ? '<div class="small muted">(selbst als richtig gewertet)</div>' : ''}</div>
      ${v ? `<button class="iconbtn" data-say="${esc(v.en)}">🔊</button>` : ''}</li>`;
  }
  function bindSpeakRows() { $app.querySelectorAll('[data-say]').forEach(b => b.onclick = () => speak(b.dataset.say)); }

  // ---------- Verlauf ----------
  function history() {
    const tests = S.tests.slice().reverse();
    const avg = tests.length ? Math.round(tests.reduce((s, t) => s + t.pct, 0) / tests.length) : 0;
    const last10 = S.tests.slice(-10);
    $app.innerHTML = `${backBtn()}<h2 class="outline">📜 Meine Tests</h2>
      ${tests.length ? `<div class="stats">
        <div class="stat"><div class="head">${tests.length}</div><div class="small">Tests</div></div>
        <div class="stat"><div class="head">${avg} %</div><div class="small">Durchschnitt</div></div>
        <div class="stat"><div class="head">🔥${S.bestCombo}</div><div class="small">beste Combo</div></div>
      </div>
      <div class="panel"><h3>Letzte ${last10.length} Tests</h3>
        <div style="display:flex;align-items:flex-end;gap:6px;height:120px;margin-top:10px">
          ${last10.map(t => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">
            <div class="small">${t.pct}</div>
            <div style="width:100%;height:${Math.max(t.pct, 3)}%;background:${t.pct >= 90 ? 'var(--green)' : t.pct >= 65 ? 'var(--yellow)' : 'var(--red)'};border:3px solid var(--ink);border-radius:8px 8px 0 0"></div></div>`).join('')}
        </div></div>
      <div class="label">Pro Unit</div>
      <div class="grid" style="margin-bottom:18px">${UNITS.map(u => {
        const ts = S.tests.filter(t => t.unit === u);
        return `<div class="unit" style="cursor:default"><div class="head">${esc(u)}</div>
          <div class="small">${ts.length} Tests · ${ts.length ? 'Ø ' + Math.round(ts.reduce((s, t) => s + t.pct, 0) / ts.length) + ' %' : '–'} · ${unitMastery(u)} % gemeistert</div>
          <div class="bar green"><i style="width:${unitMastery(u)}%"></i></div></div>`;
      }).join('')}</div>
      <div class="label">Alle Tests</div>
      <ul class="list">${tests.map(t => `<li data-test="${t.id}" style="cursor:pointer">
        <span style="font-size:26px">${t.pct >= 90 ? '🏆' : t.pct >= 65 ? '👍' : '💪'}</span>
        <div class="grow"><b>${esc(t.unit)}</b> · ${DIRS[t.dir]} · ${MODES[t.mode]}${t.label ? ' · ' + esc(t.label) : ''}<div class="small muted">${fmtDate(t.date)}</div></div>
        <div class="head" style="font-size:24px">${t.pct} %</div><div class="small">Note ${grade(t.pct)[0]}</div></li>`).join('')}</ul>`
      : '<div class="panel center">Noch keine Tests gemacht. Starte dein erstes Match! ⚔️</div>'}`;
    bindGo();
    $app.querySelectorAll('[data-test]').forEach(li => li.onclick = () => go('detail', +li.dataset.test));
  }
  function detail(id) {
    const t = S.tests.find(x => x.id === id); if (!t) return go('history');
    const [g, gName] = grade(t.pct);
    $app.innerHTML = `${backBtn('history')}
      <div class="panel center"><h2 class="outline">${esc(t.unit)} – ${t.pct} %</h2>
        <div class="grade">Note ${g} · ${gName}</div>
        <p class="muted small">${fmtDate(t.date)} · ${DIRS[t.dir]} · ${MODES[t.mode]} · ${t.correct}/${t.total} richtig · +${t.xp} XP</p></div>
      <ul class="list">${t.items.map(itemRow).join('')}</ul>
      <div style="height:16px"></div>
      <div class="menu">
        <button class="btn blue" id="repeat">🔁 Test wiederholen</button>
        ${t.items.some(x => x.result === 'wrong') ? '<button class="btn red" id="wrongOnly">❌ Nur Fehler üben</button>' : ''}
      </div>`;
    bindGo(); bindSpeakRows();
    const words = list => list.map(x => BY_ID[x.id]).filter(Boolean);
    document.getElementById('repeat').onclick = () => {
      const w = words(t.items); if (!w.length) return toast('Vokabeln nicht mehr vorhanden.');
      startQuiz(shuffle(w), { unit: t.unit, dir: t.dir, mode: t.mode, label: 'Wiederholung' });
    };
    const wo = document.getElementById('wrongOnly');
    if (wo) wo.onclick = () => startQuiz(words(t.items.filter(x => x.result === 'wrong')), { unit: t.unit, dir: t.dir, mode: 'type', label: 'Fehlertraining' });
  }

  // ---------- Lernen ----------
  function learn() {
    $app.innerHTML = `${backBtn()}<h2 class="outline">📖 Lernen</h2>
      <p class="muted">Schau dir die Vokabeln vor dem Test als Karteikarten an.</p>
      <div class="grid">${UNITS.map(u => `<button class="unit" data-unit="${esc(u)}"><div class="head">${esc(u)}</div>
        <div class="small">${unitWords(u).length} Vokabeln · ${unitMastery(u)} % gemeistert</div>
        <div class="bar green"><i style="width:${unitMastery(u)}%"></i></div></button>`).join('')}</div>`;
    bindGo();
    $app.querySelectorAll('[data-unit]').forEach(b => b.onclick = () => go('cards', { unit: b.dataset.unit, i: 0, order: unitWords(b.dataset.unit) }));
  }
  function cards(c) {
    const v = c.order[c.i];
    const lvl = boxOf(v.id);
    $app.innerHTML = `${backBtn('learn')}
      <div class="quizhead"><h2 class="outline" style="margin:0">${esc(c.unit)}</h2><div class="spacer"></div><div class="head">${c.i + 1}/${c.order.length}</div></div>
      <div class="flip" id="flip"><div class="inner">
        <div class="card face"><div class="tag">🇬🇧 Tippen zum Umdrehen</div><div class="word">${esc(v.en)}</div>
          <div class="small" style="margin-top:12px">${'🟩'.repeat(Math.min(lvl, 5))}${'⬜'.repeat(5 - Math.min(lvl, 5))}</div></div>
        <div class="card face back"><div class="tag">🇩🇪 Deutsch</div><div class="word">${esc(v.de)}</div>
          ${v.alsoDe ? `<div class="small" style="margin-top:6px;color:#6b21a8;font-weight:800">auch: ${esc(v.alsoDe)}</div>` : ''}
          ${v.example ? `<div class="hint" style="font-style:italic">${esc(v.example)}</div>` : ''}</div>
      </div></div>
      <div style="height:20px"></div>
      <div class="row" style="justify-content:center">
        <button class="btn gray" id="prev" ${c.i === 0 ? 'disabled' : ''}>◀</button>
        <button class="btn blue" id="say">🔊 Anhören</button>
        <button class="btn gray" id="mix">🔀</button>
        <button class="btn" id="nxt">${c.i + 1 < c.order.length ? '▶' : '✔ Fertig'}</button>
      </div>
      <div class="panel" style="margin-top:22px"><h3>Alle Vokabeln</h3><ul class="list" style="margin-top:10px">
        ${unitWords(c.unit).map(x => `<li><div class="grow"><b>${esc(x.en)}</b> = ${esc(x.de)}${x.alsoDe ? `<span class="muted"> (auch: ${esc(x.alsoDe)})</span>` : ''}${x.example ? `<div class="small muted">${esc(x.example)}</div>` : ''}</div><button class="iconbtn" data-say="${esc(x.en)}">🔊</button></li>`).join('')}
      </ul></div>`;
    bindGo(); bindSpeakRows();
    const flip = document.getElementById('flip');
    flip.onclick = () => { flip.classList.toggle('on'); beep('tap'); };
    document.getElementById('say').onclick = () => speak(flip.classList.contains('on') && v.example ? v.example : v.en);
    document.getElementById('prev').onclick = () => { c.i--; cards(c); };
    document.getElementById('nxt').onclick = () => { if (c.i + 1 < c.order.length) { c.i++; cards(c); } else go('learn'); };
    document.getElementById('mix').onclick = () => { c.order = shuffle(c.order); c.i = 0; cards(c); toast('Gemischt 🔀', 1000); };
    if (S.settings.autoSpeak) setTimeout(() => speak(v.en), 200);
  }

  // ---------- Abzeichen ----------
  function trophies() {
    const R = rankInfo(S.trophies);
    $app.innerHTML = `${backBtn()}${topbar()}<h2 class="outline">🏅 Abzeichen & Ränge</h2>
      <div class="panel"><div class="badges">${BADGES.map(b => `<div class="badge ${S.badges.includes(b.id) ? '' : 'locked'}"><div class="ico">${b.ico}</div><b>${b.name}</b>${b.desc}</div>`).join('')}</div></div>
      <div class="panel"><h3>Ränge</h3><ul class="list" style="margin-top:10px">
        ${RANKS.map(r => `<li style="${r[1] === R.name ? 'background:rgba(250,204,21,.3)' : ''}"><span style="font-size:28px">${r[2]}</span><div class="grow"><b>${r[1]}</b></div><span>ab ${r[0]} 🏆</span></li>`).join('')}
      </ul></div>`;
    bindGo();
  }

  // ---------- Einstellungen ----------
  function settings() {
    const st = S.settings;
    $app.innerHTML = `${backBtn()}<h2 class="outline">⚙️ Einstellungen</h2>
      <div class="panel">
        <div class="label">Name</div>
        <input class="answer" id="name" value="${esc(S.name)}" style="font-size:24px">
        <div style="height:16px"></div>
        <div class="choice">
          <button class="opt ${st.sound ? 'sel' : ''}" id="snd">${st.sound ? '🔔 Sounds an' : '🔕 Sounds aus'}</button>
          <button class="opt ${st.autoSpeak ? 'sel' : ''}" id="as">${st.autoSpeak ? '🗣️ Vorlesen an' : '🤐 Vorlesen aus'}<small>englische Wörter automatisch</small></button>
        </div>
      </div>
      <div class="panel">
        <h3>💾 Sicherung</h3>
        <p class="small muted">Dein Fortschritt wird auf diesem iPad gespeichert. Mach ab und zu eine Sicherung, damit nichts verloren geht. Tipp: Die App über „Teilen → Zum Home-Bildschirm“ hinzufügen.</p>
        <div class="row"><button class="btn blue sm" id="exp">⬇️ Sicherung speichern</button>
        <label class="btn sm">⬆️ Sicherung laden<input type="file" id="imp" accept=".json,application/json" style="display:none"></label></div>
      </div>
      <div class="panel">
        <h3>⚠️ Zurücksetzen</h3>
        <p class="small muted">Löscht alle Tests, XP, Trophäen und Abzeichen.</p>
        <button class="btn red sm" id="reset">Alles löschen</button>
      </div>
      <p class="center small muted">${VOCAB.length} Vokabeln in ${UNITS.length} Units</p>`;
    bindGo();
    document.getElementById('name').onchange = e => { S.name = e.target.value.trim() || 'Paul'; save(); toast('Gespeichert ✅', 1000); };
    document.getElementById('snd').onclick = () => { st.sound = !st.sound; save(); settings(); };
    document.getElementById('as').onclick = () => { st.autoSpeak = !st.autoSpeak; save(); settings(); };
    document.getElementById('exp').onclick = () => {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'vocab-arena-sicherung-' + today() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    document.getElementById('imp').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const d = JSON.parse(r.result);
          if (!d || !Array.isArray(d.tests)) throw new Error();
          S = Object.assign({}, DEFAULT, d, { settings: Object.assign({}, DEFAULT.settings, d.settings) });
          save(); toast('Sicherung geladen ✅'); go('home');
        } catch (err) { toast('Datei ungültig ❌'); }
      };
      r.readAsText(f);
    };
    document.getElementById('reset').onclick = () => {
      if (confirm('Wirklich ALLES löschen?') && confirm('Sicher? Das kann nicht rückgängig gemacht werden.')) {
        const name = S.name; S = JSON.parse(JSON.stringify(DEFAULT)); S.name = name; save(); go('home');
      }
    };
  }

  // Für Tests in der Konsole
  window.__vocab = { checkAnswer, findInSentence, alternatives };
  go('home');
})();
