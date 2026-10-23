'use strict';

/* ========== データ ==========
 * users[]  … 推しライバー。level = その推しでの自分のメンレベ、points = 現在の累計ポイント（任意）
 * table[n] … Lv.n に到達するのに必要な累計ポイント（table[0] = 0）
 */
const STORE_KEY = 'ttlv-data-v1';
const UI_KEY = 'ttlv-ui-v1';
const MAX_LV = 50;
const GOAL_LV = MAX_LV; // 目標は常に最大の Lv.50
const COLOR = '#25f4ee';

// 各レベルに到達するのに必要な累計ポイント（LEVEL_TABLE[0] = 未加入）
// 出典：ハートミーレベル一覧.xlsx の「累計Pt」列
const LEVEL_TABLE = [0,
  1, 100, 180, 280, 400, 530, 690, 880, 1090, 1350,
  1640, 1990, 2400, 2870, 3420, 4070, 4840, 5730, 6770, 7980,
  9400, 11100, 13000, 15300, 18000, 21100, 24700, 29000, 34000, 39800,
  46700, 54700, 64100, 75000, 87800, 102800, 120400, 141000, 165000, 191000,
  220000, 252000, 286000, 323000, 363000, 405000, 450000, 498000, 549000, 602000,
];

const DEFAULT_DATA = () => ({ version: 5, users: [] });

let data = load();
const ui = Object.assign(
  { tab: 'users', search: '', sort: 'updated', band: false, open: [] },
  loadJSON(UI_KEY) || {}
);
if (!['users', 'levels', 'table', 'settings'].includes(ui.tab)) ui.tab = 'users';
const openGroups = new Set(ui.open || []);

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function normalize(d) {
  if (!d || !Array.isArray(d.users)) return null;
  // v1/v2（複数レベル種別）からの移行：メンレベだけを引き継ぐ
  d.users.forEach((u) => {
    if (u.level == null) u.level = Number(u.levels?.member) || 0;
    delete u.levels; delete u.targets;
    u.level = clamp(Number(u.level) || 0, 0, MAX_LV);
    if (!Array.isArray(u.gains)) u.gains = [];
    if (!Array.isArray(u.plans)) u.plans = [];
  });
  delete d.categories; delete d.self; delete d.history; delete d.table; // レベル表は固定
  d.version = 5;
  return d;
}
function load() {
  return normalize(loadJSON(STORE_KEY)) || DEFAULT_DATA();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
  catch { toast('保存に失敗しました（容量不足の可能性）'); }
}
function saveUI() {
  ui.open = [...openGroups];
  try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* 無視 */ }
}

/* ========== ユーティリティ ========== */
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 起動時の load() から使うため関数宣言（巻き上げ）にしておく
function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
const num = (n) => Number(n).toLocaleString('ja-JP');
const userById = (id) => data.users.find((u) => u.id === id);

function hashColor(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `hsl(${h % 360} 75% 68%)`;
}
function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ========== ポイント計算 ========== */
const hasPoints = (u) => u.points != null && u.points !== '';
// 現在の累計ポイント（未入力なら今のレベルに到達した直後とみなす）
const curPoints = (u) => (hasPoints(u) ? Number(u.points) : LEVEL_TABLE[u.level]);
const toNext = (u) => (u.level >= MAX_LV ? 0 : Math.max(0, LEVEL_TABLE[u.level + 1] - curPoints(u)));
const toGoal = (u) => Math.max(0, LEVEL_TABLE[GOAL_LV] - curPoints(u));

/* ========== ポイント増加ペースと達成予定 ==========
 * gains[] = { type: 'daily' | 'weekly' | 'monthly', amount, days: [0-6]（毎週の曜日）, day: 1-31（毎月の日付） }
 * 入力済みポイントは「今日の分まで反映済み」とみなし、明日から加算して予測する
 */
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const PREDICT_DAYS = 365 * 100; // Lv.50 は必要ポイントが大きいので長めに予測する

function ruleMatches(r, d) {
  if (r.type === 'daily') return true;
  if (r.type === 'weekly') return (r.days || []).includes(d.getDay());
  if (r.type === 'monthly') {
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === Math.min(Number(r.day) || 1, last); // 31日指定は月末に読み替え
  }
  return false;
}
function ruleLabel(r) {
  if (r.type === 'daily') return '毎日';
  if (r.type === 'weekly') return `毎週 ${[...(r.days || [])].sort().map((i) => WEEKDAYS[i]).join('・')}`;
  return `毎月 ${r.day}日`;
}
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const hasGains = (u) => (u.gains || []).some((r) => r.amount > 0);
/* 追加予定 plans[] = { id, date: 'YYYY-MM-DD', time: 'HH:MM'（省略時 00:00）, amount }
 * 指定日時になったら一度だけ累計ポイントに加算する */
