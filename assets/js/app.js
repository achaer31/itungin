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
  if (view === 'belanja')    loadBelanja();
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
  const [pengaturan, txMonth, pesananMonth, _beban] = await Promise.all([
    fetchPengaturan(),
    fetchTransaksi(range.start, range.end),
    fetchPesanan(range.start, range.end),
    fetchBebanTetap()
  ]);

  // Render banner reminder beban tetap belum tercatat
  await renderBebanBanner();

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
  const isPengeluaran = tipe === 'pengeluaran';
  return `<div class="input-row">
    <label>${kategori}</label>
    <span class="rp-prefix">Rp</span>
    <input type="text" inputmode="numeric" class="mode-a-input number-input" data-tipe="${tipe}" data-kategori="${kategori}" placeholder="0" autocomplete="off" />
    ${isPengeluaran ? `<input type="text" class="mode-a-catatan" data-tipe="${tipe}" data-kategori="${kategori}" placeholder="📝 Catatan (mis: beli 5kg ayam di pasar Bintaro)" autocomplete="off" />` : ''}
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
      const tipe = inp.dataset.tipe;
      const kategori = inp.dataset.kategori;
      // Cari catatan field yang match (cuma ada di pengeluaran)
      const catatanInp = document.querySelector(`.mode-a-catatan[data-tipe="${tipe}"][data-kategori="${kategori}"]`);
      const catatan = catatanInp?.value.trim() || null;
      rows.push({
        tanggal, tipe, kategori,
        nominal: n,
        catatan,
        dibuat_oleh: session.username
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
  $$('.mode-a-catatan').forEach(inp => inp.value = '');
  recalcModeATotal();
  refreshTodayEntries();
}

function clearModeA() {
  if (!confirm('Reset semua input?')) return;
  $$('.mode-a-input').forEach(inp => inp.value = '');
  $$('.mode-a-catatan').forEach(inp => inp.value = '');
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
let rekapTab = 'ringkasan';
let detailKategoriFilter = ''; // '' = semua kategori pengeluaran

async function loadRekap() {
  const monthInput = $('#rekapMonth');
  if (!monthInput.value) monthInput.value = currentYearMonth();
  await renderRekapByTab();
}

function showRekapTab(tab) {
  rekapTab = tab;
  $$('#rekapTabs button').forEach(b => b.classList.toggle('active', b.dataset.rekapTab === tab));
  renderRekapByTab();
}

async function renderRekapByTab() {
  if (rekapTab === 'detail') {
    await renderRekapDetail();
  } else {
    await renderRekap();
  }
}

async function renderRekapDetail() {
  const ym = $('#rekapMonth').value || currentYearMonth();
  const range = monthRange(ym);
  const el = $('#rekapContent');
  el.innerHTML = '<div class="loading">Memuat data pengeluaran…</div>';

  // Ambil semua transaksi pengeluaran di bulan ini
  const { data, error } = await supa.from('transaksi')
    .select('*')
    .eq('tipe', 'pengeluaran')
    .gte('tanggal', range.start)
    .lte('tanggal', range.end)
    .order('tanggal', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    el.innerHTML = '<div class="empty-state">Gagal load: ' + error.message + '</div>';
    return;
  }
  const items = data || [];

  // Breakdown per kategori
  const byKategori = {};
  let totalAll = 0;
  items.forEach(t => {
    const n = Number(t.nominal) || 0;
    byKategori[t.kategori] = (byKategori[t.kategori] || { total: 0, count: 0 });
    byKategori[t.kategori].total += n;
    byKategori[t.kategori].count += 1;
    totalAll += n;
  });

  const kategoriList = Object.entries(byKategori).sort((a,b) => b[1].total - a[1].total);

  // Filter view
  const filtered = detailKategoriFilter
    ? items.filter(t => t.kategori === detailKategoriFilter)
    : items;
  const filteredTotal = filtered.reduce((s, t) => s + Number(t.nominal), 0);

  const isAdmin = session.role === 'admin';

  el.innerHTML = `
    <div class="detail-pengeluaran-card">
      <h3 style="font-family: var(--font-body); font-size: 0.82rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--cream-dim); margin-bottom: 14px;">
        Breakdown per Kategori (${fmtDateShort(range.start)} – ${fmtDateShort(range.end)})
      </h3>
      ${kategoriList.length === 0
        ? '<div class="empty-state">Belum ada pengeluaran bulan ini.</div>'
        : `<div class="detail-kategori-summary">
            ${kategoriList.map(([kat, info]) => {
              const pct = totalAll > 0 ? (info.total / totalAll * 100) : 0;
              return `<div class="detail-kategori-box">
                <div class="label">${kat}</div>
                <div class="value">${fmtRp(info.total)}</div>
                <div class="count">${info.count} entri · ${fmtPct(pct, 0)}</div>
              </div>`;
            }).join('')}
            <div class="detail-kategori-box" style="border-color: var(--ember); background: rgba(232, 115, 44, 0.08);">
              <div class="label">TOTAL BULAN INI</div>
              <div class="value" style="color: var(--ember);">${fmtRp(totalAll)}</div>
              <div class="count">${items.length} entri</div>
            </div>
          </div>`
      }
    </div>

    <div class="detail-filter-bar">
      <strong style="font-size: 0.85rem;">Filter Kategori:</strong>
      <select id="detailKategoriFilter">
        <option value="">Semua (${items.length})</option>
        ${kategoriList.map(([kat, info]) => `<option value="${kat}" ${detailKategoriFilter === kat ? 'selected' : ''}>${kat} (${info.count})</option>`).join('')}
      </select>
      <span class="text-muted" style="font-size: 0.85rem;">Menampilkan ${filtered.length} entri · ${fmtRp(filteredTotal)}</span>
    </div>

    ${filtered.length === 0
      ? '<div class="empty-state">Tidak ada entri.</div>'
      : `<table class="detail-table">
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Kategori</th>
              <th>Nominal</th>
              <th>Catatan</th>
              <th>Oleh</th>
              ${isAdmin ? '<th></th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${filtered.map(t => `
              <tr data-id="${t.id}">
                <td class="tanggal">${fmtDateShort(t.tanggal)}</td>
                <td class="kategori-cell"><span class="tipe-badge pengeluaran" style="display: inline-block; font-size: 0.7rem; padding: 2px 8px; border-radius: 4px; background: rgba(245, 166, 35, 0.15); color: var(--amber);">${t.kategori}</span></td>
                <td class="nominal">− ${fmtRp(t.nominal)}</td>
                <td class="catatan-cell ${!t.catatan ? 'empty' : ''}" data-catatan-cell="${t.id}">${t.catatan ? escapeHtml(t.catatan) : '— tanpa catatan —'}</td>
                <td style="color: var(--cream-dim); font-size: 0.82rem;">${t.dibuat_oleh || '—'}</td>
                ${isAdmin ? `<td class="actions">
                  <button class="edit-catatan-btn" data-edit-id="${t.id}" title="Edit catatan">✏️</button>
                  <button class="delete delete-tx-btn" data-del-id="${t.id}" title="Hapus entri">🗑</button>
                </td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>`
    }
  `;

  // Wire filter
  $('#detailKategoriFilter')?.addEventListener('change', (e) => {
    detailKategoriFilter = e.target.value;
    renderRekapDetail();
  });
  // Wire edit catatan
  $$('.edit-catatan-btn').forEach(b => b.addEventListener('click', () => editCatatanPengeluaran(parseInt(b.dataset.editId), items)));
  // Wire delete
  $$('.delete-tx-btn').forEach(b => b.addEventListener('click', () => deleteTransaksi(parseInt(b.dataset.delId))));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function editCatatanPengeluaran(id, items) {
  const t = items.find(x => x.id === id);
  if (!t) return;
  const cell = $(`[data-catatan-cell="${id}"]`);
  if (!cell) return;
  const tr = cell.closest('tr');
  tr.classList.add('editing');
  const oldVal = t.catatan || '';
  cell.innerHTML = `<input type="text" class="edit-catatan" value="${escapeHtml(oldVal)}" placeholder="Catatan…" />`;
  const inp = cell.querySelector('input');
  inp.focus();
  inp.select();

  const save = async () => {
    const newVal = inp.value.trim() || null;
    if (newVal === oldVal) {
      tr.classList.remove('editing');
      cell.innerHTML = oldVal ? escapeHtml(oldVal) : '— tanpa catatan —';
      cell.classList.toggle('empty', !oldVal);
      return;
    }
    const { error } = await supa.from('transaksi').update({ catatan: newVal }).eq('id', id);
    if (error) { toast('Gagal: ' + error.message, 'error'); return; }
    toast('Catatan disimpan.', 'success');
    renderRekapDetail();
  };

  inp.addEventListener('blur', save);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') {
      tr.classList.remove('editing');
      cell.innerHTML = oldVal ? escapeHtml(oldVal) : '— tanpa catatan —';
      cell.classList.toggle('empty', !oldVal);
    }
  });
}

async function deleteTransaksi(id) {
  if (session.role !== 'admin') { toast('Hanya admin yang boleh hapus.', 'error'); return; }
  if (!confirm('Hapus entri ini? Pemasukan/pengeluaran dari entri ini akan hilang dari laporan.')) return;
  const { error } = await supa.from('transaksi').delete().eq('id', id);
  if (error) { toast('Gagal: ' + error.message, 'error'); return; }
  toast('Entri dihapus.', 'success');
  renderRekapDetail();
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
  await fetchBebanTetap();
  renderBebanTetapTable();
}

/* ===== BEBAN TETAP (recurring monthly) ===== */
let stateBebanTetap = [];

async function fetchBebanTetap() {
  const { data, error } = await supa.from('pengeluaran_tetap').select('*').order('tanggal_bayar').order('nama');
  if (error) { console.error(error); return []; }
  stateBebanTetap = data || [];
  return stateBebanTetap;
}

// Check apakah suatu item beban sudah jatuh tempo bulan ini & belum tercatat
function isBebanDue(item) {
  if (!item.aktif) return false;
  const now = new Date();
  const cm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (item.last_recorded_month === cm) return false;
  return now.getDate() >= item.tanggal_bayar;
}
function isBebanUpcoming(item) {
  if (!item.aktif) return false;
  const now = new Date();
  const cm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (item.last_recorded_month === cm) return false;
  return now.getDate() < item.tanggal_bayar;
}
function isBebanRecorded(item) {
  const now = new Date();
  const cm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return item.last_recorded_month === cm;
}

function renderBebanTetapTable() {
  const tbody = $('#bebanTetapTable tbody');
  if (!tbody) return;
  if (stateBebanTetap.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Belum ada beban tetap. Klik "+ Tambah Beban".</td></tr>`;
    return;
  }
  tbody.innerHTML = stateBebanTetap.map(b => {
    let statusBadge = '';
    if (isBebanRecorded(b))  statusBadge = '<span class="badge-status recorded">✓ Bulan ini</span>';
    else if (isBebanDue(b))  statusBadge = '<span class="badge-status due">! Belum dicatat</span>';
    else if (isBebanUpcoming(b)) statusBadge = `<span class="badge-status upcoming">akan jatuh tempo</span>`;
    return `
    <tr class="beban-row ${b.aktif === false ? 'inactive' : ''}" data-id="${b.id}">
      <td><input type="text" class="beban-nama" value="${escapeHtml(b.nama)}" placeholder="Sewa Warung" />${statusBadge}</td>
      <td>
        <select class="beban-kategori">
          ${KATEGORI_PENGELUARAN.map(k => `<option ${k === b.kategori ? 'selected' : ''}>${k}</option>`).join('')}
        </select>
      </td>
      <td class="nominal-col"><input type="text" inputmode="numeric" class="beban-nominal number-input" value="${fmtNumber(b.nominal)}" /></td>
      <td class="tgl-col"><input type="number" min="1" max="31" class="beban-tgl" value="${b.tanggal_bayar}" /></td>
      <td><input type="text" class="beban-catatan" value="${escapeHtml(b.catatan || '')}" placeholder="opsional" /></td>
      <td style="text-align:center;"><input type="checkbox" class="toggle-aktif" ${b.aktif !== false ? 'checked' : ''} title="Aktifkan/nonaktifkan" /></td>
      <td style="white-space:nowrap; text-align:right;">
        ${isBebanDue(b) ? `<button class="btn btn-primary btn-sm" data-catat-id="${b.id}" style="font-size: 0.78rem; padding: 6px 10px;">Catat ${fmtNumber(b.nominal) ? 'Rp ' + fmtNumber(b.nominal) : ''}</button>` : ''}
        <button class="row-delete" data-del-beban="${b.id}" title="Hapus">🗑</button>
      </td>
    </tr>`;
  }).join('');

  $$('.beban-row', tbody).forEach(row => {
    const id = row.dataset.id;
    $$('input, select', row).forEach(inp => {
      inp.addEventListener('blur',  () => saveBebanRow(id, row));
      inp.addEventListener('change', () => saveBebanRow(id, row));
    });
    row.querySelector('[data-del-beban]')?.addEventListener('click', () => deleteBebanTetap(id));
    row.querySelector('[data-catat-id]')?.addEventListener('click', () => catatBebanTetap(parseInt(id)));
  });
}

