/* ================================================================
   ITUNGIN — Main App Logic
   ================================================================
   Single-file SPA. Hash-based routing. Sections:
     1.  Globals & config
     2.  Utils (formatRp, formatDate, toast, etc)
     3.  Supabase client
     4.  Auth (login, session, logout, role guard)
     5.  Router (view switching)
     6.  Data layer (fetch/save Supabase)
     7.  Dashboard
     8.  Input (Mode A + Mode B grid)
     9.  Rekap (monthly + CSV)
     10. Pengaturan (target + komisi)
     11. HPP & Profit (bahan + resep + tabel)
     12. Kasir / POS
     13. Init
================================================================ */

/* ============ 1. GLOBALS ============ */
const CFG = window.ITUNGIN_CONFIG;

const KATEGORI_PEMASUKAN = ['Dine-in', 'GoFood', 'GrabFood', 'ShopeeFood', 'WA / Langsung'];
const KATEGORI_PENGELUARAN = ['Bahan', 'Gaji', 'Sewa', 'Listrik & Gas', 'Packaging', 'Iklan', 'Lain-lain'];
const SATUAN_OPTIONS = ['kg', 'gram', 'liter', 'ml', 'pcs', 'porsi'];

// Cached state
let supa = null;
let session = null;           // { username, role }
let stateBahan = [];
let stateMenu = [];
let stateResep = [];          // all rows
let statePengaturan = null;
let cart = [];                // POS cart: [{menu_id, nama, harga, hpp, qty, catatan}]
let posChannel = 'Dine-in';
let posMetodeBayar = 'Tunai';
let posKategoriFilter = '';   // '' = semua
let currentPesananId = null;  // jika sudah "Kirim ke Dapur", id pesanan tersimpan

// Emoji placeholder per kategori (fallback kalau menu.foto_url kosong)
const KATEGORI_EMOJI = {
  'Sate': '🍢',
  'Sop': '🍲',
  'Minuman': '🥤',
  'Pelengkap': '🍚'
};

// Chart instances
let chartDaily = null;
let chartExpense = null;

/* ============ 2. UTILS ============ */
const $  = (sel, scope = document) => scope.querySelector(sel);
const $$ = (sel, scope = document) => Array.from(scope.querySelectorAll(sel));

const fmtRp = (n) => {
  const num = Number(n) || 0;
  return 'Rp ' + Math.round(num).toLocaleString('id-ID');
};
const fmtRpShort = (n) => {
  const num = Number(n) || 0;
  if (Math.abs(num) >= 1_000_000) return 'Rp ' + (num / 1_000_000).toFixed(1) + 'jt';
  if (Math.abs(num) >= 1_000) return 'Rp ' + Math.round(num / 1_000) + 'rb';
  return fmtRp(num);
};
const fmtPct = (n, digits = 1) => (Number(n) || 0).toFixed(digits) + '%';
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = (d instanceof Date) ? d : new Date(d);
  return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtDateShort = (d) => {
  const dt = (d instanceof Date) ? d : new Date(d);
  return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
};
const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};
const monthRange = (yyyyMm) => {
  const [y, m] = yyyyMm.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end   = new Date(y, m, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end:   end.toISOString().slice(0, 10),
    daysInMonth: end.getDate()
  };
};
const currentYearMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const parseNum = (v) => {
  if (v == null || v === '') return 0;
  const s = String(v).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};

// Format integer dengan titik ribuan: 100000 → "100.000"
const fmtNumber = (n) => {
  const num = Number(n) || 0;
  return num === 0 ? '' : num.toLocaleString('id-ID');
};

/* Auto-format input number sambil user ngetik.
   Pasang class "number-input" + type="text" + inputmode="numeric" ke field-nya. */
function formatNumberInputEl(input) {
  const oldValue = input.value;
  const cursor = input.selectionStart || 0;
  const digitsBeforeCursor = oldValue.substring(0, cursor).replace(/\D/g, '').length;

  const digits = oldValue.replace(/\D/g, '');
  const formatted = digits ? Number(digits).toLocaleString('id-ID') : '';
  if (formatted === oldValue) return;

  input.value = formatted;

  // Restore cursor di posisi digit yang sama
  let newCursor = 0, digitsCount = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (digitsCount === digitsBeforeCursor) break;
    if (/\d/.test(formatted[i])) digitsCount++;
    newCursor = i + 1;
  }
  if (newCursor === 0 && digitsBeforeCursor > 0) newCursor = formatted.length;
  try { input.setSelectionRange(newCursor, newCursor); } catch {}
}

// Event delegation — semua .number-input di seluruh app otomatis ke-format
document.addEventListener('input', (e) => {
  if (e.target.matches && e.target.matches('.number-input')) {
    formatNumberInputEl(e.target);
  }
});

function toast(msg, type = '') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.className = 'toast', 2400);
}

/* ============ 3. SUPABASE CLIENT ============ */
function initSupabase() {
  if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes('YOUR-PROJECT')) {
    showSetupWarning();
    return false;
  }
  supa = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  return true;
}

function showSetupWarning() {
  document.body.innerHTML = `
    <div style="max-width: 560px; margin: 80px auto; padding: 32px; background: #1f1611; border: 1px solid #f5a623; border-radius: 16px; color: #f4ead7; font-family: system-ui;">
      <h1 style="color: #f5a623; margin-bottom: 16px;">⚠️ Setup Supabase dulu</h1>
      <p style="margin-bottom: 12px;">Buka <code style="background:#16100c; padding:2px 8px; border-radius:4px;">assets/js/config.js</code> dan isi nilai <code>SUPABASE_URL</code> & <code>SUPABASE_ANON_KEY</code> dari project Supabase kamu.</p>
      <p style="margin-bottom: 12px;">Lihat <code>README.md</code> untuk panduan lengkap setup database & deployment.</p>
    </div>`;
}

/* ============ 4. AUTH ============ */
function loadSession() {
  try {
    const raw = localStorage.getItem('itungin_session');
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.username || !s.role) return null;
    return s;
  } catch { return null; }
}
function saveSession(s) { localStorage.setItem('itungin_session', JSON.stringify(s)); }
function clearSession() { localStorage.removeItem('itungin_session'); }

function applyAuthUI() {
  if (session) {
    document.body.classList.remove('unauthenticated');
    $('#navUserName').textContent = session.username;
    const roleLabel = session.role === 'admin' ? 'ADMIN' : session.role === 'kasir' ? 'KASIR' : 'VIEW';
    const roleEl = $('#navUserRole');
    roleEl.textContent = roleLabel;
    roleEl.className = 'role' + (session.role === 'view' ? ' view' : '');
    // Show/hide nav items by role
    $$('.nav-tabs a').forEach(a => {
      const allowedRoles = (a.dataset.role || '').split(',').filter(Boolean);
      if (allowedRoles.length === 0) { a.style.display = ''; return; }
      a.style.display = allowedRoles.includes(session.role) ? '' : 'none';
    });
  } else {
    document.body.classList.add('unauthenticated');
  }
}

function login() {
  const u = $('#loginUsername').value.trim().toLowerCase();
  const p = $('#loginPassword').value;
  const errEl = $('#loginError');
  errEl.classList.remove('show');

  const user = CFG.USERS.find(x => x.username.toLowerCase() === u);
  if (!user || p !== CFG.PASSWORD) {
    errEl.classList.add('show');
    return;
  }
  session = { username: user.username, role: user.role };
  saveSession(session);
  applyAuthUI();
  navigate(session.role === 'kasir' ? 'kasir' : 'dashboard');
}

function logout() {
  clearSession();
  session = null;
  applyAuthUI();
  navigate('login');
}

function canAccess(view) {
  if (!session) return view === 'login';
  if (view === 'login') return false;
  const adminOnly = ['input', 'hpp', 'pengaturan'];
  const adminAndKasir = ['kasir'];
  if (adminOnly.includes(view)) return session.role === 'admin';
  if (adminAndKasir.includes(view)) return session.role === 'admin' || session.role === 'kasir';
  return true;
}