const planAt = (pl) => `${pl.date}T${pl.time || '00:00'}`;
const nowKey = () => { const d = new Date(); return `${dayKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const todaysPlansTotal = (u) => (u.plans || []).reduce((sum, pl) => sum + (pl.amount > 0 && pl.date === todayKey() ? pl.amount : 0), 0);
const hasPlans = (u) => (u.plans || []).some((pl) => pl.amount > 0);
const hasGrowth = (u) => hasGains(u) || hasPlans(u);
function plansByDay(u) {
  const m = new Map();
  for (const pl of u.plans || []) if (pl.amount > 0) m.set(pl.date, (m.get(pl.date) || 0) + pl.amount);
  return m;
}

// 必要累計ポイントの配列 → 各到達予定日（Date / 到達済みは今日 / 不明は undefined）
const predictCache = new Map();
function predict(u, needs) {
  const key = `${nowKey()}|${curPoints(u)}|${JSON.stringify(u.gains || [])}|${JSON.stringify(u.plans || [])}|${needs.join(',')}`;
  if (predictCache.has(key)) return predictCache.get(key);
  if (predictCache.size > 500) predictCache.clear();
  const result = predictRaw(u, needs);
  predictCache.set(key, result);
  return result;
}
function predictRaw(u, needs) {
  const result = new Map();
  let pts = curPoints(u) + todaysPlansTotal(u);
  const today = startOfToday();
  const pending = [...new Set(needs)].sort((a, b) => a - b).filter((n) => {
    if (pts >= n) { result.set(n, today); return false; }
    return true;
  });
  const rules = (u.gains || []).filter((r) => r.amount > 0);
  const plans = plansByDay(u);
  if ((!rules.length && !plans.size) || !pending.length) return result;
  // 増加ペースがなければ、最後の追加予定日までで打ち切る
  const lastPlan = [...plans.keys()].sort().pop();
  const limit = rules.length ? PREDICT_DAYS : Math.min(PREDICT_DAYS, Math.ceil((parseDayKey(lastPlan) - today) / 864e5));
  const d = new Date(today);
  for (let i = 0; i < limit && pending.length; i++) {
    d.setDate(d.getDate() + 1);
    pts += gainOn(u, d) + (plans.get(dayKey(d)) || 0);
    while (pending.length && pts >= pending[0]) result.set(pending.shift(), new Date(d));
  }
  return result;
}
// 追加予定ごとの「加算後の累計ポイント・レベル」（増加ペースも含めて日ごとに積み上げる）
function planTimeline(u) {
  const plans = [...(u.plans || [])].filter((pl) => pl.amount > 0).sort((a, b) => planAt(a).localeCompare(planAt(b)));
  if (!plans.length) return [];
  let pts = curPoints(u);
  const out = [];
  const d = startOfToday();
  const last = plans[plans.length - 1].date;
  let idx = 0;
  // 今日このあとの時刻の予定（今日の増加ペースは反映済み）
  const today = dayKey(d);
  while (idx < plans.length && plans[idx].date === today) {
    const before = levelFromPoints(pts);
    pts += plans[idx].amount;
    out.push({ plan: plans[idx], pts, prev: pts - plans[idx].amount, level: levelFromPoints(pts), before });
    idx++;
  }
  for (let i = 0; i < PREDICT_DAYS && dayKey(d) < last; i++) {
    d.setDate(d.getDate() + 1);
    const before = levelFromPoints(pts);
    pts += gainOn(u, d);
    const k = dayKey(d);
    while (idx < plans.length && plans[idx].date === k) {
      pts += plans[idx].amount;
      out.push({ plan: plans[idx], pts, prev: pts - plans[idx].amount, level: levelFromPoints(pts), before });
      idx++;
    }
  }
  return out;
}
function fmtYMD(d) {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}
// 今日から何年何か月何日後か（0 の単位は省略）
function fmtAfter(to) {
  const from = startOfToday();
  let y = to.getFullYear() - from.getFullYear();
  let m = to.getMonth() - from.getMonth();
  let dd = to.getDate() - from.getDate();
  if (dd < 0) { m--; dd += new Date(to.getFullYear(), to.getMonth(), 0).getDate(); }
  if (m < 0) { y--; m += 12; }
  const s = `${y ? `${y}年` : ''}${m ? `${m}か月` : ''}${dd ? `${dd}日` : ''}`;
  return s ? `${s}後` : '今日';
}
function etaHTML(u, need, date) {
  if (curPoints(u) >= need) return '<span class="up">ポイント到達済み</span>';
  if (!hasGrowth(u)) return '<span class="muted">増加ペース未設定</span>';
  if (!date) return `<span class="muted">${hasGains(u) ? '100年以上先' : '追加予定だけでは届きません'}</span>`;
  return `<span>達成予定 <b>${fmtYMD(date)}</b></span><span class="eta-after">${fmtAfter(date)}</span>`;
}

/* ========== 自動加算 ==========
 * accruedAt = ポイントを反映済みの最終日（YYYY-MM-DD）。起動時や日付が変わったときに、
 * その翌日から今日までの増加ペースを累計ポイントへ足し、必要ポイントに届いたらレベルも上げる
 */
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayKey = () => dayKey(new Date());
function parseDayKey(k) {
  const [y, m, d] = String(k).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}
const gainOn = (u, d) => (u.gains || []).reduce((sum, r) => sum + (r.amount > 0 && ruleMatches(r, d) ? r.amount : 0), 0);

function accrueAll() {
  const today = startOfToday();
  const tk = dayKey(today);
  const levelUps = [];
  let changed = false;
  for (const u of data.users) {
    const nk = nowKey();
    const due = (u.plans || []).filter((pl) => planAt(pl) <= nk);
    if (u.accruedAt === tk && !due.length) continue;
    const from = parseDayKey(u.accruedAt);
    changed = true;
    let add = 0;
    if (from && u.accruedAt !== tk && hasGains(u)) {
      const d = new Date(from);
      for (let i = 0; i < PREDICT_DAYS && d < today; i++) {
        d.setDate(d.getDate() + 1);
        add += gainOn(u, d);
      }
    }
    u.accruedAt = tk;
    // 日付が来た追加予定は加算して予定から外す
    add += due.reduce((sum, pl) => sum + (pl.amount > 0 ? pl.amount : 0), 0);
    u.plans = (u.plans || []).filter((pl) => planAt(pl) > nk);
    if (add <= 0) continue;
    u.points = curPoints(u) + add;
    const before = u.level;
    u.level = Math.max(u.level, levelFromPoints(u.points));
    if (u.level > before) levelUps.push(`${u.name} が Lv.${u.level} に到達`);
  }
  if (changed) save();
  if (levelUps.length) toast(levelUps.join(' / '));
  return changed;
}

/* ========== レベル・ポイントの連動 ==========
 * レベルを変えたらポイントをそのレベルの範囲に合わせ、ポイントを変えたらレベルを計算し直す
 */
function levelFromPoints(p) {
  let lv = 0;
  while (lv < MAX_LV && p >= LEVEL_TABLE[lv + 1]) lv++;
  return lv;
}
const pointsFitLevel = (p, lv) => p >= LEVEL_TABLE[lv] && (lv >= MAX_LV || p < LEVEL_TABLE[lv + 1]);

function setLevel(u, value) {
  const to = clamp(Math.round(Number(value) || 0), 0, MAX_LV);
  if (u.level === to) return false;
  u.level = to;
  if (!hasPoints(u) || !pointsFitLevel(Number(u.points), to)) u.points = LEVEL_TABLE[to];
  u.accruedAt = todayKey();
  u.updatedAt = Date.now();
  return true;
}
function setPoints(u, value) {
  const v = String(value ?? '').trim();
  u.points = v === '' ? null : Math.max(0, Math.round(Number(v) || 0));
  if (hasPoints(u)) u.level = levelFromPoints(u.points);
  u.accruedAt = todayKey(); // 手入力した値は今日の分まで含むとみなす
  u.updatedAt = Date.now();
}

/* ========== 共通パーツ ========== */
// アイコン：写真があれば写真、なければ名前の頭文字
function avatarHTML(u, cls = '') {
  if (u.avatar) return `<div class="avatar ${cls}"><img src="${esc(u.avatar)}" alt=""></div>`;
  return `<div class="avatar ${cls}" style="background:${hashColor(u.name)}">${esc([...(u.name || '?')][0])}</div>`;
}
// 一覧カード：Lv.50 達成までの進み具合
function pointsHTML(u) {
  if (u.level >= GOAL_LV) return '<div class="pts up">Lv.50 達成</div>';
  const goal = LEVEL_TABLE[GOAL_LV];
  const approx = hasPoints(u) ? '' : '最大 ';
  let eta;
  if (toGoal(u) <= 0) eta = '<span class="eta">ポイント到達済み</span>';
  else if (!hasGrowth(u)) eta = '<span class="eta muted">達成予定：増加ペース未設定</span>';
  else {
    const date = predict(u, [goal]).get(goal);
    eta = date
      ? `<span class="eta">達成予定 ${fmtYMD(date)}（${fmtAfter(date)}）</span>`
      : `<span class="eta muted">達成予定：${hasGains(u) ? '100年以上先' : '追加予定だけでは届きません'}</span>`;
  }
  return `<div class="pts"><span>${hasPoints(u) ? num(u.points) : '-'} / ${num(goal)}pt</span>
    <span>Lv.50まで <b>${approx}${num(toGoal(u))}pt</b></span>${eta}</div>`;
}
function progressBarHTML(u) {
  const pct = clamp((curPoints(u) / LEVEL_TABLE[GOAL_LV]) * 100, 0, 100);
  return `<div class="dist-bar thin"><i style="width:${pct}%;background:${COLOR}"></i></div>`;
}
function userRowHTML(u, extra = '') {
  const tags = (u.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('');
  return `
    <div class="user" data-user="${esc(u.id)}">
      ${avatarHTML(u)}
      <div class="info">
        <div class="name-row"><span class="name">${esc(u.name)}</span>
          <span class="badge" style="color:${COLOR}${u.level ? '' : ';opacity:.45'}">Lv.${u.level || '-'}<span class="muted"> / 50</span></span></div>
        ${u.handle ? `<div class="handle">@${esc(u.handle)}</div>` : ''}
        ${progressBarHTML(u)}
        ${pointsHTML(u)}
        ${tags ? `<div class="badges">${tags}</div>` : ''}
      </div>
      ${extra}
    </div>`;
}
function stepHTML(u) {
  return `<div class="mini-step">
    <button data-step="1" data-uid="${esc(u.id)}" aria-label="レベルを上げる">＋</button>
    <button data-step="-1" data-uid="${esc(u.id)}" aria-label="レベルを下げる">−</button>
  </div>`;
}
function emptyHTML(msg) {
  return `<div class="empty"><p>${msg}</p></div>`;
}

/* ========== 画面：推し（サマリー＋一覧） ========== */
function filteredUsers() {
  const q = ui.search.trim().toLowerCase();
  const list = data.users.filter((u) => !q || [u.name, u.handle, u.memo, ...(u.tags || [])].join(' ').toLowerCase().includes(q));
  const byName = (a, b) => a.name.localeCompare(b.name, 'ja');
  const sorters = {
    name: byName,
    level: (a, b) => b.level - a.level || byName(a, b),
    next: (a, b) => (a.level >= GOAL_LV) - (b.level >= GOAL_LV) || toNext(a) - toNext(b) || byName(a, b),
    updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
  };
  return list.sort(sorters[ui.sort] || sorters.updated);
}
function renderUsers() {
  const sortOpts = [['updated', '更新が新しい順'], ['name', '名前順'], ['level', 'メンレベが高い順'], ['next', '次のレベルまでが近い順']]
    .map(([v, l]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('');
  const list = filteredUsers();
  const users = data.users;
  const joined = users.filter((u) => u.level > 0);
  const avg = joined.length ? (joined.reduce((a, u) => a + u.level, 0) / joined.length).toFixed(1) : '-';
  const done = users.filter((u) => u.level >= GOAL_LV).length;
  return `
    <div class="stats">
      <div class="stat"><div class="label">推しライバー</div><div class="stat-row"><span class="value">${users.length}</span><span class="unit">人</span></div></div>
      <div class="stat"><div class="label">メンレベ平均</div><div class="stat-row"><span class="value" style="color:${COLOR}">${avg}</span></div></div>
      <div class="stat"><div class="label">Lv.50 達成</div><div class="stat-row"><span class="value">${done}</span><span class="unit">人</span></div></div>
    </div>
    <div class="toolbar">
      <input id="search" class="input grow" type="search" placeholder="名前・ID・タグで検索" value="${esc(ui.search)}">
      <select id="sort" class="input sort-select">${sortOpts}</select>
    </div>
    <p class="muted small" id="count">${list.length} / ${data.users.length} 人</p>
    <div id="userList">${list.length ? list.map((u) => userRowHTML(u)).join('') : emptyHTML(data.users.length ? '該当するライバーがいません' : '右下の「+」から推しライバーを登録しましょう')}</div>`;
}

/* ========== 画面：レベル別 ========== */
function renderLevels() {
  const groups = new Map();
  for (const u of data.users) {
    const v = u.level;
    let key, label, sortVal;
    if (v === 0) { key = 'unset'; label = '未加入'; sortVal = -1; }
    else if (ui.band) { const s = Math.floor((v - 1) / 10) * 10 + 1; key = `b${s}`; label = `Lv.${s}-${s + 9}`; sortVal = s; }
    else { key = `l${v}`; label = `Lv.${v}`; sortVal = v; }
    if (!groups.has(key)) groups.set(key, { key, label, sortVal, users: [] });
    groups.get(key).users.push(u);
  }
  const body = [...groups.values()].sort((a, b) => b.sortVal - a.sortVal).map((g) => {
    g.users.sort((a, b) => b.level - a.level || toNext(a) - toNext(b));
    const nextInfo = g.key.startsWith('l') && g.sortVal < MAX_LV
      ? `<span class="muted small">次まで ${num(LEVEL_TABLE[g.sortVal + 1] - LEVEL_TABLE[g.sortVal])}pt</span>` : '';
    return `<details class="lv-group" data-gid="${esc(g.key)}" ${openGroups.has(g.key) ? 'open' : ''}>
      <summary><span class="lv-num" style="background:${g.key === 'unset' ? 'var(--surface2);color:var(--muted)' : COLOR}">${esc(g.label)}</span>
      ${nextInfo}<span class="cnt">${g.users.length}人</span></summary>
      <div class="body">${g.users.map((u) => userRowHTML(u, stepHTML(u))).join('')}</div></details>`;
  }).join('');

  return `
    <div class="toolbar">
      <button class="btn small" id="bandToggle">${ui.band ? '10レベル刻み' : '1レベルごと'}</button>
      <button class="btn small" id="expandAll">すべて開く</button>
      <button class="btn small" id="collapseAll">すべて閉じる</button>
    </div>
    ${data.users.length ? body : emptyHTML('推しライバーを登録するとレベルごとに表示されます')}`;
}

/* ========== 画面：レベル表 ========== */
function renderTable() {
  const byLevel = new Map();
  for (const u of [...data.users].sort((a, b) => a.name.localeCompare(b.name, 'ja'))) {
    if (!byLevel.has(u.level)) byLevel.set(u.level, []);
    byLevel.get(u.level).push(u);
  }
  const rows = LEVEL_TABLE.slice(1).map((total, i) => {
    const lv = i + 1;
    const next = lv < MAX_LV ? num(LEVEL_TABLE[lv + 1] - total) : '最大';
    const oshi = byLevel.get(lv) || [];
    const names = oshi.map((u) => `<span class="oshi-name" data-user="${esc(u.id)}">${esc(u.name)}</span>`).join('、');
    return `<tr class="${MILESTONES.includes(lv) ? 'milestone' : ''}">
      <td>Lv.${lv}</td><td>${next}</td><td>${num(total)}</td><td class="oshi-cell">${names}</td></tr>`;
  }).join('');
  return `
    <p class="muted small table-note">各レベルに必要なポイントの一覧です。次のレベルまでの残りポイントや達成予定日は、この表をもとに計算しています。</p>
    <div class="level-table-wrap">
      <table class="level-table">
        <thead><tr><th>レベル</th><th>次Lvに必要</th><th>累計</th><th>推し</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ========== 画面：設定 ========== */
function renderSettings() {
  return `
    <div class="card"><h2>データ管理</h2>
      <p class="muted small">データはこの端末のブラウザ内に保存されます。機種変更や念のためのバックアップにはエクスポートをご利用ください。</p>
      <div class="row">
        <button class="btn" id="exportJson">JSONで保存</button>
        <button class="btn" id="importJson">JSONを読み込み</button>
        <button class="btn" id="exportCsv">CSVで保存</button>
      </div>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
      <button class="btn danger block" id="resetAll" style="margin-top:10px">すべてのデータを削除</button>
    </div>
    <div class="card"><h2>アプリについて</h2>
      <p class="muted small">ホーム画面に追加するとアプリとして起動でき、オフラインでも使えます。<br>
      iPhone：Safariの共有ボタンから「ホーム画面に追加」<br>Android / PC：ブラウザのメニューから「アプリをインストール」</p>
      <p class="muted small">推しライバー ${data.users.length}人</p>
    </div>`;
}

/* ========== 描画 ========== */
const TITLES = { users: '推し', levels: 'レベル別', table: 'レベル表', settings: '設定' };
const RENDER = { users: renderUsers, levels: renderLevels, table: renderTable, settings: renderSettings };

function render() {
  $('#pageTitle').textContent = TITLES[ui.tab];
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  $('#fab').hidden = ui.tab === 'settings' || ui.tab === 'table';
  $('#view').innerHTML = RENDER[ui.tab]();
  saveUI();
}
function refreshUserList() {
  const list = filteredUsers();
  $('#count').textContent = `${list.length} / ${data.users.length} 人`;
  $('#userList').innerHTML = list.length ? list.map((u) => userRowHTML(u)).join('') : emptyHTML('該当するライバーがいません');
}

/* ========== モーダル ========== */
const modal = $('#modal');
const modalForm = $('#modalForm');
/* モーダル表示中は背面をスクロールさせない（iOS でも効くよう body を固定する） */
let scrollLocks = 0;
let savedScrollY = 0;
function lockScroll() {
  if (scrollLocks++ > 0) return;
  savedScrollY = window.scrollY;
  Object.assign(document.body.style, { position: 'fixed', top: `-${savedScrollY}px`, left: '0', right: '0', width: '100%' });
}
function unlockScroll() {
  if (scrollLocks === 0 || --scrollLocks > 0) return;
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '', width: '' });
  window.scrollTo(0, savedScrollY);
}