async function addBebanTetap() {
  const { data, error } = await supa.from('pengeluaran_tetap').insert({
    nama: 'Beban Baru',
    kategori: 'Sewa',
    nominal: 0,
    tanggal_bayar: 1,
    aktif: true
  }).select().single();
  if (error) { toast('Gagal: ' + error.message, 'error'); return; }
  stateBebanTetap.push(data);
  renderBebanTetapTable();
  toast('Beban tetap ditambah. Edit nama, kategori, nominal, tanggal.', 'success');
}

async function saveBebanRow(id, row) {
  const payload = {
    nama: $('.beban-nama', row).value.trim() || 'Tanpa Nama',
    kategori: $('.beban-kategori', row).value,
    nominal: parseNum($('.beban-nominal', row).value),
    tanggal_bayar: Math.min(31, Math.max(1, parseInt($('.beban-tgl', row).value) || 1)),
    catatan: $('.beban-catatan', row).value.trim() || null,
    aktif: $('.toggle-aktif', row).checked
  };
  const { error } = await supa.from('pengeluaran_tetap').update(payload).eq('id', id);
  if (error) { toast('Gagal update: ' + error.message, 'error'); return; }
  const idx = stateBebanTetap.findIndex(b => b.id == id);
  if (idx >= 0) stateBebanTetap[idx] = { ...stateBebanTetap[idx], ...payload };
  row.classList.toggle('inactive', payload.aktif === false);
}