/* ============ 5. ROUTER ============ */
function getViewFromHash() {
  const h = location.hash.replace(/^#\/?/, '');
  return h || (session ? (session.role === 'kasir' ? 'kasir' : 'dashboard') : 'login');
}

function navigate(view) {
  location.hash = '#/' + view;
}

function handleRoute() {
  let view = getViewFromHash();
  if (!session) view = 'login';
  if (!canAccess(view)) {
    view = session ? (session.role === 'kasir' ? 'kasir' : 'dashboard') : 'login';
    location.hash = '#/' + view;
    return;
  }

  $$('.view').forEach(s => s.classList.remove('active'));
  const target = $('#view-' + view);
  if (target) target.classList.add('active');

  $$('.nav-tabs a').forEach(a => {
    a.classList.toggle('active', a.dataset.view === view);
  });

  // Lazy-load view data
  if (view === 'dashboard')  loadDashboard();
  if (view === 'input')      loadInputView();
  if (view === 'rekap')      loadRekap();
  if (view === 'pengaturan') loadPengaturan();
  if (view === 'hpp')        loadHpp();
  if (view === 'kasir')      loadKasir();
}

/* ============ 6. DATA LAYER ============ */
async function fetchPengaturan() {
  const { data, error } = await supa.from('pengaturan').select('*').eq('id', 1).single();
  if (error && error.code !== 'PGRST116') console.error('fetchPengaturan', error);
  statePengaturan = data || {
    id: 1, target_bulanan: CFG.DEFAULT_TARGET_BULANAN,
    komisi_gofood: 20, komisi_grabfood: 20, komisi_shopeefood: 20, komisi_wa: 0, komisi_dinein: 0
  };
  return statePengaturan;
}
async function fetchTransaksi(dateFrom, dateTo) {
  let q = supa.from('transaksi').select('*').order('tanggal', { ascending: false });
  if (dateFrom) q = q.gte('tanggal', dateFrom);
  if (dateTo)   q = q.lte('tanggal', dateTo);
  const { data, error } = await q;
  if (error) { console.error(error); return []; }
  return data || [];
}
async function fetchBahan() {
  const { data, error } = await supa.from('bahan').select('*').order('nama');
  if (error) { console.error(error); return []; }
  stateBahan = data || [];
  return stateBahan;
}
async function fetchMenu() {
  const { data, error } = await supa.from('menu').select('*').order('urutan');
  if (error) { console.error(error); return []; }
  stateMenu = data || [];
  return stateMenu;
}
async function fetchResep() {
  const { data, error } = await supa.from('resep').select('*');
  if (error) { console.error(error); return []; }
  stateResep = data || [];
  return stateResep;
}
async function fetchPesanan(dateFrom, dateTo) {
  let q = supa.from('pesanan').select('*').eq('status', 'selesai').order('waktu', { ascending: false });
  if (dateFrom) q = q.gte('waktu', dateFrom + 'T00:00:00');
  if (dateTo)   q = q.lte('waktu', dateTo + 'T23:59:59');
  const { data, error } = await q;
  if (error) { console.error(error); return []; }
  return data || [];
}
async function fetchPesananItems(pesananIds) {
  if (!pesananIds.length) return [];
  const { data, error } = await supa.from('pesanan_item').select('*').in('pesanan_id', pesananIds);
  if (error) { console.error(error); return []; }
  return data || [];
}

/* ============ 7. DASHBOARD ============ */
async function loadDashboard() {
  const today = todayISO();
  const ym = currentYearMonth();
  const range = monthRange(ym);

  // Parallel fetch
  const [pengaturan, txMonth, pesananMonth] = await Promise.all([
    fetchPengaturan(),
    fetchTransaksi(range.start, range.end),
    fetchPesanan(range.start, range.end)
  ]);

  // Hitung pemasukan + pengeluaran dari transaksi manual
  const sumByDay = {};      // tanggal => { pemasukan, pengeluaran }
  const sumByChannel = {};  // channel => total pemasukan
  const sumByExpense = {};  // kategori => total pengeluaran
  txMonth.forEach(t => {
    const d = t.tanggal;
    sumByDay[d] ||= { pemasukan: 0, pengeluaran: 0 };
    const n = Number(t.nominal) || 0;
    if (t.tipe === 'pemasukan') {
      sumByDay[d].pemasukan += n;
      sumByChannel[t.kategori] = (sumByChannel[t.kategori] || 0) + n;
    } else {
      sumByDay[d].pengeluaran += n;
      sumByExpense[t.kategori] = (sumByExpense[t.kategori] || 0) + n;
    }
  });

  // POS pesanan: tambahkan ke pemasukan & channel breakdown
  const pesananIds = pesananMonth.map(p => p.id);
  const pesananItems = await fetchPesananItems(pesananIds);
  const itemsByPesanan = {};
  pesananItems.forEach(it => {
    (itemsByPesanan[it.pesanan_id] ||= []).push(it);
  });

  pesananMonth.forEach(p => {
    const d = p.waktu.slice(0, 10);
    sumByDay[d] ||= { pemasukan: 0, pengeluaran: 0 };
    const total = Number(p.total) || 0;
    sumByDay[d].pemasukan += total;
    // Channel mapping (POS channels)
    const ch = p.channel === 'Dine-in' ? 'Dine-in'
            : p.channel === 'WA'       ? 'WA / Langsung'
            : 'Dine-in'; // Take-away → ke Dine-in
    sumByChannel[ch] = (sumByChannel[ch] || 0) + total;
  });

  // Totals
  const todayData = sumByDay[today] || { pemasukan: 0, pengeluaran: 0 };
  const labaHariIni = todayData.pemasukan - todayData.pengeluaran;
  let totalPemasukanBulan = 0, totalPengeluaranBulan = 0;
  Object.values(sumByDay).forEach(d => {
    totalPemasukanBulan += d.pemasukan;
    totalPengeluaranBulan += d.pengeluaran;
  });
  const labaBulan = totalPemasukanBulan - totalPengeluaranBulan;
  const margin = totalPemasukanBulan > 0 ? (labaBulan / totalPemasukanBulan) * 100 : 0;
  const target = Number(pengaturan.target_bulanan) || 0;
  const progressPct = target > 0 ? Math.max(0, (labaBulan / target) * 100) : 0;

  // KPI display
  $('#kpiLabaHariIni').textContent = fmtRp(labaHariIni);
  $('#kpiLabaHariIni').className = 'kpi-value ' + (labaHariIni >= 0 ? 'positive' : 'negative');
  $('#kpiLabaHariIniSub').textContent = `Pemasukan ${fmtRpShort(todayData.pemasukan)} − Pengeluaran ${fmtRpShort(todayData.pengeluaran)}`;

  $('#kpiLabaBulan').textContent = fmtRp(labaBulan);
  $('#kpiLabaBulan').className = 'kpi-value ' + (labaBulan >= 0 ? 'positive' : 'negative');
  $('#kpiLabaBulanSub').textContent = `${fmtRpShort(totalPemasukanBulan)} pemasukan, ${fmtRpShort(totalPengeluaranBulan)} pengeluaran`;

  $('#kpiMargin').textContent = fmtPct(margin);
  $('#kpiProgressPct').textContent = fmtPct(progressPct, 0);
  $('#progressFill').style.width = Math.min(100, progressPct) + '%';
  $('#kpiProgressSub').textContent = `${fmtRpShort(labaBulan)} dari target ${fmtRpShort(target)}`;

  // Breakeven badge
  const breakevenOk = todayData.pemasukan >= todayData.pengeluaran && todayData.pemasukan > 0;
  const noData = todayData.pemasukan === 0 && todayData.pengeluaran === 0;
  $('#kpiBreakeven').innerHTML = noData
    ? `<span class="text-muted">Belum ada data</span>`
    : `<span class="breakeven-badge ${breakevenOk ? 'ok' : 'no'}">${breakevenOk ? '✓ Balik Modal' : '✗ Belum Balik Modal'}</span>`;
  $('#kpiBreakevenSub').textContent = noData ? '—' : `Selisih ${fmtRp(todayData.pemasukan - todayData.pengeluaran)}`;

  // Chart: daily pemasukan
  const labels = [];
  const dataDaily = [];
  for (let i = 1; i <= range.daysInMonth; i++) {
    const dateStr = `${ym}-${String(i).padStart(2, '0')}`;
    labels.push(i);
    dataDaily.push(sumByDay[dateStr]?.pemasukan || 0);
  }
  renderChartDaily(labels, dataDaily);

  // Chart: expense breakdown donut
  const expLabels = Object.keys(sumByExpense);
  const expData = Object.values(sumByExpense);
  renderChartExpense(expLabels, expData);

  // Channel list
  const channelEl = $('#channelList');
  if (Object.keys(sumByChannel).length === 0) {
    channelEl.innerHTML = '<li class="empty-state">Belum ada pemasukan bulan ini.</li>';
  } else {
    const sorted = Object.entries(sumByChannel).sort((a, b) => b[1] - a[1]);
    channelEl.innerHTML = sorted.map(([ch, n]) => {
      const pct = totalPemasukanBulan > 0 ? (n / totalPemasukanBulan) * 100 : 0;
      return `<li><span>${ch}</span><span><span class="nominal">${fmtRpShort(n)}</span><span class="pct">${fmtPct(pct, 0)}</span></span></li>`;
    }).join('');
  }

  // Menu paling untung (dari HPP)
  await loadTopMenuProfit();

  // POS today summary
  const todayPesanan = pesananMonth.filter(p => p.waktu.slice(0, 10) === today);
  const todayItems = todayPesanan.flatMap(p => itemsByPesanan[p.id] || []);
  const itemSummary = {};
  todayItems.forEach(it => {
    itemSummary[it.nama_menu] = (itemSummary[it.nama_menu] || 0) + it.qty;
  });
  const itemsEl = $('#todayItemsList');
  if (Object.keys(itemSummary).length === 0) {
    itemsEl.innerHTML = '<li class="empty-state">Belum ada pesanan kasir hari ini.</li>';
  } else {
    const totalQty = todayItems.reduce((s, it) => s + it.qty, 0);
    itemsEl.innerHTML = Object.entries(itemSummary)
      .sort((a, b) => b[1] - a[1])
      .map(([nama, qty]) => `<li><span>${nama}</span><span class="nominal">${qty}</span></li>`)
      .join('') + `<li style="border-top: 2px solid var(--ember); padding-top: 10px; margin-top: 4px; font-weight: 600;"><span>Total Item</span><span class="nominal">${totalQty}</span></li>`;
  }

  // Menu terlaris bulan ini
  const allPosItems = pesananMonth.flatMap(p => itemsByPesanan[p.id] || []);
  const monthSummary = {};
  allPosItems.forEach(it => {
    monthSummary[it.nama_menu] = (monthSummary[it.nama_menu] || 0) + it.qty;
  });
  const topEl = $('#topSellingList');
  if (Object.keys(monthSummary).length === 0) {
    topEl.innerHTML = '<li class="empty-state">Belum ada data POS bulan ini.</li>';
  } else {
    topEl.innerHTML = Object.entries(monthSummary)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([nama, qty]) => `<li><span>${nama}</span><span class="nominal">${qty}<span class="pct">terjual</span></span></li>`)
      .join('');
  }
}

async function loadTopMenuProfit() {
  const [pengaturan, bahanList, menuList, resepList] = await Promise.all([
    statePengaturan ? Promise.resolve(statePengaturan) : fetchPengaturan(),
    stateBahan.length ? Promise.resolve(stateBahan) : fetchBahan(),
    stateMenu.length ? Promise.resolve(stateMenu) : fetchMenu(),
    stateResep.length ? Promise.resolve(stateResep) : fetchResep()
  ]);

  const profits = menuList.map(m => {
    const hpp = computeHpp(m.id, resepList, bahanList);
    const profit = Number(m.harga_jual) - hpp;
    const margin = m.harga_jual > 0 ? (profit / m.harga_jual) * 100 : 0;
    return { nama: m.nama, harga: m.harga_jual, hpp, profit, margin };
  });

  const top = profits.filter(p => p.hpp > 0).sort((a, b) => b.profit - a.profit).slice(0, 6);
  const el = $('#topMenuProfit');
  if (top.length === 0) {
    el.innerHTML = '<li class="empty-state">Belum ada resep HPP. Set di tab HPP & Profit.</li>';
    return;
  }
  el.innerHTML = top.map(p =>
    `<li><span>${p.nama}</span><span><span class="nominal">${fmtRp(p.profit)}</span><span class="pct">${fmtPct(p.margin, 0)} margin</span></span></li>`
  ).join('');
}