function openModal(html, onSubmit, bind) {
  modalForm.className = '';
  modalForm.innerHTML = html;
  modalForm.onsubmit = (e) => {
    e.preventDefault();
    if (onSubmit(new FormData(modalForm)) !== false) modal.close();
  };
  modalForm.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => modal.close()));
  bind?.(modalForm);
  modalForm.tabIndex = -1;
  modalForm.autofocus = true;
  if (!modal.open) { lockScroll(); modalLocked = true; modal.showModal(); }
}
// 閉じたら背面のスクロール固定を解除（close イベントは環境によって遅れるため open 属性を監視）
let modalLocked = false;
new MutationObserver(() => {
  if (!modal.open && modalLocked) { modalLocked = false; unlockScroll(); }
}).observe(modal, { attributes: true, attributeFilter: ['open'] });

/* 達成予定の行（日付＋何日後）が 1 行に収まるよう、はみ出す分だけ文字を小さくする */
function fitOneLine(scope) {
  scope.querySelectorAll('.stage-eta, .plan-date').forEach((el) => {
    el.style.fontSize = '';
    if (!el.clientWidth) return; // 非表示中は測れないので次の描画で
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth && size > 8) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
  });
}
let fitQueued = false;
new MutationObserver(() => {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => { fitQueued = false; fitOneLine(modalForm); });
}).observe(modalForm, { childList: true, subtree: true });
window.addEventListener('resize', () => fitOneLine(modalForm));
// モーダルの外側は「上の空いている部分」をタップしたときだけ閉じる（横の誤タップでは閉じない）
modal.addEventListener('click', (e) => {
  if (e.target !== modal) return;
  if (e.clientY < modal.getBoundingClientRect().top) modal.close();
});