async function deleteBebanTetap(id) {
  if (!confirm('Hapus beban tetap ini? Riwayat transaksi yang sudah dicatat tidak akan terhapus.')) return;
  const { error } = await supa.from('pengeluaran_tetap').delete().eq('id', id);
  if (error) { toast('Gagal: ' + error.message, 'error'); return; }
  stateBebanTetap = stateBebanTetap.filter(b => b.id != id);
  renderBebanTetapTable();
  toast('Beban tetap dihapus.');
}

// Catat 1 beban → buat transaksi pengeluaran + update last_recorded_month
async function catatBebanTetap(id) {
  const item = stateBebanTetap.find(b => b.id == id);
  if (!item) return;
  const now = new Date();
  const cm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // Tanggal aktual: pakai tanggal_bayar di bulan ini
  const day = Math.min(item.tanggal_bayar, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
  const tanggal = `${cm}-${String(day).padStart(2, '0')}`;

  if (!confirm(`Catat beban: ${item.nama}\nNominal: Rp ${fmtNumber(item.nominal)}\nTanggal: ${fmtDate(tanggal)}\n\nLanjutkan?`)) return;

  const { error: txErr } = await supa.from('transaksi').insert({
    tanggal,
    tipe: 'pengeluaran',
    kategori: item.kategori,
    nominal: Number(item.nominal),
    catatan: `[Beban Tetap] ${item.nama}${item.catatan ? ' — ' + item.catatan : ''}`,
    dibuat_oleh: session.username
  });
  if (txErr) { toast('Gagal catat: ' + txErr.message, 'error'); return; }

  // Update last_recorded_month
  await supa.from('pengeluaran_tetap').update({ last_recorded_month: cm }).eq('id', id);
  const idx = stateBebanTetap.findIndex(b => b.id == id);
  if (idx >= 0) stateBebanTetap[idx].last_recorded_month = cm;

  toast(`✓ ${item.nama} tercatat (Rp ${fmtNumber(item.nominal)})`, 'success');
  renderBebanTetapTable();
  renderBebanBanner();
}

// Catat semua yang due sekaligus
async function catatSemuaBebanTetap() {
  const dueItems = stateBebanTetap.filter(isBebanDue);
  if (dueItems.length === 0) return;
  const total = dueItems.reduce((s, it) => s + Number(it.nominal), 0);
  if (!confirm(`Catat semua ${dueItems.length} beban tetap bulan ini?\nTotal: Rp ${fmtNumber(total)}\n\nLanjutkan?`)) return;

  const now = new Date();
  const cm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const txRows = dueItems.map(item => {
    const day = Math.min(item.tanggal_bayar, lastDay);
    return {
      tanggal: `${cm}-${String(day).padStart(2, '0')}`,
      tipe: 'pengeluaran',
      kategori: item.kategori,
      nominal: Number(item.nominal),
      catatan: `[Beban Tetap] ${item.nama}${item.catatan ? ' — ' + item.catatan : ''}`,
      dibuat_oleh: session.username
    };
  });

  const { error: txErr } = await supa.from('transaksi').insert(txRows);
  if (txErr) { toast('Gagal: ' + txErr.message, 'error'); return; }

  // Update last_recorded_month untuk semua
  const ids = dueItems.map(it => it.id);
  await supa.from('pengeluaran_tetap').update({ last_recorded_month: cm }).in('id', ids);
  dueItems.forEach(it => {
    const idx = stateBebanTetap.findIndex(b => b.id === it.id);
    if (idx >= 0) stateBebanTetap[idx].last_recorded_month = cm;
  });

  toast(`✓ ${dueItems.length} beban tetap tercatat (Rp ${fmtNumber(total)})`, 'success');
  renderBebanBanner();
  if (rekapTab === 'detail') renderRekapDetail();
}

// Banner di Dashboard
async function renderBebanBanner() {
  const banner = $('#bebanTetapBanner');
  if (!banner) return;
  if (stateBebanTetap.length === 0) await fetchBebanTetap();
  const dueItems = stateBebanTetap.filter(isBebanDue);
  if (dueItems.length === 0) {
    banner.style.display = 'none';
    return;
  }
  const total = dueItems.reduce((s, it) => s + Number(it.nominal), 0);
  const list = dueItems.map(it => `${it.nama} (Rp ${fmtNumber(it.nominal)})`).join(' · ');
  banner.innerHTML = `
    <div class="beban-banner-msg">
      🔔 <strong>${dueItems.length} beban tetap</strong> belum dicatat bulan ini — total <strong>${fmtRp(total)}</strong>
      <div class="beban-banner-list">${list}</div>
    </div>
    <div class="beban-banner-actions">
      <a href="#/pengaturan" class="btn btn-ghost btn-sm">Lihat</a>
      ${session.role === 'admin' ? '<button class="btn btn-primary btn-sm" id="catatSemuaBebanBtn">✓ Catat Semua</button>' : ''}
    </div>`;
  banner.style.display = 'flex';
  $('#catatSemuaBebanBtn')?.addEventListener('click', catatSemuaBebanTetap);
}

/* ===== End BEBAN TETAP ===== */

async function savePengaturan() {
  const target  = parseNum($('#settingTarget').value);
  // Komisi % adalah decimal (mis. 0.7% Xendit) — pakai parseFloat
  const kGo     = parseFloat($('#komisiGofood').value)  || 0;
  const kGrab   = parseFloat($('#komisiGrab').value)    || 0;
  const kShopee = parseFloat($('#komisiShopee').value)  || 0;
  const kWa     = parseFloat($('#komisiWa').value)      || 0;

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
    // Pakai harga rata-rata (moving average dari Belanja) — fallback ke harga_per_satuan
    const harga = Number(b.harga_rata_rata) || Number(b.harga_per_satuan) || 0;
    total += Number(r.jumlah) * harga;
  });
  return total;
}