function renderChartDaily(labels, data) {
  const ctx = $('#chartDaily').getContext('2d');
  if (chartDaily) chartDaily.destroy();
  chartDaily = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{
      label: 'Pemasukan', data,
      borderColor: '#e8732c',
      backgroundColor: 'rgba(232, 115, 44, 0.15)',
      borderWidth: 2, fill: true, tension: 0.3, pointRadius: 3
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtRp(c.parsed.y) } } },
      scales: {
        x: { grid: { color: 'rgba(244, 234, 215, 0.05)' }, ticks: { color: '#cdbfa8' } },
        y: { grid: { color: 'rgba(244, 234, 215, 0.05)' }, ticks: { color: '#cdbfa8', callback: v => fmtRpShort(v) } }
      }
    }
  });
}
function renderChartExpense(labels, data) {
  const ctx = $('#chartExpense').getContext('2d');
  if (chartExpense) chartExpense.destroy();
  if (labels.length === 0) {
    chartExpense = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: ['Belum ada pengeluaran'], datasets: [{ data: [1], backgroundColor: ['#2a1f17'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
    });
    return;
  }
  const colors = ['#e8732c', '#f5a623', '#c95f1e', '#a04416', '#5e2510', '#7c3d18', '#b85a20'];
  chartExpense = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors.slice(0, labels.length), borderColor: '#1f1611', borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '60%',
      plugins: {
        legend: { position: 'right', labels: { color: '#cdbfa8', font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.label}: ${fmtRp(c.parsed)}` } }
      }
    }
  });
}

/* ============ 8. INPUT (Mode A + Mode B) ============ */
let inputMode = 'A';

function loadInputView() {
  const dateInput = $('#inputDate');
  if (!dateInput.value) dateInput.value = todayISO();
  buildModeAInputs();
  refreshTodayEntries();
  if (inputMode === 'B') buildBulkGrid();
}

function buildModeAInputs() {
  const peEl = $('#pemasukanInputs');
  const pgEl = $('#pengeluaranInputs');
  peEl.innerHTML = KATEGORI_PEMASUKAN.map(k => modeARow('pemasukan', k)).join('');
  pgEl.innerHTML = KATEGORI_PENGELUARAN.map(k => modeARow('pengeluaran', k)).join('');
  $$('.mode-a-input').forEach(inp => inp.addEventListener('input', recalcModeATotal));
  recalcModeATotal();
}
function modeARow(tipe, kategori) {
  return `<div class="input-row">
    <label>${kategori}</label>
    <span class="rp-prefix">Rp</span>
    <input type="text" inputmode="numeric" class="mode-a-input number-input" data-tipe="${tipe}" data-kategori="${kategori}" placeholder="0" autocomplete="off" />
  </div>`;
}
function recalcModeATotal() {
  let totalPe = 0, totalPg = 0;
  $$('.mode-a-input').forEach(inp => {
    const n = parseNum(inp.value);
    if (inp.dataset.tipe === 'pemasukan') totalPe += n; else totalPg += n;
  });
  $('#totalPemasukan').textContent = fmtRp(totalPe);
  $('#totalPengeluaran').textContent = fmtRp(totalPg);
  const laba = totalPe - totalPg;
  const labaEl = $('#totalLaba');
  labaEl.textContent = fmtRp(laba);
  labaEl.className = 'value ' + (laba < 0 ? 'negative' : '');
}

async function saveModeA() {
  const tanggal = $('#inputDate').value || todayISO();
  const rows = [];
  $$('.mode-a-input').forEach(inp => {
    const n = parseNum(inp.value);
    if (n > 0) {
      rows.push({
        tanggal, tipe: inp.dataset.tipe, kategori: inp.dataset.kategori,
        nominal: n, dibuat_oleh: session.username
      });
    }
  });
  if (rows.length === 0) { toast('Tidak ada angka yang diisi.', 'error'); return; }

  const btn = $('#saveModeABtn');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  const { error } = await supa.from('transaksi').insert(rows);
  btn.disabled = false; btn.textContent = '💾 Simpan Data Hari Ini';
  if (error) { toast('Gagal simpan: ' + error.message, 'error'); return; }
  toast(`Tersimpan ${rows.length} entri untuk ${fmtDateShort(tanggal)}`, 'success');
  $$('.mode-a-input').forEach(inp => inp.value = '');
  recalcModeATotal();
  refreshTodayEntries();
}

function clearModeA() {
  if (!confirm('Reset semua input?')) return;
  $$('.mode-a-input').forEach(inp => inp.value = '');
  recalcModeATotal();
}

async function refreshTodayEntries() {
  const tanggal = $('#inputDate').value || todayISO();
  const { data, error } = await supa.from('transaksi').select('*').eq('tanggal', tanggal).order('created_at', { ascending: false });
  const el = $('#todayEntries');
  if (error || !data || data.length === 0) {
    el.innerHTML = '<div class="empty-state">Belum ada entri untuk tanggal ini.</div>';
    return;
  }
  el.innerHTML = data.map(t => `
    <div class="entry-row" data-id="${t.id}">
      <span class="date">${fmtDateShort(t.tanggal)}</span>
      <span class="kategori">
        <span class="tipe-badge ${t.tipe}">${t.tipe === 'pemasukan' ? 'Masuk' : 'Keluar'}</span>
        ${t.kategori}
      </span>
      <span class="nominal ${t.tipe}">${t.tipe === 'pengeluaran' ? '−' : '+'} ${fmtRp(t.nominal)}</span>
      <button class="icon-btn delete" data-delete="${t.id}" title="Hapus">🗑</button>
    </div>
  `).join('');
  $$('[data-delete]', el).forEach(b => b.addEventListener('click', () => deleteEntry(b.dataset.delete)));
}

async function deleteEntry(id) {
  if (!confirm('Hapus entri ini?')) return;
  const { error } = await supa.from('transaksi').delete().eq('id', id);
  if (error) { toast('Gagal hapus.', 'error'); return; }
  toast('Entri dihapus.');
  refreshTodayEntries();
}

/* === MODE B — Bulk Grid === */
function buildBulkGrid() {
  const ALL_COLS = [
    ...KATEGORI_PEMASUKAN.map(k => ({ tipe: 'pemasukan', kategori: k })),
    ...KATEGORI_PENGELUARAN.map(k => ({ tipe: 'pengeluaran', kategori: k }))
  ];

  const thead = $('#bulkGrid thead');
  thead.innerHTML = `<tr>
    <th class="col-tanggal">Tanggal</th>
    ${KATEGORI_PEMASUKAN.map(k => `<th class="col-pemasukan">${k}</th>`).join('')}
    ${KATEGORI_PENGELUARAN.map(k => `<th class="col-pengeluaran">${k}</th>`).join('')}
    <th class="col-action"></th>
  </tr>`;

  const tbody = $('#bulkGrid tbody');
  tbody.innerHTML = '';
  addBulkRow(todayISO());

  // Paste from spreadsheet
  $('#bulkGrid').addEventListener('paste', handleBulkPaste);
}

function addBulkRow(date = '') {
  const tbody = $('#bulkGrid tbody');
  const tr = document.createElement('tr');
  tr.className = 'row-new';
  tr.innerHTML = `
    <td class="col-tanggal"><input type="date" value="${date}" /></td>
    ${KATEGORI_PEMASUKAN.map(k => `<td><input type="text" class="cell number-input" inputmode="numeric" data-tipe="pemasukan" data-kategori="${k}" placeholder="0" autocomplete="off" /></td>`).join('')}
    ${KATEGORI_PENGELUARAN.map(k => `<td><input type="text" class="cell number-input" inputmode="numeric" data-tipe="pengeluaran" data-kategori="${k}" placeholder="0" autocomplete="off" /></td>`).join('')}
    <td class="col-action"><button class="row-delete" title="Hapus baris">🗑</button></td>`;
  tbody.appendChild(tr);
  tr.querySelector('.row-delete').addEventListener('click', () => {
    if (tbody.children.length > 1) tr.remove();
  });
  // Enter to next cell
  $$('.cell, input[type="date"]', tr).forEach((inp, i, arr) => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const next = arr[i + 1];
        if (next) next.focus(); else addBulkRow(todayISO());
      }
    });
  });
}

function handleBulkPaste(e) {
  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
  e.preventDefault();
  const target = e.target;
  if (!target.matches('input')) return;

  const tr = target.closest('tr');
  const tds = Array.from(tr.children);
  const startColIdx = tds.indexOf(target.closest('td'));
  const tbody = $('#bulkGrid tbody');
  const startRowIdx = Array.from(tbody.children).indexOf(tr);

  const rows = text.trim().split(/\r?\n/).map(r => r.split('\t'));
  rows.forEach((cells, rOffset) => {
    let row = tbody.children[startRowIdx + rOffset];
    if (!row) { addBulkRow(todayISO()); row = tbody.lastElementChild; }
    cells.forEach((val, cOffset) => {
      const td = row.children[startColIdx + cOffset];
      if (!td) return;
      const inp = td.querySelector('input');
      if (!inp) return;
      if (inp.type === 'date') {
        inp.value = val.trim();
      } else {
        const n = parseNum(val);
        inp.value = n > 0 ? fmtNumber(n) : '';
      }
    });
  });
  toast(`Paste ${rows.length} baris.`);
}

async function saveBulk() {
  const tbody = $('#bulkGrid tbody');
  const rows = [];
  Array.from(tbody.children).forEach(tr => {
    const dateInp = tr.querySelector('input[type="date"]');
    const tanggal = dateInp?.value;
    if (!tanggal) return;
    $$('.cell', tr).forEach(inp => {
      const n = parseNum(inp.value);
      if (n > 0) {
        rows.push({
          tanggal, tipe: inp.dataset.tipe, kategori: inp.dataset.kategori,
          nominal: n, dibuat_oleh: session.username
        });
      }
    });
  });
  if (rows.length === 0) { toast('Gak ada angka untuk disimpan.', 'error'); return; }
  $('#bulkStatus').textContent = 'Menyimpan ' + rows.length + ' entri…';
  const btn = $('#saveBulkBtn');
  btn.disabled = true;
  const { error } = await supa.from('transaksi').insert(rows);
  btn.disabled = false;
  if (error) { $('#bulkStatus').textContent = 'Gagal: ' + error.message; toast('Gagal simpan.', 'error'); return; }
  $('#bulkStatus').textContent = `✓ ${rows.length} entri tersimpan`;
  toast(`Tersimpan ${rows.length} entri.`, 'success');
  // Reset grid
  tbody.innerHTML = '';
  addBulkRow(todayISO());
}

/* ============ 9. REKAP ============ */
async function loadRekap() {
  const monthInput = $('#rekapMonth');
  if (!monthInput.value) monthInput.value = currentYearMonth();
  await renderRekap();
}
async function renderRekap() {
  const ym = $('#rekapMonth').value || currentYearMonth();
  const range = monthRange(ym);
  const [tx, pesananMonth] = await Promise.all([
    fetchTransaksi(range.start, range.end),
    fetchPesanan(range.start, range.end)
  ]);

  const byDay = {};
  tx.forEach(t => {
    const d = t.tanggal;
    byDay[d] ||= { pemasukan: 0, pengeluaran: 0 };
    const n = Number(t.nominal) || 0;
    if (t.tipe === 'pemasukan') byDay[d].pemasukan += n; else byDay[d].pengeluaran += n;
  });
  pesananMonth.forEach(p => {
    const d = p.waktu.slice(0, 10);
    byDay[d] ||= { pemasukan: 0, pengeluaran: 0 };
    byDay[d].pemasukan += Number(p.total) || 0;
  });

  // Build per-day rows
  const days = [];
  for (let i = 1; i <= range.daysInMonth; i++) {
    const dateStr = `${ym}-${String(i).padStart(2, '0')}`;
    const d = byDay[dateStr] || { pemasukan: 0, pengeluaran: 0 };
    days.push({ date: dateStr, ...d, laba: d.pemasukan - d.pengeluaran });
  }
  const totals = days.reduce((acc, d) => {
    acc.pemasukan += d.pemasukan; acc.pengeluaran += d.pengeluaran; acc.laba += d.laba;
    return acc;
  }, { pemasukan: 0, pengeluaran: 0, laba: 0 });
  const activeDays = days.filter(d => d.pemasukan > 0 || d.pengeluaran > 0).length;
  const avg = activeDays > 0 ? totals.laba / activeDays : 0;

  const el = $('#rekapContent');
  el.innerHTML = `
    <table class="rekap-table">
      <thead>
        <tr><th>Tanggal</th><th>Pemasukan</th><th>Pengeluaran</th><th>Laba Bersih</th></tr>
      </thead>
      <tbody>
        ${days.map(d => `
          <tr ${(d.pemasukan === 0 && d.pengeluaran === 0) ? 'style="opacity:0.4"' : ''}>
            <td>${fmtDate(d.date)}</td>
            <td>${fmtRp(d.pemasukan)}</td>
            <td>${fmtRp(d.pengeluaran)}</td>
            <td class="${d.laba > 0 ? 'laba-positive' : d.laba < 0 ? 'laba-negative' : ''}">${fmtRp(d.laba)}</td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr class="total-row">
          <td>Total Bulan Ini</td>
          <td>${fmtRp(totals.pemasukan)}</td>
          <td>${fmtRp(totals.pengeluaran)}</td>
          <td class="${totals.laba >= 0 ? 'laba-positive' : 'laba-negative'}">${fmtRp(totals.laba)}</td>
        </tr>
        <tr class="total-row" style="border-top: 1px solid var(--line);">
          <td>Rata-rata per Hari Aktif (${activeDays} hari)</td>
          <td></td><td></td>
          <td>${fmtRp(avg)}</td>
        </tr>
      </tfoot>
    </table>`;
}

function exportCsv() {
  const ym = $('#rekapMonth').value || currentYearMonth();
  const range = monthRange(ym);
  fetchTransaksi(range.start, range.end).then(async (tx) => {
    const pesananMonth = await fetchPesanan(range.start, range.end);
    const lines = ['Tanggal,Tipe,Kategori,Nominal,Catatan,Dibuat Oleh'];
    tx.forEach(t => {
      lines.push([t.tanggal, t.tipe, t.kategori, t.nominal, JSON.stringify(t.catatan || ''), t.dibuat_oleh || ''].join(','));
    });
    pesananMonth.forEach(p => {
      lines.push([p.waktu.slice(0, 10), 'pemasukan', p.channel + ' (POS)', p.total, `"Pesanan #${p.id}"`, p.kasir || ''].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `rekap-${ym}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast('CSV diunduh.', 'success');
  });
}

/* ============ 10. PENGATURAN ============ */
async function loadPengaturan() {
  const p = await fetchPengaturan();
  $('#settingTarget').value = fmtNumber(p.target_bulanan);
  $('#komisiGofood').value  = p.komisi_gofood;
  $('#komisiGrab').value    = p.komisi_grabfood;
  $('#komisiShopee').value  = p.komisi_shopeefood;
  $('#komisiWa').value      = p.komisi_wa;
}

async function savePengaturan() {
  const target  = parseNum($('#settingTarget').value);
  const kGo     = parseNum($('#komisiGofood').value);
  const kGrab   = parseNum($('#komisiGrab').value);
  const kShopee = parseNum($('#komisiShopee').value);
  const kWa     = parseNum($('#komisiWa').value);

  const btn = $('#saveSettingsBtn');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  const { error } = await supa.from('pengaturan').upsert({
    id: 1,
    target_bulanan: target,
    komisi_gofood: kGo,
    komisi_grabfood: kGrab,
    komisi_shopeefood: kShopee,
    komisi_wa: kWa,
    komisi_dinein: 0
  });
  btn.disabled = false; btn.textContent = '💾 Simpan Pengaturan';
  if (error) { toast('Gagal: ' + error.message, 'error'); return; }
  statePengaturan = null; // invalidate cache
  toast('Pengaturan tersimpan.', 'success');
}

/* ============ 11. HPP & PROFIT ============ */
let hppTab = 'hitung';

async function loadHpp() {
  await Promise.all([fetchBahan(), fetchMenu(), fetchResep(), fetchPengaturan()]);
  showHppTab(hppTab);
}
function showHppTab(tab) {
  hppTab = tab;
  $$('#hppTabs button').forEach(b => b.classList.toggle('active', b.dataset.hppTab === tab));
  $('#hppHitung').style.display = tab === 'hitung' ? '' : 'none';
  $('#hppMenu').style.display   = tab === 'menu'   ? '' : 'none';
  $('#hppBahan').style.display  = tab === 'bahan'  ? '' : 'none';
  $('#hppResep').style.display  = tab === 'resep'  ? '' : 'none';
  if (tab === 'hitung') renderHppTable();
  if (tab === 'menu')   renderMenuTable();
  if (tab === 'bahan')  renderBahanTable();
  if (tab === 'resep')  renderResepPicker();
}

function computeHpp(menuId, resepList = stateResep, bahanList = stateBahan) {
  const items = resepList.filter(r => r.menu_id === menuId);
  let total = 0;
  items.forEach(r => {
    const b = bahanList.find(x => x.id === r.bahan_id);
    if (!b) return;
    total += Number(r.jumlah) * Number(b.harga_per_satuan);
  });
  return total;
}

function renderHppTable() {
  const p = statePengaturan;
  const thead = $('#hppTable thead');
  thead.innerHTML = `
    <tr>
      <th class="menu-col">Menu</th>
      <th>Harga Jual</th>
      <th>HPP</th>
      <th>Profit (WA/Dine-in)</th>
      <th>Margin %</th>
      <th class="channel-header">GoFood −${p.komisi_gofood}%</th>
      <th class="channel-header">Grab −${p.komisi_grabfood}%</th>
      <th class="channel-header">Shopee −${p.komisi_shopeefood}%</th>
    </tr>`;

  const tbody = $('#hppTable tbody');
  if (stateMenu.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Belum ada menu. Tambah resep di tab "Resep Menu".</td></tr>`;
    return;
  }
  tbody.innerHTML = stateMenu.map(m => {
    const hpp = computeHpp(m.id);
    const harga = Number(m.harga_jual);
    const profit = harga - hpp;
    const margin = harga > 0 ? (profit / harga) * 100 : 0;
    const profitChannel = (komisiPct) => (harga * (1 - komisiPct / 100)) - hpp;
    const pGo     = profitChannel(p.komisi_gofood);
    const pGrab   = profitChannel(p.komisi_grabfood);
    const pShopee = profitChannel(p.komisi_shopeefood);
    const cls = (n) => n > 0 ? 'profit-positive' : n < 0 ? 'profit-negative' : '';
    const marginCls = margin >= 50 ? 'margin-good' : margin >= 25 ? 'margin-thin' : 'profit-negative';
    return `<tr>
      <td class="menu-col">${m.nama}</td>
      <td>${fmtRp(harga)}</td>
      <td>${fmtRp(hpp)}</td>
      <td class="${cls(profit)}">${fmtRp(profit)}</td>
      <td class="${marginCls}">${fmtPct(margin, 0)}</td>
      <td class="${cls(pGo)} channel-group">${fmtRp(pGo)}</td>
      <td class="${cls(pGrab)} channel-group">${fmtRp(pGrab)}</td>
      <td class="${cls(pShopee)} channel-group">${fmtRp(pShopee)}</td>
    </tr>`;
  }).join('');
}

function renderBahanTable() {
  const tbody = $('#bahanTable tbody');
  if (stateBahan.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Belum ada bahan. Klik "+ Tambah Bahan".</td></tr>`;
    return;
  }
  tbody.innerHTML = stateBahan.map(b => `
    <tr class="bahan-row" data-id="${b.id}">
      <td><input type="text" class="bahan-nama" value="${b.nama}" placeholder="Nama bahan" /></td>
      <td><select class="bahan-satuan">${SATUAN_OPTIONS.map(s => `<option ${s === b.satuan ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td class="harga"><input type="text" class="bahan-harga number-input" inputmode="numeric" value="${fmtNumber(b.harga_per_satuan)}" autocomplete="off" /></td>
      <td><input type="text" class="bahan-catatan" value="${b.catatan || ''}" placeholder="opsional" /></td>
      <td><button class="row-delete" data-del-bahan="${b.id}" title="Hapus">🗑</button></td>
    </tr>
  `).join('');

  // Wire up auto-save on blur
  $$('.bahan-row', tbody).forEach(row => {
    const id = row.dataset.id;
    const inputs = $$('input, select', row);
    inputs.forEach(inp => {
      inp.addEventListener('blur', () => updateBahan(id, row));
    });
    row.querySelector('[data-del-bahan]')?.addEventListener('click', () => deleteBahan(id));
  });
}

async function addBahan() {
  const { data, error } = await supa.from('bahan').insert({
    nama: 'Bahan Baru ' + (stateBahan.length + 1),
    satuan: 'porsi',
    harga_per_satuan: 0
  }).select().single();
  if (error) { toast('Gagal: ' + error.message, 'error'); return; }
  stateBahan.push(data);
  renderBahanTable();
  toast('Bahan ditambah. Edit nama & harga di tabel.', 'success');
}
async function updateBahan(id, row) {
  const payload = {
    nama: $('.bahan-nama', row).value.trim(),
    satuan: $('.bahan-satuan', row).value,
    harga_per_satuan: parseNum($('.bahan-harga', row).value),
    catatan: $('.bahan-catatan', row).value.trim() || null
  };
  const { error } = await supa.from('bahan').update(payload).eq('id', id);
  if (error) { toast('Gagal update: ' + error.message, 'error'); return; }
  const idx = stateBahan.findIndex(b => b.id == id);
  if (idx >= 0) stateBahan[idx] = { ...stateBahan[idx], ...payload };
}
async function deleteBahan(id) {
  if (!confirm('Hapus bahan ini? Resep yang pakai bahan ini juga akan hilang.')) return;
  const { error } = await supa.from('bahan').delete().eq('id', id);
  if (error) { toast('Gagal: ' + error.message, 'error'); return; }
  stateBahan = stateBahan.filter(b => b.id != id);
  await fetchResep();
  renderBahanTable();
  toast('Bahan dihapus.');
}

/* ===== MENU CRUD ===== */
let menuSearchTerm = '';

function renderMenuTable() {
  const tbody = $('#menuTable tbody');
  const filter = (menuSearchTerm || '').toLowerCase();
  const filtered = stateMenu.filter(m =>
    !filter || m.nama.toLowerCase().includes(filter) || (m.kategori || '').toLowerCase().includes(filter)
  );
  if (stateMenu.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Belum ada menu. Klik "+ Tambah Menu".</td></tr>`;
    return;
  }
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Tidak ada menu cocok dengan "${filter}".</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(m => {
    const fotoHtml = m.foto_url
      ? `<img src="${m.foto_url}" alt="" />`
      : (KATEGORI_EMOJI[m.kategori] || '🍽');
    return `
    <tr class="menu-row ${m.aktif === false ? 'inactive' : ''}" data-id="${m.id}">
      <td><div class="foto-cell" data-edit-foto="${m.id}">${fotoHtml}</div></td>
      <td><input type="text" class="menu-nama" value="${m.nama}" placeholder="Nama menu" /></td>
      <td>
        <select class="menu-kategori">
          ${['Sate','Sop','Minuman','Pelengkap','Paket','Promo'].map(k =>
            `<option ${k === m.kategori ? 'selected' : ''}>${k}</option>`).join('')}
        </select>
      </td>
      <td class="harga"><input type="text" class="menu-harga number-input" inputmode="numeric" value="${fmtNumber(m.harga_jual)}" autocomplete="off" /></td>
      <td><input type="number" class="menu-urutan" inputmode="numeric" min="0" value="${m.urutan || 0}" style="width: 64px; text-align: center;" /></td>
      <td><input type="checkbox" class="toggle-aktif" ${m.aktif !== false ? 'checked' : ''} title="Tampilkan di Kasir" /></td>
      <td><button class="row-delete" data-del-menu="${m.id}" title="Hapus menu">🗑</button></td>
    </tr>`;
  }).join('');

  // Wire up
  $$('.menu-row', tbody).forEach(row => {
    const id = row.dataset.id;
    $$('input, select', row).forEach(inp => {
      inp.addEventListener('blur',  () => saveMenuRow(id, row));
      inp.addEventListener('change', () => saveMenuRow(id, row));
    });
    row.querySelector('[data-edit-foto]')?.addEventListener('click', () => openFotoModal(id));
    row.querySelector('[data-del-menu]')?.addEventListener('click', () => deleteMenu(id));
  });
}

async function addMenu() {
  const maxUrutan = stateMenu.reduce((m, x) => Math.max(m, x.urutan || 0), 0);
  const { data, error } = await supa.from('menu').insert({
    nama: 'Menu Baru ' + (stateMenu.length + 1),
    kategori: 'Sate',
    harga_jual: 0,
    urutan: maxUrutan + 1,
    aktif: true
  }).select().single();
  if (error) { toast('Gagal: ' + error.message, 'error'); return; }
  stateMenu.push(data);
  renderMenuTable();
  toast('Menu ditambah. Edit nama, kategori & harga di tabel.', 'success');
}

async function saveMenuRow(id, row) {
  const payload = {
    nama: $('.menu-nama', row).value.trim(),
    kategori: $('.menu-kategori', row).value,
    harga_jual: parseNum($('.menu-harga', row).value),
    urutan: parseInt($('.menu-urutan', row).value) || 0,
    aktif: $('.toggle-aktif', row).checked
  };
  const { error } = await supa.from('menu').update(payload).eq('id', id);
  if (error) { toast('Gagal update: ' + error.message, 'error'); return; }
  const idx = stateMenu.findIndex(m => m.id == id);
  if (idx >= 0) stateMenu[idx] = { ...stateMenu[idx], ...payload };
  row.classList.toggle('inactive', payload.aktif === false);
}

async function deleteMenu(id) {
  const menu = stateMenu.find(m => m.id == id);
  if (!menu) return;
  if (!confirm(`Hapus menu "${menu.nama}"?\n\nKalau menu ini pernah dipesan, riwayat di POS tetap aman (snapshot harga). Tapi resep menu ini akan ikut hilang.`)) return;
  const { error } = await supa.from('menu').delete().eq('id', id);
  if (error) { toast('Gagal: ' + error.message, 'error'); return; }
  stateMenu = stateMenu.filter(m => m.id != id);
  await fetchResep();
  renderMenuTable();
  toast('Menu dihapus.');
}

/* ===== Foto URL modal ===== */
function openFotoModal(menuId) {
  const menu = stateMenu.find(m => m.id == menuId);
  if (!menu) return;
  const overlay = document.createElement('div');
  overlay.className = 'foto-modal-overlay';
  overlay.innerHTML = `
    <div class="foto-modal">
      <h3>Foto Menu: ${menu.nama}</h3>
      <div class="preview-area" id="fotoPreview">
        ${menu.foto_url ? `<img src="${menu.foto_url}" alt="" />` : 'Preview foto'}
      </div>
      <div class="form-group">
        <label>URL Foto</label>
        <input type="text" id="fotoUrlInput" value="${menu.foto_url || ''}"
               placeholder="https://i.imgbb.com/abc/sate-ayam.jpg" autocomplete="off" />
        <p class="text-muted" style="font-size: 0.78rem; margin-top: 6px;">
          Tip: upload foto ke <a href="https://imgbb.com" target="_blank" style="color: var(--ember);">imgbb.com</a>
          (gratis, no signup) → copy "Direct Link" → paste di sini.
        </p>
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button class="btn btn-ghost btn-sm" id="fotoCancel">Batal</button>
        <button class="btn btn-ghost btn-sm" id="fotoClear" style="color: var(--red);">Hapus Foto</button>
        <button class="btn btn-primary btn-sm" id="fotoSave">Simpan</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const inp = $('#fotoUrlInput');
  inp.addEventListener('input', () => {
    const url = inp.value.trim();
    $('#fotoPreview').innerHTML = url ? `<img src="${url}" alt="" onerror="this.parentNode.innerHTML='⚠ URL tidak valid / gambar gagal load'" />` : 'Preview foto';
  });
  $('#fotoCancel').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  $('#fotoClear').onclick = async () => {
    if (!confirm('Hapus foto menu ini?')) return;
    await supa.from('menu').update({ foto_url: null }).eq('id', menuId);
    const m = stateMenu.find(x => x.id == menuId);
    if (m) m.foto_url = null;
    overlay.remove();
    renderMenuTable();
    toast('Foto dihapus.');
  };
  $('#fotoSave').onclick = async () => {
    const url = inp.value.trim() || null;
    const { error } = await supa.from('menu').update({ foto_url: url }).eq('id', menuId);
    if (error) { toast('Gagal: ' + error.message, 'error'); return; }
    const m = stateMenu.find(x => x.id == menuId);
    if (m) m.foto_url = url;
    overlay.remove();
    renderMenuTable();
    toast('Foto tersimpan. Refresh Kasir untuk lihat update.', 'success');
  };
  setTimeout(() => inp.focus(), 50);
}

function renderResepPicker() {
  const sel = $('#resepMenuPicker');
  sel.innerHTML = '<option value="">— Pilih Menu —</option>' +
    stateMenu.map(m => `<option value="${m.id}">${m.nama} · ${fmtRp(m.harga_jual)}</option>`).join('');
  sel.onchange = () => renderResepEditor(parseInt(sel.value));
  if (sel.value) renderResepEditor(parseInt(sel.value));
  else $('#resepEditor').innerHTML = '<div class="empty-state">Pilih menu di atas untuk edit resep.</div>';
}

function renderResepEditor(menuId) {
  if (!menuId) { $('#resepEditor').innerHTML = '<div class="empty-state">Pilih menu.</div>'; return; }
  const menu = stateMenu.find(m => m.id === menuId);
  if (!menu) return;
  const items = stateResep.filter(r => r.menu_id === menuId);
  const hpp = computeHpp(menuId);

  $('#resepEditor').innerHTML = `
    <div class="resep-editor-card">
      <div class="menu-header">
        <div>
          <strong>${menu.nama}</strong>
          <div class="text-muted" style="font-size: 0.82rem; margin-top: 2px;">${menu.kategori}</div>
        </div>
        <div class="harga">
          <input type="text" id="resepHargaJual" class="number-input" inputmode="numeric" value="${fmtNumber(menu.harga_jual)}" autocomplete="off" style="width: 130px; padding: 8px 12px; text-align: right; background: var(--bg-1); border: 1px solid var(--line-strong); border-radius: 8px; font-variant-numeric: tabular-nums; font-weight: 600;" />
          <div class="text-muted" style="font-size: 0.7rem; text-align: right; margin-top: 4px;">Harga Jual</div>
        </div>
      </div>
      <div id="resepItems">
        ${items.map(r => resepRowHtml(r)).join('')}
      </div>
      <div style="margin-top: 10px;">
        <button class="btn btn-ghost btn-sm" id="addResepRowBtn">+ Tambah Bahan</button>
      </div>
      <div class="resep-total">
        <span>Total HPP per porsi</span>
        <span class="hpp-value" id="resepHppTotal">${fmtRp(hpp)}</span>
      </div>
      <div style="display: flex; gap: 10px; margin-top: 16px;">
        <button class="btn btn-primary" id="saveResepBtn">💾 Simpan Resep</button>
        <span class="text-muted" id="resepStatus" style="font-size: 0.85rem; align-self: center;"></span>
      </div>
    </div>`;

  $('#addResepRowBtn').addEventListener('click', () => addResepRow(menuId));
  $('#saveResepBtn').addEventListener('click', () => saveResepFor(menuId));
  $('#resepHargaJual').addEventListener('input', () => recalcResepTotal());
  wireResepRowEvents();
  recalcResepTotal();
}

function resepRowHtml(r = {}) {
  const opts = stateBahan.map(b => `<option value="${b.id}" data-satuan="${b.satuan}" ${r.bahan_id === b.id ? 'selected' : ''}>${b.nama} (${b.satuan})</option>`).join('');
  const bahan = stateBahan.find(b => b.id === r.bahan_id);
  return `<div class="resep-row" data-bahan-id="${r.bahan_id || ''}">
    <select class="resep-bahan"><option value="">— Pilih Bahan —</option>${opts}</select>
    <input type="number" class="resep-jumlah" inputmode="decimal" step="0.001" min="0" value="${r.jumlah || ''}" placeholder="0" />
    <span class="satuan-hint">${bahan?.satuan || ''}</span>
    <button class="row-delete" title="Hapus">🗑</button>
  </div>`;
}

function addResepRow(menuId) {
  const wrap = document.createElement('div');
  wrap.innerHTML = resepRowHtml();
  $('#resepItems').appendChild(wrap.firstElementChild);
  wireResepRowEvents();
}

function wireResepRowEvents() {
  $$('.resep-row').forEach(row => {
    if (row.dataset.wired) return;
    row.dataset.wired = '1';
    const sel = $('.resep-bahan', row);
    const hint = $('.satuan-hint', row);
    sel.addEventListener('change', () => {
      const opt = sel.options[sel.selectedIndex];
      hint.textContent = opt?.dataset.satuan || '';
      recalcResepTotal();
    });
    $('.resep-jumlah', row).addEventListener('input', recalcResepTotal);
    $('.row-delete', row).addEventListener('click', () => { row.remove(); recalcResepTotal(); });
  });
}

function recalcResepTotal() {
  let total = 0;
  $$('.resep-row').forEach(row => {
    const bahanId = parseInt($('.resep-bahan', row).value);
    const jumlah = parseNum($('.resep-jumlah', row).value);
    const bahan = stateBahan.find(b => b.id === bahanId);
    if (bahan && jumlah) total += jumlah * Number(bahan.harga_per_satuan);
  });
  $('#resepHppTotal').textContent = fmtRp(total);
}

async function saveResepFor(menuId) {
  const btn = $('#saveResepBtn');
  btn.disabled = true; btn.textContent = 'Menyimpan…';

  // Update harga jual menu
  const hargaJual = parseNum($('#resepHargaJual').value);
  await supa.from('menu').update({ harga_jual: hargaJual }).eq('id', menuId);

  // Hapus resep lama, insert baru
  await supa.from('resep').delete().eq('menu_id', menuId);
  const newItems = [];
  $$('.resep-row').forEach(row => {
    const bahanId = parseInt($('.resep-bahan', row).value);
    const jumlah = parseNum($('.resep-jumlah', row).value);
    if (bahanId && jumlah > 0) {
      newItems.push({ menu_id: menuId, bahan_id: bahanId, jumlah });
    }
  });
  if (newItems.length > 0) {
    const { error } = await supa.from('resep').insert(newItems);
    if (error) {
      btn.disabled = false; btn.textContent = '💾 Simpan Resep';
      toast('Gagal: ' + error.message, 'error'); return;
    }
  }
  btn.disabled = false; btn.textContent = '💾 Simpan Resep';
  await fetchMenu();
  await fetchResep();
  $('#resepStatus').textContent = '✓ Tersimpan';
  setTimeout(() => $('#resepStatus').textContent = '', 2000);
  toast('Resep tersimpan.', 'success');
}

/* ============ 12. KASIR / POS ============ */
async function loadKasir() {
  await Promise.all([fetchMenu(), fetchResep(), fetchBahan()]);
  renderPosKategoriTabs();
  renderPosMenuGrid();
  renderCart();
  await refreshTodayPesanan();
  wirePosControls();
}

function renderPosKategoriTabs() {
  const tabsEl = $('#posKategoriTabs');
  // Hanya menu aktif yang ditampilkan di Kasir
  const aktifMenus = stateMenu.filter(m => m.aktif !== false);
  const kategoris = [...new Set(aktifMenus.map(m => m.kategori))];
  tabsEl.innerHTML = `<button class="pos-kategori-tab ${posKategoriFilter === '' ? 'active' : ''}" data-kategori="">Semua</button>` +
    kategoris.map(k => {
      const emoji = KATEGORI_EMOJI[k] || '🍽';
      return `<button class="pos-kategori-tab ${posKategoriFilter === k ? 'active' : ''}" data-kategori="${k}">${emoji} ${k}</button>`;
    }).join('');
  $$('.pos-kategori-tab', tabsEl).forEach(b => b.addEventListener('click', () => {
    posKategoriFilter = b.dataset.kategori;
    renderPosKategoriTabs();
    renderPosMenuGrid();
  }));
}

function renderPosMenuGrid() {
  const el = $('#posMenuGrid');
  // Hanya menu aktif yang muncul di Kasir
  const aktifMenus = stateMenu.filter(m => m.aktif !== false);
  const filtered = posKategoriFilter
    ? aktifMenus.filter(m => m.kategori === posKategoriFilter)
    : aktifMenus;

  if (filtered.length === 0) {
    el.innerHTML = '<div class="empty-state">Belum ada menu di kategori ini.</div>';
    return;
  }
  el.innerHTML = filtered.map(m => {
    const inCart = cart.find(c => c.menu_id === m.id);
    const photoHtml = m.foto_url
      ? `<img src="${m.foto_url}" alt="${m.nama}" loading="lazy" />`
      : (KATEGORI_EMOJI[m.kategori] || '🍽');
    return `<button class="pos-menu-btn" data-add="${m.id}">
      ${inCart ? `<span class="pos-menu-btn-badge">${inCart.qty}</span>` : ''}
      <div class="pos-menu-btn-photo">${photoHtml}</div>
      <div class="pos-menu-btn-body">
        <div class="menu-cat">${m.kategori}</div>
        <div class="menu-name">${m.nama}</div>
        <div class="menu-harga">${fmtRp(m.harga_jual)}</div>
      </div>
    </button>`;
  }).join('');
  $$('[data-add]', el).forEach(b => b.addEventListener('click', () => addToCart(parseInt(b.dataset.add))));
}

function addToCart(menuId) {
  const menu = stateMenu.find(m => m.id === menuId);
  if (!menu) return;
  const existing = cart.find(c => c.menu_id === menuId);
  if (existing) {
    existing.qty += 1;
  } else {
    const hpp = computeHpp(menuId);
    cart.push({ menu_id: menuId, nama: menu.nama, harga: Number(menu.harga_jual), hpp, qty: 1, catatan: '' });
  }
  renderCart();
  renderPosMenuGrid();  // refresh badges
}

function renderCart() {
  const el = $('#posCartItems');
  const sentBtn = $('#posSendKitchenBtn');
  const checkoutBtn = $('#posCheckoutBtn');

  if (cart.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding: 20px;">Klik menu di kiri untuk mulai.</div>';
    $('#posTotal').textContent = fmtRp(0);
    if (sentBtn) sentBtn.disabled = true;
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }
  el.innerHTML = cart.map((c, i) => `
    <div class="pos-cart-item">
      <div>
        <div class="name">${c.nama}${currentPesananId ? '<span class="sent-badge">✓ ke dapur</span>' : ''}</div>
        <div class="sub">${fmtRp(c.harga)} × ${c.qty}</div>
        <div class="pos-qty-controls">
          <button class="pos-qty-btn" data-dec="${i}">−</button>
          <span class="pos-qty-value">${c.qty}</span>
          <button class="pos-qty-btn" data-inc="${i}">+</button>
          <button class="pos-item-remove" data-rm="${i}">Hapus</button>
        </div>
        <input type="text" class="pos-cart-item-note" data-note="${i}" value="${c.catatan || ''}" placeholder="Catatan (mis. pedas / tanpa lalapan)" />
      </div>
      <div class="subtotal">${fmtRp(c.harga * c.qty)}</div>
    </div>
  `).join('');

  $$('[data-note]', el).forEach(inp => inp.addEventListener('input', () => {
    cart[parseInt(inp.dataset.note)].catatan = inp.value;
  }));
  $$('[data-dec]', el).forEach(b => b.addEventListener('click', () => {
    const i = parseInt(b.dataset.dec);
    cart[i].qty -= 1;
    if (cart[i].qty <= 0) cart.splice(i, 1);
    renderCart(); renderPosMenuGrid();
  }));
  $$('[data-inc]', el).forEach(b => b.addEventListener('click', () => {
    cart[parseInt(b.dataset.inc)].qty += 1; renderCart(); renderPosMenuGrid();
  }));
  $$('[data-rm]', el).forEach(b => b.addEventListener('click', () => {
    cart.splice(parseInt(b.dataset.rm), 1); renderCart(); renderPosMenuGrid();
  }));
  const total = cart.reduce((s, c) => s + (c.harga * c.qty), 0);
  $('#posTotal').textContent = fmtRp(total);
  if (sentBtn) sentBtn.disabled = false;
  if (checkoutBtn) checkoutBtn.disabled = false;
}

function wirePosControls() {
  // Channel pills
  $$('.pos-channel-pill[data-channel]').forEach(b => {
    b.onclick = () => {
      $$('.pos-channel-pill[data-channel]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      posChannel = b.dataset.channel;
    };
  });
  $$('.pos-channel-pill[data-bayar]').forEach(b => {
    b.onclick = () => {
      $$('.pos-channel-pill[data-bayar]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      posMetodeBayar = b.dataset.bayar;
    };
  });
  $('#posClearBtn').onclick = () => {
    if (cart.length === 0) return;
    if (confirm('Kosongin keranjang? Pesanan ke dapur (kalau ada) tidak terhapus.')) {
      cart = []; currentPesananId = null; renderCart(); renderPosMenuGrid();
    }
  };
  $('#posSendKitchenBtn').onclick = sendToKitchen;
  $('#posCheckoutBtn').onclick = checkoutPos;
}

/* Kirim ke dapur — save pesanan + cetak tiket dapur (tanpa harga). Cart tetap. */
async function sendToKitchen() {
  if (cart.length === 0) return;
  const meja = $('#posMejaNama').value.trim();
  if (posChannel === 'Dine-in' && !meja) {
    toast('Isi nama meja dulu (wajib untuk dine-in).', 'error');
    $('#posMejaNama').focus();
    return;
  }
  const btn = $('#posSendKitchenBtn');
  btn.disabled = true; btn.textContent = 'Menyimpan…';

  const total = cart.reduce((s, c) => s + (c.harga * c.qty), 0);
  const totalHpp = cart.reduce((s, c) => s + (c.hpp * c.qty), 0);

  let pesananId = currentPesananId;
  if (!pesananId) {
    // Insert pesanan
    const { data: pesanan, error } = await supa.from('pesanan').insert({
      channel: posChannel,
      kasir: session.username,
      total,
      total_hpp: totalHpp,
      meja_atau_nama: meja || null,
      status: 'selesai'
    }).select().single();
    if (error) {
      btn.disabled = false; btn.textContent = '👨‍🍳 Kirim ke Dapur (cetak tiket)';
      toast('Gagal: ' + error.message, 'error'); return;
    }
    pesananId = pesanan.id;
    currentPesananId = pesananId;
    // Insert items
    const items = cart.map(c => ({
      pesanan_id: pesananId, menu_id: c.menu_id, nama_menu: c.nama,
      qty: c.qty, harga: c.harga, hpp: c.hpp, subtotal: c.harga * c.qty,
      catatan: c.catatan || null
    }));
    await supa.from('pesanan_item').insert(items);
  } else {
    // Sudah pernah dikirim — update total + replace items
    await supa.from('pesanan').update({ total, total_hpp: totalHpp, meja_atau_nama: meja || null }).eq('id', pesananId);
    await supa.from('pesanan_item').delete().eq('pesanan_id', pesananId);
    const items = cart.map(c => ({
      pesanan_id: pesananId, menu_id: c.menu_id, nama_menu: c.nama,
      qty: c.qty, harga: c.harga, hpp: c.hpp, subtotal: c.harga * c.qty,
      catatan: c.catatan || null
    }));
    await supa.from('pesanan_item').insert(items);
  }

  btn.disabled = false; btn.textContent = '🔁 Cetak Ulang Tiket';

  // Print kitchen ticket
  const pesananData = { id: pesananId, channel: posChannel, kasir: session.username, meja_atau_nama: meja, waktu: new Date().toISOString() };
  const itemsForPrint = cart.map(c => ({ nama_menu: c.nama, qty: c.qty, catatan: c.catatan }));
  printKitchenTicket(pesananData, itemsForPrint);
  renderCart();
  await refreshTodayPesanan();
  toast(`Pesanan #${pesananId} dikirim ke dapur ✓`, 'success');
}

/* Cetak tiket dapur — TANPA harga, no. meja BESAR */
function printKitchenTicket(pesanan, items) {
  const w = window.open('', '_blank', 'width=320,height=600');
  if (!w) { toast('Popup diblokir — izinkan popup untuk cetak.', 'error'); return; }
  const time = new Date(pesanan.waktu).toLocaleString('id-ID', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  const lines = items.map(it => `
    <tr><td style="font-size: 16px; font-weight: 700; padding: 4px 0;">
      ${it.qty}× ${it.nama_menu}
      ${it.catatan ? `<div style="font-size: 12px; font-weight: 400; margin-left: 16px; color: #000;">→ ${it.catatan}</div>` : ''}
    </td></tr>`).join('');

  w.document.write(`
<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tiket #${pesanan.id}</title>
<style>
  @page { size: 58mm auto; margin: 4mm; }
  body { font-family: 'Courier New', monospace; color: #000; width: 58mm; margin: 0; padding: 6px; }
  h1 { font-size: 14px; text-align: center; margin: 0 0 6px; letter-spacing: 1px; }
  .meja-label { font-size: 10px; text-align: center; color: #555; margin-top: 8px; }
  .meja-big {
    font-size: 36px;
    font-weight: 900;
    text-align: center;
    margin: 4px 0 8px;
    letter-spacing: 2px;
  }
  .muted { color: #555; font-size: 10px; }
  hr { border: none; border-top: 2px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  .footer { text-align: center; font-size: 9px; color: #555; margin-top: 8px; }
  @media print { body { padding: 0; } }
</style></head><body>
  <h1>PESANAN DINE-IN</h1>
  <div class="meja-label">NO. MEJA / NAMA</div>
  <div class="meja-big">${pesanan.meja_atau_nama || '—'}</div>
  <hr/>
  <div class="muted">Pesanan #${pesanan.id} · ${pesanan.channel}</div>
  <div class="muted">${time} · Kasir: ${pesanan.kasir || '—'}</div>
  <hr/>
  <table>${lines}</table>
  <hr/>
  <div class="footer">— DAPUR / PANGGANGAN —</div>
  <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 500); };</script>
</body></html>`);
  w.document.close();
}

/* Cetak struk via window.print() — sederhana, pakai printer apa pun
   (termasuk thermal via app jembatan). Untuk Bluetooth langsung lihat README. */
function printReceipt(pesanan, items) {
  const w = window.open('', '_blank', 'width=320,height=600');
  if (!w) { toast('Popup diblokir browser — izinkan popup untuk cetak struk.', 'error'); return; }
  const time = new Date(pesanan.waktu).toLocaleString('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const lines = items.map(it => {
    const sub = fmtRp(it.harga * it.qty);
    return `<tr><td>${it.nama_menu} ×${it.qty}</td><td style="text-align:right">${sub}</td></tr>`;
  }).join('');
  w.document.write(`
<!DOCTYPE html><html><head><meta charset="utf-8"><title>Struk #${pesanan.id}</title>
<style>
  @page { size: 58mm auto; margin: 4mm; }
  body { font-family: 'Courier New', monospace; font-size: 11px; color: #000; width: 58mm; margin: 0; padding: 6px; }
  h1 { font-size: 13px; text-align: center; margin: 0 0 4px; }
  .center { text-align: center; }
  .muted { color: #555; font-size: 10px; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  td { padding: 2px 0; vertical-align: top; }
  .total { font-size: 13px; font-weight: bold; }
  @media print { body { padding: 0; } }
</style>
</head><body>
  <h1>SATE JAVVA</h1>
  <div class="center muted">Jl. Nusa Jaya No.4, Pondok Ranji<br/>+62 856 1578 404</div>
  <hr/>
  <div class="muted">Pesanan #${pesanan.id} · ${pesanan.channel}</div>
  <div class="muted">${time}</div>
  ${pesanan.meja_atau_nama ? `<div class="muted">Meja/Nama: ${pesanan.meja_atau_nama}</div>` : ''}
  ${pesanan.kasir ? `<div class="muted">Kasir: ${pesanan.kasir}</div>` : ''}
  <hr/>
  <table>${lines}</table>
  <hr/>
  <table>
    <tr class="total"><td>TOTAL</td><td style="text-align:right">${fmtRp(pesanan.total)}</td></tr>
    <tr><td>${pesanan.metode_bayar || '—'}</td><td></td></tr>
  </table>
  <hr/>
  <div class="center muted">Matur Nuwun Wis Mampir<br/>Ing Sate Javva 🙏</div>
  <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 500); };</script>
</body></html>`);
  w.document.close();
}

async function checkoutPos() {
  if (cart.length === 0) return;
  const btn = $('#posCheckoutBtn');
  btn.disabled = true; btn.textContent = 'Menyimpan…';

  const total = cart.reduce((s, c) => s + (c.harga * c.qty), 0);
  const totalHpp = cart.reduce((s, c) => s + (c.hpp * c.qty), 0);
  const meja = $('#posMejaNama').value.trim();

  let pesananId = currentPesananId;
  let pesananData;

  if (pesananId) {
    // Sudah pernah dikirim ke dapur — UPDATE saja
    const { data, error } = await supa.from('pesanan').update({
      total, total_hpp: totalHpp, metode_bayar: posMetodeBayar,
      meja_atau_nama: meja || null, status: 'selesai'
    }).eq('id', pesananId).select().single();
    if (error) {
      btn.disabled = false; btn.textContent = '💾 Bayar & Cetak Struk';
      toast('Gagal update: ' + error.message, 'error'); return;
    }
    pesananData = data;
    // Replace items (kalau ada perubahan)
    await supa.from('pesanan_item').delete().eq('pesanan_id', pesananId);
    const items = cart.map(c => ({
      pesanan_id: pesananId, menu_id: c.menu_id, nama_menu: c.nama,
      qty: c.qty, harga: c.harga, hpp: c.hpp, subtotal: c.harga * c.qty,
      catatan: c.catatan || null
    }));
    await supa.from('pesanan_item').insert(items);
  } else {
    // Belum pernah disave — insert baru
    const { data, error } = await supa.from('pesanan').insert({
      channel: posChannel,
      kasir: session.username,
      total, total_hpp: totalHpp, metode_bayar: posMetodeBayar,
      meja_atau_nama: meja || null,
      status: 'selesai'
    }).select().single();
    if (error) {
      btn.disabled = false; btn.textContent = '💾 Bayar & Cetak Struk';
      toast('Gagal: ' + error.message, 'error'); return;
    }
    pesananData = data;
    pesananId = data.id;
    const items = cart.map(c => ({
      pesanan_id: pesananId, menu_id: c.menu_id, nama_menu: c.nama,
      qty: c.qty, harga: c.harga, hpp: c.hpp, subtotal: c.harga * c.qty,
      catatan: c.catatan || null
    }));
    const { error: itemErr } = await supa.from('pesanan_item').insert(items);
    if (itemErr) {
      btn.disabled = false; btn.textContent = '💾 Bayar & Cetak Struk';
      toast('Pesanan tersimpan tapi item gagal: ' + itemErr.message, 'error'); return;
    }
  }

  btn.disabled = false; btn.textContent = '💾 Bayar & Cetak Struk';
  toast(`Pesanan #${pesananId} lunas · ${fmtRp(total)}`, 'success');

  // Cetak struk pelanggan
  const itemsForPrint = cart.map(c => ({ nama_menu: c.nama, qty: c.qty, harga: c.harga, hpp: c.hpp }));
  printReceipt(pesananData, itemsForPrint);

  cart = [];
  currentPesananId = null;
  $('#posMejaNama').value = '';
  $('#posSendKitchenBtn').textContent = '👨‍🍳 Kirim ke Dapur (cetak tiket)';
  renderCart();
  renderPosMenuGrid();
  await refreshTodayPesanan();
}

async function refreshTodayPesanan() {
  const today = todayISO();
  const list = await fetchPesanan(today, today);
  const itemList = await fetchPesananItems(list.map(p => p.id));
  const itemsByPesanan = {};
  itemList.forEach(it => { (itemsByPesanan[it.pesanan_id] ||= []).push(it); });

  const total = list.reduce((s, p) => s + Number(p.total), 0);
  const totalQty = itemList.reduce((s, it) => s + it.qty, 0);
  $('#kasirTodaySummary').textContent = `Hari ini: ${list.length} pesanan · ${totalQty} item · ${fmtRp(total)}`;

  const el = $('#todayPesananList');
  if (list.length === 0) {
    el.innerHTML = '<div class="empty-state">Belum ada pesanan hari ini.</div>';
    return;
  }
  el.innerHTML = list.map(p => {
    const items = itemsByPesanan[p.id] || [];
    const itemNames = items.map(it => `${it.nama_menu} ×${it.qty}`).join(', ');
    const time = new Date(p.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const canDelete = session.role === 'admin';
    return `<div class="pesanan-row" data-id="${p.id}">
      <span class="time">${time}</span>
      <span class="channel-badge">${p.channel}</span>
      <span class="items">${itemNames}${p.meja_atau_nama ? ' · ' + p.meja_atau_nama : ''}</span>
      <span class="total">${fmtRp(p.total)}</span>
      <span class="pesanan-actions">
        <button class="icon-btn edit-pesanan" data-edit="${p.id}" title="Edit / tambah-kurangi item">✏️</button>
        <button class="icon-btn reprint-pesanan" data-reprint="${p.id}" title="Cetak ulang tiket dapur">🖨</button>
        ${canDelete ? `<button class="icon-btn delete delete-pesanan" data-del="${p.id}" title="Hapus pesanan (admin)">🗑</button>` : ''}
      </span>
    </div>`;
  }).join('');

  $$('[data-edit]', el).forEach(b => b.addEventListener('click', () => editPesanan(parseInt(b.dataset.edit), list, itemsByPesanan)));
  $$('[data-reprint]', el).forEach(b => b.addEventListener('click', () => reprintTiket(parseInt(b.dataset.reprint), list, itemsByPesanan)));
  $$('[data-del]', el).forEach(b => b.addEventListener('click', () => deletePesanan(parseInt(b.dataset.del))));
}

function editPesanan(id, list, itemsByPesanan) {
  const p = list.find(x => x.id === id);
  if (!p) return;
  if (cart.length > 0 && !confirm('Keranjang masih ada isinya. Ganti dengan pesanan ini?')) return;

  const items = itemsByPesanan[id] || [];
  cart = items.map(it => ({
    menu_id: it.menu_id,
    nama: it.nama_menu,
    harga: Number(it.harga),
    hpp: Number(it.hpp),
    qty: it.qty,
    catatan: it.catatan || ''
  }));
  currentPesananId = id;
  posChannel = p.channel;
  posMetodeBayar = p.metode_bayar || 'Tunai';
  $('#posMejaNama').value = p.meja_atau_nama || '';

  // Update channel pills
  $$('.pos-channel-pill[data-channel]').forEach(b => b.classList.toggle('active', b.dataset.channel === posChannel));
  $$('.pos-channel-pill[data-bayar]').forEach(b => b.classList.toggle('active', b.dataset.bayar === posMetodeBayar));
  $('#posSendKitchenBtn').textContent = '🔁 Update & Cetak Tiket';

  renderCart();
  renderPosMenuGrid();
  // Scroll ke atas supaya cart kelihatan
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast(`Edit pesanan #${id} — tambah/kurangi item, lalu klik Update`, 'success');
}

function reprintTiket(id, list, itemsByPesanan) {
  const p = list.find(x => x.id === id);
  if (!p) return;
  const items = (itemsByPesanan[id] || []).map(it => ({
    nama_menu: it.nama_menu, qty: it.qty, catatan: it.catatan
  }));
  printKitchenTicket(p, items);
}

async function deletePesanan(id) {
  if (session.role !== 'admin') {
    toast('Hanya admin yang boleh hapus pesanan.', 'error');
    return;
  }
  if (!confirm(`Hapus pesanan #${id}?\nPemasukan dari pesanan ini akan ikut hilang dari laporan.`)) return;
  const { error } = await supa.from('pesanan').delete().eq('id', id);
  if (error) { toast('Gagal: ' + error.message, 'error'); return; }
  toast(`Pesanan #${id} dihapus.`, 'success');
  if (currentPesananId === id) {
    currentPesananId = null;
    cart = [];
    renderCart();
    renderPosMenuGrid();
  }
  await refreshTodayPesanan();
}

/* ============ 13. INIT ============ */
function bindEvents() {
  // Auth
  $('#loginBtn').addEventListener('click', login);
  $('#loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  $('#logoutBtn').addEventListener('click', logout);

  // Mode toggle
  $$('#modeToggle button').forEach(b => b.addEventListener('click', () => {
    inputMode = b.dataset.mode;
    $$('#modeToggle button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $('#modeA').style.display = inputMode === 'A' ? '' : 'none';
    $('#modeB').style.display = inputMode === 'B' ? '' : 'none';
    if (inputMode === 'B' && $('#bulkGrid tbody').children.length === 0) buildBulkGrid();
  }));

  // Mode A buttons
  $('#saveModeABtn').addEventListener('click', saveModeA);
  $('#clearModeABtn').addEventListener('click', clearModeA);
  $('#inputDate').addEventListener('change', refreshTodayEntries);

  // Mode B buttons
  $('#addRowBtn').addEventListener('click', () => addBulkRow(todayISO()));
  $('#saveBulkBtn').addEventListener('click', saveBulk);

  // Dashboard
  $('#refreshBtn').addEventListener('click', loadDashboard);

  // Rekap
  $('#rekapMonth').addEventListener('change', renderRekap);
  $('#exportCsvBtn').addEventListener('click', exportCsv);

  // Pengaturan
  $('#saveSettingsBtn').addEventListener('click', savePengaturan);

  // HPP tabs
  $$('#hppTabs button').forEach(b => b.addEventListener('click', () => showHppTab(b.dataset.hppTab)));
  $('#addBahanBtn').addEventListener('click', addBahan);
  $('#addMenuBtn')?.addEventListener('click', addMenu);
  $('#menuSearch')?.addEventListener('input', (e) => {
    menuSearchTerm = e.target.value;
    renderMenuTable();
  });

  // Router
  window.addEventListener('hashchange', handleRoute);
}

document.addEventListener('DOMContentLoaded', () => {
  if (!initSupabase()) return;
  session = loadSession();
  applyAuthUI();
  bindEvents();
  handleRoute();
});