// アプリ内の確認ダイアログ（ブラウザ標準の confirm の代わり）
const PENCIL_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
function askConfirm({ title, message, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm';
    dlg.innerHTML = `
      ${danger ? `<div class="confirm-icon">${TRASH_ICON}</div>` : ''}
      <h3>${title}</h3>
      <p>${message}</p>
      <div class="row">
        <button type="button" class="btn" data-ans="0">キャンセル</button>
        <button type="button" class="btn ${danger ? 'primary' : 'accent'}" data-ans="1">${ok}</button>
      </div>`;
    const finish = (v) => { dlg.close(); dlg.remove(); unlockScroll(); resolve(v); };
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ans]');
      if (b) finish(b.dataset.ans === '1');
      else if (e.target === dlg) finish(false);
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    document.body.appendChild(dlg);
    lockScroll();
    dlg.showModal();
  });
}

function tiktokLink(u) {
  return u?.handle ? `<a class="btn small" href="https://www.tiktok.com/@${encodeURIComponent(u.handle)}" target="_blank" rel="noopener">TikTokで開く</a>` : '';
}

// 一覧からタップしたとき：詳細表示（編集ボタンで編集モードへ）
function openUserModal(userId) {
  const u = userId ? userById(userId) : null;
  if (u) openDetailModal(u); else openEditModal(null);
}

// 節目のレベル（40 のあとは 45 → 49 → 50）
const MILESTONES = [10, 20, 30, 40, 45, 49, 50];
const nextMilestone = (lv) => MILESTONES.find((m) => m > lv) ?? MAX_LV;

// 段階ごとの進捗：次のレベル／次の節目
function stagesHTML(u) {
  if (u.level >= MAX_LV) return '<p class="stage-done">Lv.50 達成</p>';
  const pts = curPoints(u);
  const approx = hasPoints(u) ? '' : '最大 ';
  const stages = [{ label: '次のレベル', lv: u.level + 1, from: LEVEL_TABLE[u.level] }];
  const milestone = nextMilestone(u.level);
  if (milestone !== u.level + 1) stages.push({ label: '次の節目', lv: milestone, from: 0 });
  const dates = predict(u, stages.map((st) => LEVEL_TABLE[st.lv]));
  return stages.map((st) => {
    const need = LEVEL_TABLE[st.lv];
    const span = Math.max(1, need - st.from);
    const pct = clamp(Math.floor(((pts - st.from) / span) * 100), 0, 100);
    return `<div class="stage">
      <div class="stage-head"><span>${st.label}<b>Lv.${st.lv}</b></span><span class="muted">${pct}%</span></div>
      <div class="dist-bar"><i style="width:${pct}%;background:${COLOR}"></i></div>
      <div class="stage-foot muted"><span>${num(pts)} / ${num(need)}pt</span><span>あと ${approx}${num(Math.max(0, need - pts))}pt</span></div>
      <div class="stage-eta">${etaHTML(u, need, dates.get(need))}</div>
    </div>`;
  }).join('');
}

// 追加予定の一覧・追加・削除。予定ごとに、加算後の「次のレベル」までの進み具合と達成予定日を表示する
function planProgressHTML(u, { pts, prev, level }) {
  const baseLv = levelFromPoints(prev); // 予定を足す直前のレベル
  const blocks = [];
  if (level > baseLv) {
    const range = level > baseLv + 1 ? `Lv.${baseLv + 1}〜${level}` : `Lv.${level}`;
    blocks.push(`<div class="stage">
      <div class="stage-head"><span><b class="lv-only">${range}</b></span><span class="up">達成</span></div>
      <div class="dist-bar"><i style="width:100%;background:${COLOR}"></i></div>
    </div>`);
  }
  if (level >= MAX_LV) {
    blocks.push('<p class="stage-done">Lv.50 達成</p>');
  } else {
    const from = LEVEL_TABLE[level];
    const need = LEVEL_TABLE[level + 1];
    const pct = clamp(Math.floor(((pts - from) / Math.max(1, need - from)) * 100), 0, 100);
    const date = predict(u, [need]).get(need);
    blocks.push(`<div class="stage">
      <div class="stage-head"><span><b class="lv-only">Lv.${level + 1}</b></span><span class="muted">${pct}%</span></div>
      <div class="dist-bar"><i style="width:${pct}%;background:${COLOR}"></i></div>
      <div class="stage-foot muted"><span>${num(pts)} / ${num(need)}pt</span><span>あと ${num(need - pts)}pt</span></div>
      <div class="stage-eta">${etaHTML(u, need, date)}</div>
    </div>`);
  }
  return blocks.join('');
}