function renderHppTable() {
  const p = statePengaturan;
  // Helper: tampilkan label ESTIMASI di atas tabel
  const helpBox = `<div class="bulk-help" style="margin-bottom: 14px;">
    ⚠️ <strong>Label: ESTIMASI</strong> — angka di tabel ini pakai harga rata-rata bahan (moving average dari Belanja) untuk hitung HPP & margin per menu.
    Untuk angka <strong>profit asli</strong> bulanan (kebenaran cuan), cek Dashboard "Laba Bersih Bulan Ini" — itu Omzet − total Pengeluaran periode, bukan estimasi.
  </div>`;
  const tableContainer = $('#hppHitung');
  // Inject helpBox sekali (kalau belum ada)
  if (!tableContainer.querySelector('.bulk-help')) {
    const existingHelp = tableContainer.querySelector('.bulk-help');
    if (!existingHelp) {
      tableContainer.insertAdjacentHTML('afterbegin', helpBox);
    }
  }

  const thead = $('#hppTable thead');
  thead.innerHTML = `
    <tr>
      <th class="menu-col">Menu</th>
      <th>Harga Jual</th>
      <th>HPP <span style="font-size: 0.65rem; color: var(--amber); margin-left: 4px;">ESTIMASI</span></th>
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
  const bahan = stateBahan.find(b => b.id == id);
  // Cek dulu apakah bahan ini dipakai di resep menu
  await fetchResep();
  const resepUses = stateResep.filter(r => r.bahan_id == id);
  const menuNames = resepUses.map(r => stateMenu.find(m => m.id === r.menu_id)?.nama).filter(Boolean);

  let msg = `Hapus bahan "${bahan?.nama}"?`;
  if (resepUses.length > 0) {
    msg += `\n\n⚠️ Bahan ini dipakai di ${resepUses.length} resep menu:\n${menuNames.map(n => '  • ' + n).join('\n')}\n\nResep yang pakai bahan ini akan ikut HILANG. Lanjutkan?`;
  }
  if (!confirm(msg)) return;

  // Delete resep yang refer dulu (FK constraint RESTRICT)
  if (resepUses.length > 0) {
    const { error: resepErr } = await supa.from('resep').delete().eq('bahan_id', id);
    if (resepErr) { toast('Gagal hapus resep: ' + resepErr.message, 'error'); return; }
  }
  const { error } = await supa.from('bahan').delete().eq('id', id);
  if (error) { toast('Gagal: ' + error.message, 'error'); return; }
  stateBahan = stateBahan.filter(b => b.id != id);
  await fetchResep();
  renderBahanTable();
  toast('Bahan dihapus.');
}

/* ===== BELANJA (1-pintu input → moving average + auto pengeluaran) ===== */

async function loadBelanja() {
  await Promise.all([fetchBahan(), fetchMenu(), fetchResep()]);
  // Default tanggal hari ini
  const dt = $('#belanjaTanggal');
  if (!dt.value) dt.value = todayISO();
  const mt = $('#belanjaMonth');
  if (!mt.value) mt.value = currentYearMonth();
  populateBelanjaBahanDropdown();
  wireBelanjaForm();
  await renderBelanjaList();
}

function populateBelanjaBahanDropdown() {
  const sel = $('#belanjaBahan');
  const current = sel.value;
  sel.innerHTML = `
    <option value="">— Pilih bahan / atau "non-bahan" untuk operasional —</option>
    <option value="__nonbahan__">⚙ Non-bahan (operasional/utility)</option>
    ${stateBahan.map(b => `<option value="${b.id}" data-satuan="${b.satuan}" data-harga="${b.harga_rata_rata || b.harga_per_satuan}">${escapeHtml(b.nama)} (per ${b.satuan}, avg Rp ${fmtNumber(b.harga_rata_rata || b.harga_per_satuan)})</option>`).join('')}
  `;
  if (current) sel.value = current;
}

function wireBelanjaForm() {
  const selBahan   = $('#belanjaBahan');
  const fields     = $('#belanjaNonBahanFields');
  const satuanSel  = $('#belanjaSatuan');
  const qtyInp     = $('#belanjaQty');
  const totalInp   = $('#belanjaTotal');
  const preview    = $('#belanjaPreview');
  const kategoriSel = $('#belanjaKategori');

  const updatePreview = () => {
    const qty = parseFloat(qtyInp.value.replace(',', '.')) || 0;
    const total = parseNum(totalInp.value);
    if (qty > 0 && total > 0) {
      const perSatuan = total / qty;
      preview.innerHTML = `Harga per ${satuanSel.value || 'satuan'}: <strong style="color: var(--ember);">${fmtRp(perSatuan)}</strong>`;
    } else {
      preview.innerHTML = 'Harga per satuan akan otomatis dihitung.';
    }
  };

  selBahan.onchange = () => {
    if (selBahan.value === '__nonbahan__') {
      fields.style.display = '';
      kategoriSel.value = 'Lain-lain';
    } else if (selBahan.value) {
      fields.style.display = 'none';
      const opt = selBahan.options[selBahan.selectedIndex];
      satuanSel.value = opt.dataset.satuan || 'kg';
      kategoriSel.value = 'Bahan';
    } else {
      fields.style.display = 'none';
    }
    updatePreview();
  };
  qtyInp.oninput = updatePreview;
  totalInp.addEventListener('input', updatePreview);
  satuanSel.onchange = updatePreview;

  $('#belanjaSaveBtn').onclick = saveBelanja;
  $('#belanjaResetBtn').onclick = resetBelanjaForm;
  $('#belanjaMonth').onchange = renderBelanjaList;
}

function resetBelanjaForm() {
  $('#belanjaBahan').value = '';
  $('#belanjaNamaCustom').value = '';
  $('#belanjaNonBahanFields').style.display = 'none';
  $('#belanjaQty').value = '';
  $('#belanjaTotal').value = '';
  $('#belanjaCatatan').value = '';
  $('#belanjaMasukHpp').checked = true;
  $('#belanjaPreview').textContent = 'Harga per satuan akan otomatis dihitung.';
}

async function saveBelanja() {
  const tanggal  = $('#belanjaTanggal').value || todayISO();
  const bahanVal = $('#belanjaBahan').value;
  const qty      = parseFloat($('#belanjaQty').value.replace(',', '.')) || 0;
  const total    = parseNum($('#belanjaTotal').value);
  const satuan   = $('#belanjaSatuan').value;
  const kategori = $('#belanjaKategori').value;
  const catatan  = $('#belanjaCatatan').value.trim() || null;
  const masukHpp = $('#belanjaMasukHpp').checked;

  if (qty <= 0)   { toast('Qty harus > 0', 'error'); return; }
  if (total <= 0) { toast('Total harga harus > 0', 'error'); return; }

  let bahanId = null;
  let namaItem = '';

  if (bahanVal === '__nonbahan__') {
    namaItem = $('#belanjaNamaCustom').value.trim();
    if (!namaItem) { toast('Isi nama item dulu', 'error'); return; }
  } else if (bahanVal) {
    bahanId = parseInt(bahanVal);
    const bahan = stateBahan.find(b => b.id === bahanId);
    if (!bahan) { toast('Bahan tidak ditemukan', 'error'); return; }
    namaItem = bahan.nama;
  } else {
    toast('Pilih bahan dulu', 'error'); return;
  }

  const hargaPerSatuan = total / qty;
  const btn = $('#belanjaSaveBtn');
  btn.disabled = true; btn.textContent = 'Menyimpan…';

  try {
    // 1. Insert belanja (dapatkan id-nya)
    const { data: belanjaRow, error: bErr } = await supa.from('belanja').insert({
      tanggal,
      bahan_id: bahanId,
      nama_item: namaItem,
      kategori,
      qty,
      satuan,
      total_harga: total,
      harga_per_satuan: hargaPerSatuan,
      masuk_hpp: masukHpp,
      jenis_biaya: 'variabel',
      catatan,
      dibuat_oleh: session.username
    }).select().single();
    if (bErr) throw bErr;

    // 2. Kalau ada bahan_id → update moving average di tabel bahan
    if (bahanId) {
      const bahan = stateBahan.find(b => b.id === bahanId);
      const oldQty = Number(bahan.qty_stok) || 0;
      const oldAvg = Number(bahan.harga_rata_rata) || Number(bahan.harga_per_satuan) || 0;

      // Convert qty belanja ke satuan bahan
      const qtyInBahanUnit = convertToBahanUnit(qty, satuan, bahan.satuan);
      const totalNewQty = oldQty + qtyInBahanUnit;
      const oldNilai = oldQty * oldAvg;
      const newAvg = totalNewQty > 0 ? (oldNilai + total) / totalNewQty : (total / qtyInBahanUnit);

      await supa.from('bahan').update({
        harga_rata_rata: newAvg,
        harga_per_satuan: newAvg,  // sync untuk backward compat
        qty_stok: totalNewQty
      }).eq('id', bahanId);

      // Update state cache
      bahan.harga_rata_rata = newAvg;
      bahan.harga_per_satuan = newAvg;
      bahan.qty_stok = totalNewQty;
    }

    // 3. Auto-insert sebagai transaksi pengeluaran (biar muncul di Rekap & Dashboard)
    const { data: txRow } = await supa.from('transaksi').insert({
      tanggal,
      tipe: 'pengeluaran',
      kategori,
      nominal: total,
      catatan: `[Belanja] ${namaItem} · ${qty} ${satuan} @ ${fmtRp(hargaPerSatuan)}${catatan ? ' — ' + catatan : ''}`,
      dibuat_oleh: session.username
    }).select().single();

    // Link kembali belanja.transaksi_id
    if (txRow) {
      await supa.from('belanja').update({ transaksi_id: txRow.id }).eq('id', belanjaRow.id);
    }

    btn.disabled = false; btn.textContent = '💾 Simpan Belanja';
    toast(`✓ Belanja ${namaItem} tersimpan (Rp ${fmtNumber(total)})${bahanId ? ' — HPP menu auto-update' : ''}`, 'success');
    resetBelanjaForm();
    populateBelanjaBahanDropdown();
    await renderBelanjaList();
  } catch (err) {
    btn.disabled = false; btn.textContent = '💾 Simpan Belanja';
    toast('Gagal: ' + err.message, 'error');
    console.error(err);
  }
}

async function renderBelanjaList() {
  const el = $('#belanjaList');
  const ym = $('#belanjaMonth').value || currentYearMonth();
  const range = monthRange(ym);
  const { data, error } = await supa.from('belanja')
    .select('*')
    .gte('tanggal', range.start)
    .lte('tanggal', range.end)
    .order('tanggal', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) { el.innerHTML = '<div class="empty-state">Gagal load: ' + error.message + '</div>'; return; }
  const items = data || [];
  if (items.length === 0) { el.innerHTML = '<div class="empty-state">Belum ada belanja bulan ini.</div>'; return; }

  const totalBulan = items.reduce((s, x) => s + Number(x.total_harga), 0);
  const isAdmin = session.role === 'admin';

  el.innerHTML = `
    <p class="text-muted" style="font-size: 0.85rem; margin-bottom: 12px;">${items.length} entri · Total bulan ini: <strong style="color: var(--amber);">${fmtRp(totalBulan)}</strong></p>
    <table class="detail-table">
      <thead>
        <tr>
          <th>Tanggal</th>
          <th>Item</th>
          <th>Qty</th>
          <th>Harga/Satuan</th>
          <th>Total</th>
          <th>Catatan</th>
          ${isAdmin ? '<th></th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${items.map(b => `
          <tr data-id="${b.id}">
            <td class="tanggal">${fmtDateShort(b.tanggal)}</td>
            <td><strong>${escapeHtml(b.nama_item)}</strong><div style="font-size: 0.72rem; color: var(--cream-dim); margin-top: 2px;">${b.kategori}${b.masuk_hpp ? ' · 🟠 HPP' : ' · ⚪ ops'}</div></td>
            <td class="nominal" style="color: var(--cream);">${b.qty} ${b.satuan}</td>
            <td class="nominal" style="color: var(--cream-dim);">${fmtRp(b.harga_per_satuan)}</td>
            <td class="nominal">${fmtRp(b.total_harga)}</td>
            <td class="catatan-cell ${!b.catatan ? 'empty' : ''}">${b.catatan ? escapeHtml(b.catatan) : '—'}</td>
            ${isAdmin ? `<td class="actions"><button class="delete delete-belanja-btn" data-del-id="${b.id}" title="Hapus">🗑</button></td>` : ''}
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  $$('.delete-belanja-btn').forEach(b => b.addEventListener('click', () => deleteBelanja(parseInt(b.dataset.delId))));
}

async function deleteBelanja(id) {
  if (!confirm('Hapus entri belanja ini?\n\n⚠️ Pengeluaran terkait juga akan ikut hilang.\n⚠️ Harga rata-rata bahan TIDAK auto-rollback (harus hitung manual kalau perlu).')) return;
  // Hapus transaksi terkait dulu
  const { data: b } = await supa.from('belanja').select('transaksi_id').eq('id', id).single();
  if (b?.transaksi_id) {
    await supa.from('transaksi').delete().eq('id', b.transaksi_id);
  }
  const { error } = await supa.from('belanja').delete().eq('id', id);
  if (error) { toast('Gagal: ' + error.message, 'error'); return; }
  toast('Entri belanja & pengeluaran terkait dihapus.', 'success');
  renderBelanjaList();
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

/* ===== Foto Upload modal (Supabase Storage) ===== */

// Compress image di client sebelum upload — biar gak buang-buang storage.
// 3-5 MB foto HP → ~100-300 KB JPEG 800px.
async function compressImage(file, maxDim = 800, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Compress gagal')), 'image/jpeg', quality);
    };
    reader.readAsDataURL(file);
  });
}