function bindPlans(form, u, onChange) {
  const list = form.querySelector('#planList');
  const pForm = form.querySelector('#planForm');
  const openBtn = form.querySelector('#planOpen');
  const dateEl = form.querySelector('#planDate');
  const amountEl = form.querySelector('#planAmount');
  const timeEl = form.querySelector('#planTime');
  const previewEl = form.querySelector('#planPreview');
  const tomorrow = () => { const d = startOfToday(); d.setDate(d.getDate() + 1); return dayKey(d); };

  const renderList = () => {
    const rows = planTimeline(u);
    list.innerHTML = rows.length
      ? rows.map((row) => {
        const d = parseDayKey(row.plan.date);
        return `<div class="plan-item">
          <div class="plan-main">
            <span class="plan-date">${fmtYMD(d)}${row.plan.time ? ` ${row.plan.time}` : ''}<span class="muted small">（${fmtAfter(d)}）</span></span>
            <span class="plan-amount"><b>+${num(row.plan.amount)}pt</b>
              <button type="button" class="plan-del" data-pdel="${esc(row.plan.id)}" aria-label="削除">${TRASH_ICON}</button></span>
          </div>
          <div class="plan-sub">追加後 <b>${num(row.pts)}pt</b>（Lv.${row.level}）</div>
          <div class="plan-progress">${planProgressHTML(u, row)}</div>
        </div>`;
      }).join('')
      : '<p class="muted small plan-empty">予定はありません。「追加」から日付とポイントを登録すると、追加後のポイントや次のレベルの達成予定日が表示されます。</p>';
  };
  // 入力中の予定を加えた場合の結果をその場で表示
  const preview = () => {
    const amount = Math.round(Number(amountEl.value) || 0);
    if (amount <= 0 || !dateEl.value) { previewEl.innerHTML = ''; return; }
    const tmp = { ...u, plans: [...(u.plans || []), { id: 'preview', date: dateEl.value, time: timeEl.value, amount }] };
    const row = planTimeline(tmp).find((r) => r.plan.id === 'preview');
    previewEl.innerHTML = row
      ? `<div class="plan-sub">追加後 <b>${num(row.pts)}pt</b>（Lv.${row.level}）</div>${planProgressHTML(tmp, row)}`
      : '';
  };
  // 追加中は「閉じる・編集」を「キャンセル・追加する」に切り替え、タブとスライドも止める
  const openForm = () => {
    form.classList.add('plan-adding');
    pForm.hidden = false;
    dateEl.value = tomorrow();
    timeEl.value = '';
    amountEl.value = '';
    previewEl.innerHTML = '';
  };
  const closeForm = () => { form.classList.remove('plan-adding'); pForm.hidden = true; };

  dateEl.min = todayKey();
  openBtn.addEventListener('click', openForm);
  form.querySelector('#planCancel').addEventListener('click', closeForm);
  dateEl.addEventListener('input', preview);
  timeEl.addEventListener('input', preview);
  amountEl.addEventListener('input', preview);
  form.querySelector('#planAdd').addEventListener('click', () => {
    const amount = Math.round(Number(amountEl.value) || 0);
    if (amount <= 0) { toast('追加するポイントを入力してください'); amountEl.focus(); return; }
    if (!dateEl.value || dateEl.value < todayKey()) { toast('今日以降の日付を選んでください'); return; }
    const date = dateEl.value;
    const time = timeEl.value;
    u.plans = u.plans || [];
    u.plans.push({ id: uid(), date, time, amount });
    closeForm();
    accrueAll(); // すでに過ぎた日時ならすぐに加算する
    u.updatedAt = Date.now();
    save(); render(); onChange();
    toast(`${date.replace(/-/g, '/')}${time ? ` ${time}` : ''} に +${num(amount)}pt を予定しました`);
  });
  list.addEventListener('click', (e) => {
    const del = e.target.closest('[data-pdel]');
    if (!del) return;
    u.plans = u.plans.filter((pl) => pl.id !== del.dataset.pdel);
    save(); render(); onChange();
  });
  return renderList;
}

// 増加ペースの要約
function gainsSummary(u) {
  const rs = (u.gains || []).filter((r) => r.amount > 0);
  return rs.length ? rs.map((r) => `${ruleLabel(r)} +${num(r.amount)}pt`).join('<br>') : '<span class="muted">未設定</span>';
}

let refreshOpenDetail = null; // 開いている詳細画面を描き直す関数
function openDetailModal(u) {
  const rows = [
    ['累計ポイント', `<input class="input kv-input" id="dPts" type="number" inputmode="numeric" min="0" placeholder="-">`],
    ['増加ペース', `<span class="small">${gainsSummary(u)}</span>`],
  ];
  openModal(`
    <div class="lv-hero">
      <div class="lv-hero-top">
        ${avatarHTML(u, 'lg')}
        <div class="lv-hero-main">
          <div class="lv-hero-title" id="dLv"></div>
          <div class="lv-hero-name"><span class="name-chip">${esc(u.name)}</span>${u.handle ? `<span class="muted small">@${esc(u.handle)}</span>` : ''}</div>
        </div>
        <div class="head-actions">${tiktokLink(u)}<button type="button" class="icon-btn" id="toEdit" aria-label="編集" title="編集">${PENCIL_ICON}</button></div>
      </div>
      <div class="lv-hero-bar"><i id="dBar"></i><span id="dBarText"></span></div>
    </div>
    <div class="page-dots top" role="tablist">
      <button type="button" data-slide="0" class="active" aria-label="詳細"></button>
      <button type="button" data-slide="1" aria-label="追加"></button>
    </div>
    <div class="slider draggable">
      <div class="slides">
    <div class="slide">
    <dl class="kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <div class="stages" id="dStages"></div>
    </div>
    <div class="slide">
    <div class="quick-add">
      <div class="plans-head"><span>ポイントを追加</span></div>
      <div class="quick-row">
        <input class="input" type="number" inputmode="numeric" min="1" id="quickAmount" placeholder="追加するpt">
        <button type="button" class="btn accent" id="quickAdd">追加</button>
      </div>
      <div class="plan-sub" id="quickPreview"></div>
    </div>
    <div class="plans">
      <div class="plans-head"><span>追加予定</span><button type="button" class="btn small" id="planOpen">予定を追加</button></div>
      <div class="plan-form" id="planForm" hidden>
        <div class="plan-form-title">新しい予定</div>
        <div class="plan-inputs">
          <label><span>日付</span><input class="input" type="date" id="planDate"></label>
          <label><span>時刻</span><input class="input" type="time" id="planTime"></label>
        </div>
        <label class="plan-amount-field"><span>追加するpt</span><input class="input" type="number" inputmode="numeric" min="1" id="planAmount" placeholder="0"></label>
        <div class="plan-preview" id="planPreview"></div>
      </div>
      <div id="planList"></div>
    </div>
    </div>
      </div>
    </div>
    <div class="row" id="detailFoot">
      <button type="button" class="btn foot-normal" data-close>閉じる</button>
      <button type="button" class="btn foot-adding" id="planCancel">キャンセル</button>
      <button type="button" class="btn accent foot-adding" id="planAdd">追加する</button>
    </div>`,
  // Enter キーではモーダルを閉じず、ポイント入力を確定する
  () => {
    const active = document.activeElement;
    if (modalForm.classList.contains('plan-adding')) modalForm.querySelector('#planAdd').click();
    else if (active?.id === 'quickAmount') modalForm.querySelector('#quickAdd').click();
    else modalForm.querySelector('#dPts')?.blur();
    return false;
  },
  (form) => {
    const lvEl = form.querySelector('#dLv');
    const ptEl = form.querySelector('#dPts');
    const show = () => {
      lvEl.textContent = `レベル${u.level}`;
      // ゲージは「今のレベル → 次のレベル」の進み具合、数字は累計ポイント / 次のレベルの累計
      const pts = curPoints(u);
      const bar = form.querySelector('#dBar');
      const barText = form.querySelector('#dBarText');
      if (u.level >= MAX_LV) {
        bar.style.width = '100%';
        barText.textContent = `${num(pts)}/MAX`;
      } else {
        const from = LEVEL_TABLE[u.level]; const need = LEVEL_TABLE[u.level + 1];
        bar.style.width = `${clamp(((pts - from) / Math.max(1, need - from)) * 100, 0, 100)}%`;
        barText.textContent = `${num(pts)}/${num(need)}`;
      }
      ptEl.value = hasPoints(u) ? u.points : '';
      form.querySelector('#dStages').innerHTML = stagesHTML(u);
      renderPlans();
    };
    const renderPlans = bindPlans(form, u, () => show());
    show();
    refreshOpenDetail = () => { if (modal.open && form.contains(lvEl)) { show(); quickUpdate(); } };

    // ポイントをその場で追加 → 詳細の累計ポイント・メンレベに反映
    const quickEl = form.querySelector('#quickAmount');
    const quickPreview = form.querySelector('#quickPreview');
    const quickUpdate = () => {
      const amount = Math.round(Number(quickEl.value) || 0);
      quickPreview.innerHTML = amount > 0
        ? `追加後 <b>${num(curPoints(u) + amount)}pt</b>（Lv.${levelFromPoints(curPoints(u) + amount)}）`
        : `現在 <b>${num(curPoints(u))}pt</b>（Lv.${u.level || '-'}）`;
    };
    quickUpdate();
    quickEl.addEventListener('input', quickUpdate);
    form.querySelector('#quickAdd').addEventListener('click', () => {
      const amount = Math.round(Number(quickEl.value) || 0);
      if (amount <= 0) { toast('追加するポイントを入力してください'); return; }
      const before = u.level;
      setPoints(u, curPoints(u) + amount);
      quickEl.value = '';
      quickEl.blur();
      save(); render(); show(); quickUpdate();
      toast(`+${num(amount)}pt 追加しました${u.level !== before ? `（Lv.${u.level} に到達）` : ''}`);
    });
    ptEl.addEventListener('change', () => {
      const before = u.level;
      setPoints(u, ptEl.value);
      save(); render(); show();
      toast(u.level !== before ? `ポイントを保存しました（Lv.${u.level} に変更）` : 'ポイントを保存しました');
    });
    form.querySelector('#toEdit').addEventListener('click', () => openEditModal(u));
    // 「詳細」と「追加予定」を横スライドで切り替え（同じ方向に続けても回り込む）
    const tabs = form.querySelectorAll('[data-slide]');
    const slider = setupSlider(form, {
      drag: true,
      onChange: (i) => tabs.forEach((b) => b.classList.toggle('active', Number(b.dataset.slide) === i)),
    });
    tabs.forEach((b) => b.addEventListener('click', () => slider.to(Number(b.dataset.slide))));
  });
}

/* ---------- 追加・編集フォーム（基本情報／増加ペースの 2 画面） ---------- */
function basicFieldsHTML(u) {
  return `
    <div class="avatar-edit">
      <div id="avPreview">${avatarHTML({ name: u?.name || '?', avatar: u?.avatar }, 'xl')}</div>
      <div class="avatar-actions">
        <label class="btn small">写真を選ぶ<input type="file" accept="image/*" id="avFile" hidden></label>
        <button type="button" class="btn small" id="avClear" ${u?.avatar ? '' : 'hidden'}>写真を外す</button>
      </div>
      <input type="hidden" name="avatar" value="${esc(u?.avatar || '')}">
    </div>
    <div class="field"><label>ライバー名</label><input class="input" name="name" required maxlength="60" value="${esc(u?.name)}" autocomplete="off"></div>
    <div class="field"><label>ID</label><input class="input" name="handle" maxlength="60" value="${esc(u?.handle)}" autocomplete="off" autocapitalize="off"></div>
    <div class="auto-level"><span class="muted">メンレベ</span><b id="autoLv">Lv.${u?.level || '-'}</b></div>
    <div class="field"><label>現在ポイント</label>
      <input class="input" type="number" inputmode="numeric" min="0" name="points" value="${u && hasPoints(u) ? u.points : ''}">
    </div>
    <div class="field"><label>加入日</label><input class="input" type="date" name="joined" value="${esc(u?.joined)}"></div>
    <div class="field"><label>タグ</label><input class="input" name="tags" value="${esc((u?.tags || []).join(', '))}" placeholder="最推し, 歌枠"></div>`;
}