async function uploadMenuFoto(file, menuId) {
  const blob = await compressImage(file);
  const sizeKb = Math.round(blob.size / 1024);
  // Filename unik tiap upload — supaya browser gak cache versi lama
  const filename = `menu-${menuId}-${Date.now()}.jpg`;
  const { error } = await supa.storage
    .from('menu-photos')
    .upload(filename, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  const { data } = supa.storage.from('menu-photos').getPublicUrl(filename);
  return { url: data.publicUrl, sizeKb };
}

function openFotoModal(menuId) {
  const menu = stateMenu.find(m => m.id == menuId);
  if (!menu) return;

  const overlay = document.createElement('div');
  overlay.className = 'foto-modal-overlay';
  overlay.innerHTML = `
    <div class="foto-modal">
      <h3>Foto Menu: ${menu.nama}</h3>
      <label for="fotoFileInput" class="preview-area" id="fotoPreview" style="cursor: pointer;">
        ${menu.foto_url
          ? `<img src="${menu.foto_url}" alt="" />`
          : '<div style="text-align: center; padding: 24px;"><div style="font-size: 2.4rem;">📷</div><div style="margin-top: 6px;">Klik untuk pilih foto</div><div style="font-size: 0.75rem; margin-top: 4px;">JPG / PNG / WebP · max 10 MB</div></div>'
        }
      </label>
      <input type="file" id="fotoFileInput" accept="image/*" style="display: none;" />
      <p class="text-muted" id="fotoStatus" style="font-size: 0.82rem; margin-top: 8px; min-height: 20px;"></p>
      <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px;">
        <button class="btn btn-ghost btn-sm" id="fotoCancel">Tutup</button>
        ${menu.foto_url ? '<button class="btn btn-ghost btn-sm" id="fotoClear" style="color: var(--red);">🗑 Hapus Foto</button>' : ''}
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const fileInput = $('#fotoFileInput');
  const status = $('#fotoStatus');
  const preview = $('#fotoPreview');

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      status.textContent = '⚠ Bukan file gambar.'; return;
    }
    if (file.size > 10 * 1024 * 1024) {
      status.textContent = '⚠ Ukuran > 10 MB. Coba foto yang lebih kecil.'; return;
    }
    status.textContent = '⏳ Compressing & upload…';
    try {
      const { url, sizeKb } = await uploadMenuFoto(file, menuId);
      // Save URL ke menu table
      const { error } = await supa.from('menu').update({ foto_url: url }).eq('id', menuId);
      if (error) throw error;
      const m = stateMenu.find(x => x.id == menuId);
      if (m) m.foto_url = url;
      preview.innerHTML = `<img src="${url}" alt="" />`;
      status.textContent = `✓ Foto tersimpan (${sizeKb} KB)`;
      renderMenuTable();
      toast('Foto menu di-update.', 'success');
    } catch (err) {
      status.textContent = '⚠ Upload gagal: ' + err.message;
      console.error(err);
    }
  });

  $('#fotoCancel').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  $('#fotoClear')?.addEventListener('click', async () => {
    if (!confirm('Hapus foto menu ini?')) return;
    await supa.from('menu').update({ foto_url: null }).eq('id', menuId);
    const m = stateMenu.find(x => x.id == menuId);
    if (m) m.foto_url = null;
    overlay.remove();
    renderMenuTable();
    toast('Foto dihapus.');
  });
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

// Konversi unit: kg ↔ gram, liter ↔ ml
function getResepUnitOptions(satuanBahan) {
  if (satuanBahan === 'kg')    return ['kg', 'gram'];
  if (satuanBahan === 'liter') return ['liter', 'ml'];
  return [satuanBahan || ''];
}
function convertToBahanUnit(jumlah, satuanInput, satuanBahan) {
  if (!jumlah || satuanInput === satuanBahan) return jumlah;
  if (satuanInput === 'gram' && satuanBahan === 'kg')    return jumlah / 1000;
  if (satuanInput === 'ml'   && satuanBahan === 'liter') return jumlah / 1000;
  return jumlah;
}

function resepRowHtml(r = {}) {
  const opts = stateBahan.map(b => `<option value="${b.id}" data-satuan="${b.satuan}" ${r.bahan_id === b.id ? 'selected' : ''}>${b.nama} (Rp ${Number(b.harga_per_satuan).toLocaleString('id-ID')}/${b.satuan})</option>`).join('');
  const bahan = stateBahan.find(b => b.id === r.bahan_id);
  const bahanSatuan = bahan?.satuan || '';

  // Default display unit: kalau bahan kg dan jumlah < 1, otomatis tampil gram
  let displayUnit   = bahanSatuan;
  let displayJumlah = r.jumlah || '';
  if (r.jumlah && bahanSatuan === 'kg' && r.jumlah < 1) {
    displayUnit = 'gram';
    displayJumlah = Math.round(r.jumlah * 1000);
  } else if (r.jumlah && bahanSatuan === 'liter' && r.jumlah < 1) {
    displayUnit = 'ml';
    displayJumlah = Math.round(r.jumlah * 1000);
  }

  const unitOpts = getResepUnitOptions(bahanSatuan).map(u =>
    `<option value="${u}" ${u === displayUnit ? 'selected' : ''}>${u}</option>`
  ).join('');

  return `<div class="resep-row" data-bahan-id="${r.bahan_id || ''}">
    <select class="resep-bahan"><option value="">— Pilih Bahan —</option>${opts}</select>
    <input type="number" class="resep-jumlah" inputmode="decimal" step="any" min="0" value="${displayJumlah}" placeholder="contoh: 150" />
    <select class="resep-satuan">${unitOpts}</select>
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
    const satuanSel = $('.resep-satuan', row);

    // Saat bahan berubah → refresh dropdown satuan ikut bahannya
    sel.addEventListener('change', () => {
      const opt = sel.options[sel.selectedIndex];
      const bahanSatuan = opt?.dataset.satuan || '';
      const units = getResepUnitOptions(bahanSatuan);
      satuanSel.innerHTML = units.map(u => `<option value="${u}">${u}</option>`).join('');
      recalcResepTotal();
    });
    satuanSel.addEventListener('change', recalcResepTotal);
    $('.resep-jumlah', row).addEventListener('input', recalcResepTotal);
    $('.row-delete', row).addEventListener('click', () => { row.remove(); recalcResepTotal(); });
  });
}