function paceFieldsHTML(u) {
  const find = (type) => (u?.gains || []).find((r) => r.type === type);
  const daily = find('daily'); const weekly = find('weekly'); const monthly = find('monthly');
  const wdays = new Set(weekly?.days || []);
  const mday = monthly?.day || new Date().getDate();
  const amount = (name, r) => `<input class="input" name="${name}" type="number" inputmode="numeric" min="0" value="${r?.amount || ''}" placeholder="0"><span class="muted small">pt</span>`;
  return `
    <p class="muted small pace-note">毎日・毎週・毎月は同じ日に重なるとすべて足されます。毎日0時を過ぎると累計ポイントに自動で加算されます。</p>
    <div class="pace-block"><div class="pace-title">毎日</div><div class="gain-row">${amount('gDaily', daily)}</div></div>
    <div class="pace-block"><div class="pace-title">毎週</div>
      <div class="wd">${WEEKDAYS.map((w, i) => `<button type="button" data-wd="${i}" class="${wdays.has(i) ? 'active' : ''}">${w}</button>`).join('')}</div>
      <div class="gain-row">${amount('gWeekly', weekly)}</div></div>
    <div class="pace-block"><div class="pace-title">毎月</div>
      <div class="gain-row"><select class="input month-day" name="gDay">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${i + 1 === mday ? 'selected' : ''}>${i + 1}日</option>`).join('')}</select>
      ${amount('gMonthly', monthly)}</div></div>
    <div class="pace-block"><div class="pace-title">これから7日間の増加</div><div class="week-preview" id="pacePreview"></div></div>`;
}

function readPace(form) {
  const n = (name) => Math.max(0, Math.round(Number(form.elements[name].value) || 0));
  const gains = [];
  if (n('gDaily')) gains.push({ type: 'daily', amount: n('gDaily') });
  const days = [...form.querySelectorAll('[data-wd].active')].map((b) => Number(b.dataset.wd)).sort();
  if (n('gWeekly') && days.length) gains.push({ type: 'weekly', amount: n('gWeekly'), days });
  if (n('gMonthly')) gains.push({ type: 'monthly', amount: n('gMonthly'), day: Number(form.elements.gDay.value) });
  return gains;
}

function bindPace(form) {
  const preview = form.querySelector('#pacePreview');
  const update = () => {
    const tmp = { gains: readPace(form) };
    const d = startOfToday();
    preview.innerHTML = Array.from({ length: 7 }, () => {
      d.setDate(d.getDate() + 1);
      const g = gainOn(tmp, d);
      return `<div class="${g ? 'on' : ''}"><span>${d.getMonth() + 1}/${d.getDate()}</span><span>${WEEKDAYS[d.getDay()]}</span><b>${g ? `+${num(g)}` : '-'}</b></div>`;
    }).join('');
  };
  form.querySelectorAll('[data-wd]').forEach((b) => b.addEventListener('click', () => { b.classList.toggle('active'); update(); }));
  ['gDaily', 'gWeekly', 'gMonthly', 'gDay'].forEach((name) => form.elements[name].addEventListener('input', update));
  update();
}

/* 2 画面を横に並べたスライダー。2 枚しかないので、同じ方向へ続けてスライドしても
 * 止まらずにもう一方の画面へ回り込む（ループ）。drag=false ならボタン操作のみ */
function setupSlider(form, { drag, onChange }) {
  const slider = form.querySelector('.slider');
  const track = slider.querySelector('.slides');
  const panels = [...track.children];
  let cur = 0;
  let busy = false;

  const place = (dir) => { // dir>0: もう一方を右に、dir<0: 左に置く
    const other = panels[1 - cur];
    if (dir > 0) track.append(panels[cur], other); else track.append(other, panels[cur]);
  };
  const setX = (pct, px = 0, anim = false) => {
    track.style.transition = anim ? 'transform .28s ease' : 'none';
    track.style.transform = `translateX(calc(${pct}% + ${px}px))`;
  };
  const afterAnim = (fn) => {
    const done = () => { track.removeEventListener('transitionend', done); clearTimeout(t); fn(); };
    const t = setTimeout(done, 400);
    track.addEventListener('transitionend', done);
  };
  const settle = (switched) => {
    if (switched) cur = 1 - cur;
    track.append(panels[cur], panels[1 - cur]);
    setX(0);
    busy = false;
  };
  const go = (dir) => {
    if (busy) return;
    busy = true;
    onChange?.(1 - cur); // 画面が動き出すのと同時に●○やボタンを切り替える
    place(dir);
    setX(dir > 0 ? 0 : -100);
    void track.offsetWidth; // 位置を確定させてからアニメーション
    setX(dir > 0 ? -100 : 0, 0, true);
    afterAnim(() => settle(true));
    slider.scrollIntoView({ block: 'nearest' });
  };

  if (drag) {
    let sx = 0; let sy = 0; let dx = 0; let dir = 0; let active = false; let decided = false;
    slider.addEventListener('pointerdown', (e) => {
      if (busy || e.button !== 0 || form.classList.contains('plan-adding') || e.target.closest(`input,select,textarea,${REPEAT_BTN}`)) return;
      sx = e.clientX; sy = e.clientY; dx = 0; dir = 0; active = true; decided = false;
    });
    slider.addEventListener('pointermove', (e) => {
      if (!active) return;
      const mx = e.clientX - sx; const my = e.clientY - sy;
      if (!decided) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        if (Math.abs(my) > Math.abs(mx)) { active = false; return; } // 縦スクロールを優先
        decided = true;
        try { slider.setPointerCapture(e.pointerId); } catch { /* 無視 */ }
      }
      dx = mx;
      const d = dx < 0 ? 1 : -1;
      if (d !== dir) { dir = d; place(dir); }
      setX(dir > 0 ? 0 : -100, dx);
    });
    const end = () => {
      if (!active) return;
      active = false;
      if (!decided) return;
      busy = true;
      const switched = Math.abs(dx) > slider.clientWidth * 0.2;
      if (switched) onChange?.(1 - cur);
      setX(switched ? (dir > 0 ? -100 : 0) : (dir > 0 ? 0 : -100), 0, true);
      afterAnim(() => settle(switched));
      // スライド直後のクリックでボタンが反応しないようにする
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      slider.addEventListener('click', swallow, true);
      setTimeout(() => slider.removeEventListener('click', swallow, true), 50);
    };
    slider.addEventListener('pointerup', end);
    slider.addEventListener('pointercancel', end);
  }

  return {
    get index() { return cur; },
    next: () => go(1),
    prev: () => go(-1),
    to: (i) => { if (i !== cur) go(i > cur ? 1 : -1); },
  };
}

function openEditModal(u) {
  const adding = !u;
  openModal(`
    <div class="modal-head"><h3>${adding ? '推しライバーを追加' : '推しライバーを編集'}</h3>
      ${adding ? '' : `<button type="button" class="icon-btn danger" id="delUser" aria-label="削除" title="削除">${TRASH_ICON}</button>`}</div>
    ${adding ? '' : `<div class="slide-tabs">
      <button type="button" data-slide="0" class="active">基本情報</button>
      <button type="button" data-slide="1">増加ペース</button>
    </div>`}
    <div class="slider${adding ? '' : ' draggable'}">
      <div class="slides">
        <div class="slide">${basicFieldsHTML(u)}</div>
        <div class="slide">${paceFieldsHTML(u)}</div>
      </div>
    </div>
    ${adding ? '<div class="page-dots" aria-hidden="true"><span class="active"></span><span></span></div>' : ''}
    <div class="row" id="editFoot"></div>`,
  (fd) => {
    if (adding && slider.index === 0) { goNext(); return false; } // 追加時の Enter は「次へ」
    const name = String(fd.get('name')).trim();
    if (!name) { slider.to(0); return false; }
    const now = Date.now();
    const t = u || { id: uid(), level: 0, createdAt: now };
    t.name = name;
    t.handle = String(fd.get('handle')).trim().replace(/^@/, '');
    t.avatar = String(fd.get('avatar') || '') || null;
    t.joined = String(fd.get('joined') || '');
    t.tags = String(fd.get('tags')).split(/[,、，]/).map((x) => x.trim()).filter(Boolean);
    t.gains = readPace(modalForm);
    t.updatedAt = now;
    if (adding) data.users.push(t);
    setPoints(t, fd.get('points')); // メンレベはポイントから自動で決まる // 入力した値は今日の分まで含むとみなし、明日から自動加算
    save(); render();
    toast(adding ? `${name} さんを追加しました` : '保存しました');
    if (!adding) { openDetailModal(t); return false; } // 編集後は詳細表示に戻る
  });

  const form = modalForm;
  const foot = form.querySelector('#editFoot');
  const tabs = form.querySelectorAll('[data-slide]');
  const dots = form.querySelectorAll('.page-dots span');
  const renderFoot = (i) => {
    tabs.forEach((b) => b.classList.toggle('active', Number(b.dataset.slide) === i));
    dots.forEach((d, n) => d.classList.toggle('active', n === i));
    if (!adding) {
      foot.innerHTML = `<button type="button" class="btn" id="cancelEdit">キャンセル</button>
        <button type="submit" class="btn primary">保存</button>`;
    } else if (i === 0) {
      foot.innerHTML = `<button type="button" class="btn" id="cancelEdit">キャンセル</button>
        <button type="button" class="btn primary" id="toNext">次へ</button>`;
    } else {
      foot.innerHTML = `<button type="button" class="btn" id="toPrev">戻る</button>
        <button type="submit" class="btn primary">保存</button>`;
    }
  };
  const slider = setupSlider(form, { drag: !adding, onChange: renderFoot });
  const goNext = () => { if (form.elements.name.reportValidity()) slider.next(); };
  renderFoot(0);

  foot.addEventListener('click', (e) => {
    const id = e.target.closest('button')?.id;
    if (id === 'toNext') goNext();
    if (id === 'toPrev') slider.prev();
    if (id === 'cancelEdit') { if (u) openDetailModal(u); else modal.close(); }
  });
  form.querySelector('#delUser')?.addEventListener('click', async () => {
    const ok = await askConfirm({
      title: `${esc(u.name)} さんを削除しますか？`,
      message: 'メンレベ・累計ポイント・増加ペースなど、この推しのデータはすべて消えます。<br>この操作は元に戻せません。',
      ok: '削除する',
      danger: true,
    });
    if (!ok) return;
    data.users = data.users.filter((x) => x.id !== u.id);
    save(); modal.close(); render(); toast('削除しました');
  });
  tabs.forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.slide);
    if (adding && i === 1) goNext(); else slider.to(i);
  }));
  const ptInput = form.elements.points;
  const autoLv = form.querySelector('#autoLv');
  // 0 のままフォーカスしたら空にして、そのまま入力できるようにする
  ptInput.addEventListener('focus', () => { if (ptInput.value.trim() !== '' && Number(ptInput.value) === 0) ptInput.value = ''; });
  // ポイントを入れたら、メンレベの表示を計算し直す
  ptInput.addEventListener('input', () => {
    const p = ptInput.value.trim();
    const lv = p === '' ? (u?.level || 0) : levelFromPoints(Math.max(0, Number(p) || 0));
    autoLv.textContent = `Lv.${lv || '-'}`;
  });
  bindPace(form);
  bindAvatar(form);
}

// 写真の範囲選択：ドラッグで位置、スライダー／ピンチ／ホイールで拡大縮小。
// 決定すると選んだ範囲を 256px の正方形に縮小して保存（端末内の容量を節約）
function openCropper(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load')); };
    img.onload = () => {
      const dlg = document.createElement('dialog');
      dlg.className = 'cropper';
      dlg.innerHTML = `
        <h3>アイコンにする範囲を選択</h3>
        <p class="muted small">ドラッグで位置を動かし、スライダーで拡大・縮小できます</p>
        <div class="crop-stage"><img src="${url}" alt="" draggable="false"><div class="crop-mask"></div></div>
        <div class="crop-zoom"><span>−</span><input type="range" min="1" max="4" step="0.01" value="1" aria-label="拡大"><span>＋</span></div>
        <div class="row">
          <button type="button" class="btn" data-ans="0">キャンセル</button>
          <button type="button" class="btn primary" data-ans="1">決定</button>
        </div>`;
      document.body.appendChild(dlg);
      lockScroll();
      dlg.showModal();

      const stage = dlg.querySelector('.crop-stage');
      const im = dlg.querySelector('.crop-stage img');
      const range = dlg.querySelector('input[type=range]');
      const W = img.naturalWidth; const H = img.naturalHeight;
      const S = stage.clientWidth;
      const base = S / Math.min(W, H); // 短い辺が枠いっぱいになる倍率
      let zoom = 1;
      let x = (S - W * base) / 2;
      let y = (S - H * base) / 2;
      const scale = () => base * zoom;
      const apply = () => {
        x = clamp(x, S - W * scale(), 0);
        y = clamp(y, S - H * scale(), 0);
        im.style.width = `${W * scale()}px`;
        im.style.height = `${H * scale()}px`;
        im.style.transform = `translate(${x}px, ${y}px)`;
      };
      const setZoom = (z, cx = S / 2, cy = S / 2) => {
        const px = (cx - x) / scale(); const py = (cy - y) / scale();
        zoom = clamp(z, 1, 4);
        x = cx - px * scale(); y = cy - py * scale();
        range.value = zoom;
        apply();
      };
      apply();
      range.addEventListener('input', () => setZoom(Number(range.value)));

      const pts = new Map();
      let pinch = 0;
      const local = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      stage.addEventListener('pointerdown', (e) => {
        try { stage.setPointerCapture(e.pointerId); } catch { /* 無視 */ }
        pts.set(e.pointerId, local(e));
        if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
      });
      stage.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId)) return;
        const prev = pts.get(e.pointerId);
        const now = local(e);
        pts.set(e.pointerId, now);
        if (pts.size === 1) {
          x += now[0] - prev[0]; y += now[1] - prev[1]; apply();
        } else if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (pinch) setZoom(zoom * (dist / pinch), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
          pinch = dist;
        }
      });
      const up = (e) => { pts.delete(e.pointerId); pinch = 0; };
      stage.addEventListener('pointerup', up);
      stage.addEventListener('pointercancel', up);
      stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9), ...local(e));
      }, { passive: false });

      const finish = (ok) => {
        let result = null;
        if (ok) {
          const size = 256;
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = size;
          canvas.getContext('2d').drawImage(img, -x / scale(), -y / scale(), S / scale(), S / scale(), 0, 0, size, size);
          result = canvas.toDataURL('image/jpeg', 0.85);
        }
        dlg.close(); dlg.remove(); URL.revokeObjectURL(url); unlockScroll();
        resolve(result);
      };
      dlg.addEventListener('click', (e) => { const b = e.target.closest('[data-ans]'); if (b) finish(b.dataset.ans === '1'); });
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    };
    img.src = url;
  });
}
function bindAvatar(form) {
  const hidden = form.elements.avatar;
  const preview = form.querySelector('#avPreview');
  const clearBtn = form.querySelector('#avClear');
  const show = () => {
    preview.innerHTML = avatarHTML({ name: form.elements.name.value.trim() || '?', avatar: hidden.value }, 'xl');
    clearBtn.hidden = !hidden.value;
  };
  form.querySelector('#avFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const result = await openCropper(file);
      if (result) { hidden.value = result; show(); }
    } catch { toast('画像を読み込めませんでした'); }
  });
  clearBtn.addEventListener('click', () => { hidden.value = ''; show(); });
  preview.addEventListener('click', () => form.querySelector('#avFile').click()); // アイコンをタップしても選べる
  form.elements.name.addEventListener('input', () => { if (!hidden.value) show(); });
}

/* ========== インポート / エクスポート ========== */
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 10);

function exportCsv() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['ライバー名', 'TikTok ID', 'メンレベ', '累計ポイント', '次のレベルまで', 'Lv.50まで', '加入日', 'タグ', 'メモ'];
  const rows = data.users.map((u) => [u.name, u.handle, u.level, hasPoints(u) ? u.points : '', toNext(u), toGoal(u), u.joined, (u.tags || []).join(' '), u.memo]);
  download(`tiktok-menleve-${stamp()}.csv`, '﻿' + [header, ...rows].map((r) => r.map(q).join(',')).join('\r\n'), 'text/csv');
}
function importJson(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let d;
    try { d = normalize(JSON.parse(reader.result)); } catch { d = null; }
    if (!d) { toast('ファイルの形式が正しくありません'); return; }
    const ok = await askConfirm({
      title: 'データを読み込みますか？',
      message: `推しライバー ${d.users.length}人のデータを読み込みます。<br>現在のデータは上書きされます。`,
      ok: '読み込む',
      danger: true,
    });
    if (!ok) return;
    data = d; save(); render(); toast('読み込みました');
  };
  reader.readAsText(file);
}

/* ========== イベント ========== */
document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  ui.tab = b.dataset.tab; render(); window.scrollTo(0, 0);
});
$('#fab').addEventListener('click', () => openUserModal());

const view = $('#view');
view.addEventListener('click', (e) => {
  const t = e.target;
  const step = t.closest('[data-step]');
  if (step) {
    e.stopPropagation(); e.preventDefault();
    const u = userById(step.dataset.uid);
    if (u && setLevel(u, u.level + Number(step.dataset.step))) {
      save(); render();
      toast(`${u.name}：メンレベ Lv.${u.level}${u.level === GOAL_LV ? '（Lv.50 達成）' : ''}`);
    }
    return;
  }
  const user = t.closest('[data-user]');
  if (user) { openUserModal(user.dataset.user); return; }

  switch (t.id) {
    case 'bandToggle': ui.band = !ui.band; render(); break;
    case 'expandAll': case 'collapseAll':
      view.querySelectorAll('.lv-group').forEach((d) => { d.open = t.id === 'expandAll'; });
      break;
    case 'exportJson': download(`tiktok-menleve-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json'); break;
    case 'exportCsv': exportCsv(); break;
    case 'importJson': $('#importFile').click(); break;
    case 'resetAll':
      askConfirm({ title: 'すべてのデータを削除しますか？', message: '推しライバーのデータをすべて削除します。<br>この操作は元に戻せません。', ok: '削除する', danger: true })
        .then((ok) => { if (ok) { data = DEFAULT_DATA(); save(); render(); toast('初期化しました'); } });
      break;
  }
});
view.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!d.matches?.('.lv-group')) return;
  d.open ? openGroups.add(d.dataset.gid) : openGroups.delete(d.dataset.gid);
  saveUI();
}, true);
view.addEventListener('input', (e) => {
  if (e.target.id === 'search') { ui.search = e.target.value; refreshUserList(); saveUI(); }
});
view.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'sort') { ui.sort = t.value; refreshUserList(); saveUI(); }
  if (t.id === 'importFile' && t.files[0]) { importJson(t.files[0]); t.value = ''; }
});

/* ========== 増減ボタンの長押しで連続増減 ========== */
const REPEAT_BTN = '[data-step],[data-dstep],[data-inc],[data-dec]';
document.addEventListener('pointerdown', (e) => {
  let btn = e.target.closest(REPEAT_BTN);
  if (!btn || e.button !== 0) return;
  // 一覧の再描画でボタンが作り直されても追えるよう、data属性からセレクタを作っておく
  const sel = [...btn.attributes].filter((a) => a.name.startsWith('data-'))
    .map((a) => `[${a.name}="${CSS.escape(a.value)}"]`).join('');
  let repeated = false;
  let delay = 150;
  let timer;
  const tick = () => {
    if (!btn.isConnected) btn = document.querySelector(sel);
    if (!btn) return stop();
    repeated = true;
    btn.click();
    delay = Math.max(40, delay * 0.85); // 押し続けるほど速くなる
    timer = setTimeout(tick, delay);
  };
  const stop = () => {
    clearTimeout(timer);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
    if (repeated) {
      // 長押し後に指を離したときの通常クリックで 1 つ余計に増減しないようにする
      const swallow = (ev) => { if (ev.target.closest?.(REPEAT_BTN)) { ev.stopPropagation(); ev.preventDefault(); } };
      document.addEventListener('click', swallow, true);
      setTimeout(() => document.removeEventListener('click', swallow, true), 50);
    }
  };
  timer = setTimeout(tick, 400);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
});
document.addEventListener('contextmenu', (e) => { if (e.target.closest(REPEAT_BTN)) e.preventDefault(); });

/* ========== PWA ========== */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredPrompt = e; $('#installBtn').hidden = false;
});
$('#installBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null; $('#installBtn').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('インストールしました'); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

accrueAll();
render();
// アプリを開いたまま日付が変わった場合や、バックグラウンドから戻ったときにも加算する
const accrueAndRefresh = () => { if (accrueAll()) { render(); refreshOpenDetail?.(); } };
setInterval(accrueAndRefresh, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) accrueAndRefresh(); });