function recalcResepTotal() {
  let total = 0;
  $$('.resep-row').forEach(row => {
    const bahanId     = parseInt($('.resep-bahan', row).value);
    const jumlah      = parseFloat($('.resep-jumlah', row).value) || 0;
    const satuanInput = $('.resep-satuan', row)?.value || '';
    const bahan       = stateBahan.find(b => b.id === bahanId);
    if (bahan && jumlah) {
      // Convert ke satuan bahan dulu (mis. 150 gram → 0.15 kg) sebelum dikalikan harga
      const jumlahInBahanUnit = convertToBahanUnit(jumlah, satuanInput, bahan.satuan);
      total += jumlahInBahanUnit * Number(bahan.harga_per_satuan);
    }
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
    const bahanId     = parseInt($('.resep-bahan', row).value);
    const jumlah      = parseFloat($('.resep-jumlah', row).value) || 0;
    const satuanInput = $('.resep-satuan', row)?.value || '';
    const bahan       = stateBahan.find(b => b.id === bahanId);
    if (bahanId && jumlah > 0 && bahan) {
      // Convert ke satuan bahan (mis. 150 gram → 0.15 kg) sebelum simpan
      const jumlahFinal = convertToBahanUnit(jumlah, satuanInput, bahan.satuan);
      newItems.push({ menu_id: menuId, bahan_id: bahanId, jumlah: jumlahFinal });
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

  // Kalau QRIS → lewat flow Xendit (save pesanan + generate QR + tunggu lunas)
  if (posMetodeBayar === 'QRIS') {
    return checkoutQris();
  }

  // Tunai flow (default)
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

/* ============ QRIS DINAMIS via Xendit ============ */
let qrisPollInterval = null;
let qrisCountdownInterval = null;

async function checkoutQris() {
  const btn = $('#posCheckoutBtn');
  btn.disabled = true; btn.textContent = 'Generating QR…';

  const total = cart.reduce((s, c) => s + (c.harga * c.qty), 0);
  const totalHpp = cart.reduce((s, c) => s + (c.hpp * c.qty), 0);
  const meja = $('#posMejaNama').value.trim();

  // 1. Pastikan pesanan tersimpan (atau update kalau sudah dikirim ke dapur)
  let pesananId = currentPesananId;
  let pesananData;
  if (pesananId) {
    const { data, error } = await supa.from('pesanan').update({
      total, total_hpp: totalHpp, metode_bayar: 'QRIS',
      meja_atau_nama: meja || null, status: 'selesai'
    }).eq('id', pesananId).select().single();
    if (error) {
      btn.disabled = false; btn.textContent = '💾 Bayar & Cetak Struk';
      toast('Gagal update pesanan: ' + error.message, 'error'); return;
    }
    pesananData = data;
    await supa.from('pesanan_item').delete().eq('pesanan_id', pesananId);
    await supa.from('pesanan_item').insert(cart.map(c => ({
      pesanan_id: pesananId, menu_id: c.menu_id, nama_menu: c.nama,
      qty: c.qty, harga: c.harga, hpp: c.hpp, subtotal: c.harga * c.qty,
      catatan: c.catatan || null
    })));
  } else {
    const { data, error } = await supa.from('pesanan').insert({
      channel: posChannel, kasir: session.username,
      total, total_hpp: totalHpp, metode_bayar: 'QRIS',
      meja_atau_nama: meja || null, status: 'selesai'
    }).select().single();
    if (error) {
      btn.disabled = false; btn.textContent = '💾 Bayar & Cetak Struk';
      toast('Gagal: ' + error.message, 'error'); return;
    }
    pesananData = data;
    pesananId = data.id;
    currentPesananId = pesananId;
    await supa.from('pesanan_item').insert(cart.map(c => ({
      pesanan_id: pesananId, menu_id: c.menu_id, nama_menu: c.nama,
      qty: c.qty, harga: c.harga, hpp: c.hpp, subtotal: c.harga * c.qty,
      catatan: c.catatan || null
    })));
  }

  // 2. Call Edge Function create-qris
  let qrData;
  try {
    const res = await fetch(CFG.XENDIT_CREATE_QRIS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CFG.SUPABASE_ANON_KEY,
        'apikey': CFG.SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ pesanan_id: pesananId, amount: total })
    });
    qrData = await res.json();
    if (!res.ok || !qrData.qr_string) {
      throw new Error(qrData.error || 'create-qris gagal');
    }
  } catch (err) {
    btn.disabled = false; btn.textContent = '💾 Bayar & Cetak Struk';
    toast('QR gagal: ' + err.message + ' — coba Tunai dulu.', 'error');
    return;
  }

  btn.disabled = false; btn.textContent = '💾 Bayar & Cetak Struk';

  // 3. Render QR modal
  showQrisModal(pesananData, qrData, total);
}

function showQrisModal(pesanan, qrData, total) {
  // Cleanup previous polling kalau ada
  if (qrisPollInterval) clearInterval(qrisPollInterval);
  if (qrisCountdownInterval) clearInterval(qrisCountdownInterval);

  const overlay = document.createElement('div');
  overlay.className = 'qris-modal-overlay';
  overlay.id = 'qrisModalOverlay';
  overlay.innerHTML = `
    <div class="qris-modal">
      <div class="qris-header">
        <h2>Scan QRIS untuk Bayar</h2>
        <button class="modal-close" id="qrisCloseBtn" aria-label="Tutup">✕</button>
      </div>
      <div class="qris-amount">${fmtRp(total)}</div>
      <div class="qris-info">Pesanan #${pesanan.id} · ${pesanan.channel}${pesanan.meja_atau_nama ? ' · ' + pesanan.meja_atau_nama : ''}</div>

      <div class="qris-canvas-wrap">
        <canvas id="qrisCanvas"></canvas>
      </div>

      <div class="qris-status" id="qrisStatus">
        <span class="qris-status-icon">⏳</span>
        <span class="qris-status-text">Menunggu pembayaran…</span>
      </div>

      <div class="qris-meta">
        <div>Expire dalam: <strong id="qrisCountdown">15:00</strong></div>
        <div class="text-muted" style="font-size: 0.78rem; margin-top: 4px;">Buka aplikasi e-wallet / mobile banking → Scan QR</div>
      </div>

      <div style="display: flex; gap: 8px; margin-top: 16px;">
        <button class="btn btn-ghost btn-sm" id="qrisCancelBtn" style="flex: 1;">Batalkan & Bayar Tunai</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Render QR
  QRCode.toCanvas(document.getElementById('qrisCanvas'), qrData.qr_string, {
    width: 280,
    margin: 1,
    color: { dark: '#16100c', light: '#f4ead7' }
  }, (err) => {
    if (err) console.error('QR render error:', err);
  });

  // Close button → konfirmasi cancel
  $('#qrisCloseBtn').onclick = () => cancelQris(pesanan.id);
  $('#qrisCancelBtn').onclick = () => cancelQris(pesanan.id);

  // Countdown timer
  const expiresAt = new Date(qrData.expires_at).getTime();
  qrisCountdownInterval = setInterval(() => {
    const diff = expiresAt - Date.now();
    if (diff <= 0) {
      clearInterval(qrisCountdownInterval);
      $('#qrisCountdown').textContent = 'Expired';
      updateQrisStatusUI('expired');
      stopQrisPolling();
      return;
    }
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    $('#qrisCountdown').textContent = `${m}:${String(s).padStart(2, '0')}`;
  }, 1000);

  // Poll pembayaran status tiap 2 detik
  qrisPollInterval = setInterval(() => pollQrisStatus(pesanan.id, qrData.pembayaran_id), 2000);
}

async function pollQrisStatus(pesananId, pembayaranId) {
  const { data, error } = await supa
    .from('pembayaran')
    .select('status')
    .eq('id', pembayaranId)
    .single();
  if (error || !data) return;

  if (data.status === 'LUNAS') {
    stopQrisPolling();
    updateQrisStatusUI('lunas');
    // Tunggu 1 detik supaya user lihat status berubah, lalu cetak struk + close
    setTimeout(async () => {
      const { data: p } = await supa.from('pesanan').select('*').eq('id', pesananId).single();
      const itemsForPrint = cart.map(c => ({ nama_menu: c.nama, qty: c.qty, harga: c.harga, hpp: c.hpp }));
      printReceipt(p, itemsForPrint);
      closeQrisModal();
      cart = [];
      currentPesananId = null;
      $('#posMejaNama').value = '';
      $('#posSendKitchenBtn').textContent = '👨‍🍳 Kirim ke Dapur (cetak tiket)';
      renderCart();
      renderPosMenuGrid();
      await refreshTodayPesanan();
      toast(`✓ Pembayaran QRIS pesanan #${pesananId} lunas`, 'success');
    }, 1200);
  } else if (data.status === 'EXPIRED' || data.status === 'GAGAL') {
    stopQrisPolling();
    updateQrisStatusUI(data.status.toLowerCase());
  }
}

function updateQrisStatusUI(status) {
  const el = $('#qrisStatus');
  if (!el) return;
  const map = {
    lunas:   { icon: '✓', text: 'Pembayaran berhasil!', cls: 'lunas' },
    expired: { icon: '⏰', text: 'QR expired — buat ulang atau bayar tunai', cls: 'expired' },
    gagal:   { icon: '✕', text: 'Pembayaran gagal', cls: 'gagal' }
  };
  const m = map[status] || { icon: '⏳', text: 'Menunggu pembayaran…', cls: '' };
  el.className = 'qris-status ' + m.cls;
  el.querySelector('.qris-status-icon').textContent = m.icon;
  el.querySelector('.qris-status-text').textContent = m.text;
}

function stopQrisPolling() {
  if (qrisPollInterval) { clearInterval(qrisPollInterval); qrisPollInterval = null; }
  if (qrisCountdownInterval) { clearInterval(qrisCountdownInterval); qrisCountdownInterval = null; }
}

function closeQrisModal() {
  stopQrisPolling();
  $('#qrisModalOverlay')?.remove();
}

async function cancelQris(pesananId) {
  if (!confirm('Batalkan QRIS & ganti ke Tunai?\n\nPesanan tetap tersimpan, kamu bisa Bayar lagi dengan Tunai.')) return;
  stopQrisPolling();
  closeQrisModal();
  // Switch ke Tunai
  posMetodeBayar = 'Tunai';
  $$('.pos-channel-pill[data-bayar]').forEach(b => b.classList.toggle('active', b.dataset.bayar === 'Tunai'));
  toast('Switch ke Tunai — klik Bayar lagi untuk selesaikan.', 'success');
}

/* ============ END QRIS ============ */

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
  $('#rekapMonth').addEventListener('change', renderRekapByTab);
  $('#exportCsvBtn').addEventListener('click', exportCsv);
  $$('#rekapTabs button').forEach(b => b.addEventListener('click', () => showRekapTab(b.dataset.rekapTab)));

  // Pengaturan
  $('#saveSettingsBtn').addEventListener('click', savePengaturan);
  $('#addBebanTetapBtn')?.addEventListener('click', addBebanTetap);

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
