/**
 * monthly.js — iPad 月次管理ページ（売上・コスト統合）
 * ------------------------------------------------------------
 * 入力ロジックの正本は sales.js / cost.js（MD §6-3-B 入力正本1本化）。
 * 本ファイルは「2カラムの器・売上/コストの大タブ切替・売上コスト統合一覧と集計」を担う。
 * sales.js / cost.js の後に読み込み、_loadIpadSalesData / _loadIpadCostData を
 * 月次統合再読込（moLoadMonthly）に差し替えることで、各フォームの submit 後フックを
 * 統合一覧の再描画へ接続する。
 * data-page="monthly" のときのみ動作する。スマホ・他ページには影響しない。
 */
'use strict';

let _moHistory = [];          // 売上・コスト統合（正規化済み）
let _moCurrentMonth = '';

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.page !== 'monthly') return;
  if (!document.body.classList.contains('is-ipad')) return; // 月次管理はiPad専用UI

  // フォームHTMLが参照するマスタを先に用意（cost.js 側の共通取得）
  if (typeof getCostMaster === 'function') {
    try { costMaster = getCostMaster(); } catch (_) {}
  }
  if (typeof loadCostMasterFromGAS === 'function') loadCostMasterFromGAS();

  moBuildForms();
  moBindTabs();
  moInitMonthFilter();
  moBindListFilters();
  moLoadMonthly();
});

/* ════════════════════════════════════════════════════════════
   monthly 専用 自作入力フォーム（iPad）
   ------------------------------------------------------------
   sales.js / cost.js のフォーム生成は使わず、monthly.js が自前で描画する。
   OSキーボード・OSカレンダーを一切呼ばない（発生日＝自作カレンダー／金額＝自作テンキー）。
   選んだ項目は上部に確定ブロックで積層・タップで個別再編集。
   税計算は calcTax、送信は callGAS('addSales'/'addCost') を流用（入力正本は送信ロジックで共通）。
   ════════════════════════════════════════════════════════════ */

const _moForm = {
  sales: { date: '', svcCode: '', svcName: '', taxRate: null, miscName: '', amount: '', memo: '', unpaid: false, editing: 'item' },
  cost:  { date: '', divCode: '2', itemCode: '', itemName: '', taxRate: null, miscName: '', amount: '', memo: '', unpaid: false, editing: 'item' },
};

function moBuildForms() {
  moInitFormState('sales');
  moInitFormState('cost');
  moRenderForm('sales');
  moRenderForm('cost');
}

function moInitFormState(kind) {
  const f = _moForm[kind];
  f.date = (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10);
  f.amount = '';
  f.memo = '';
  f.unpaid = false;
  f.miscName = '';
  f.editing = 'item';
  if (kind === 'sales') { f.svcCode = ''; f.svcName = ''; f.taxRate = null; }
  else { f.divCode = '2'; f.itemCode = ''; f.itemName = ''; f.taxRate = null; }
}

/* マスタ取得（売上＝サービス／コスト＝区分内科目） */
function moGetItems(kind) {
  if (kind === 'sales') {
    try { return (typeof getServiceMaster === 'function') ? getServiceMaster() : []; }
    catch { return []; }
  }
  try { return (typeof getDivisionItems === 'function')
    ? getDivisionItems(_moForm.cost.divCode, { filterBySmartphoneVisible: true }) : []; }
  catch { return []; }
}

function moIsMisc(kind, code) {
  return /MISC/i.test(String(code || ''));
}

/* ── フォーム全体を描画 ───────────────────────────────── */
function moRenderForm(kind) {
  const box = document.getElementById(kind === 'sales' ? 'mo-form-sales' : 'mo-form-cost');
  if (!box) return;
  const f = _moForm[kind];

  const itemLabel = kind === 'sales'
    ? (f.svcName ? f.svcName + (f.miscName ? `（${f.miscName}）` : '') : '')
    : (f.itemName ? `${moCostDivLabel(f.divCode)}／${f.itemName}` + (f.miscName ? `（${f.miscName}）` : '') : '');

  const blocks = [];
  // 確定ブロック：発生日（常に確定済みとして上に表示）
  blocks.push(moBlock('date', '発生日', moFmtDate(f.date)));
  // 確定ブロック：科目（選択済みのとき）
  if (moItemResolved(kind)) {
    const taxTxt = f.taxRate != null ? `（${f.taxRate === 0 ? '非課税' : f.taxRate + '%'}）` : '';
    blocks.push(moBlock('item', kind === 'sales' ? '区分' : '科目', itemLabel + taxTxt));
  }
  // 確定ブロック：金額（入力済みのとき）
  if (f.amount && parseInt(f.amount, 10) > 0) {
    blocks.push(moBlock('amount', '金額', moFmtAmt(f.amount)));
  }

  // 編集エリア（現在の editing ステップの操作UI）
  let editor = '';
  if (f.editing === 'date')   editor = moEditorDate(kind);
  else if (f.editing === 'item') editor = moEditorItem(kind);
  else if (f.editing === 'amount') editor = moEditorAmount(kind);

  // 状況トグル＋メモ＋登録（科目・金額が揃ったら表示）
  const ready = moItemResolved(kind) && f.amount && parseInt(f.amount, 10) > 0;
  const tail = ready ? moEditorTail(kind) : '';

  // 入力途中の取消（科目か金額が入っていれば表示）
  const canReset = moItemResolved(kind) || (f.amount && parseInt(f.amount, 10) > 0);
  const resetBtn = canReset ? `<button type="button" class="mo-reset" data-kind="${kind}">入力をリセット</button>` : '';

  box.innerHTML =
    `<div class="mo-stack">${blocks.join('')}</div>` +
    `<div class="mo-editor">${editor}</div>` +
    resetBtn +
    tail;

  moBindForm(kind);
}

function moItemResolved(kind) {
  const f = _moForm[kind];
  return kind === 'sales' ? !!f.svcCode : !!f.itemCode;
}

function moBlock(step, label, value) {
  return `<button type="button" class="mo-chip" data-step="${step}">
    <span class="mo-chip-k">${label}</span>
    <span class="mo-chip-v">${_moEsc(value || '未入力')}</span>
    <span class="mo-chip-edit">変更</span>
  </button>`;
}

function moCostDivLabel(code) { return code === '1' ? '仕入原価' : '販管費'; }

/* ── 各エディタUI ─────────────────────────────────────── */
function moEditorDate(kind) {
  return `<div class="mo-ed-head">発生日を選択</div>
    <div class="mo-cal" id="mo-cal-${kind}"></div>`;
}

function moEditorItem(kind) {
  const f = _moForm[kind];
  let divTabs = '';
  if (kind === 'cost') {
    divTabs = `<div class="mo-divtabs">
      <button type="button" class="mo-divtab ${f.divCode==='1'?'is-active':''}" data-div="1">仕入原価</button>
      <button type="button" class="mo-divtab ${f.divCode==='2'?'is-active':''}" data-div="2">販管費</button>
    </div>`;
  }
  const items = moGetItems(kind);
  const sel = kind === 'sales' ? f.svcCode : f.itemCode;
  const cards = items.map(it => `
    <button type="button" class="mo-card ${it.code===sel?'is-active':''}" data-code="${_moEsc(it.code)}" data-name="${_moEsc(it.name)}" data-tax="${it.taxRate ?? 10}">
      ${_moEsc(it.name)}
    </button>`).join('');
  // 諸口名称（諸口選択時）
  const miscBox = (sel && moIsMisc(kind, sel))
    ? `<div class="mo-misc"><label class="mo-misc-label">品目名（任意）</label>
        <input type="text" class="mo-misc-input" id="mo-misc-${kind}" maxlength="50" value="${_moEsc(f.miscName)}" placeholder="例：手土産代"></div>`
    : '';
  // 税率チップ（科目選択後）
  const taxChips = sel
    ? `<div class="mo-ed-sub">税率</div>
       <div class="mo-taxchips">
         ${[10,8,0].map(r => `<button type="button" class="mo-taxchip ${f.taxRate===r?'is-active':''}" data-rate="${r}">${r===0?'非課税':r+'%'}</button>`).join('')}
       </div>` : '';
  return `${divTabs}
    <div class="mo-ed-head">${kind==='sales'?'サービスを選択':'科目を選択'}</div>
    <div class="mo-cards">${cards}</div>
    ${miscBox}
    ${taxChips}`;
}

function moEditorAmount(kind) {
  const f = _moForm[kind];
  const disp = f.amount ? moFmtAmt(f.amount) : '¥0';
  const tax = (f.taxRate != null && f.amount) ? calcTax(parseInt(f.amount,10), f.taxRate).tax : 0;
  const keys = ['7','8','9','4','5','6','1','2','3','00','0','del'];
  const keyHtml = keys.map(k => {
    if (k === 'del') return `<button type="button" class="mo-key mo-key--del" data-key="del">←</button>`;
    return `<button type="button" class="mo-key" data-key="${k}">${k}</button>`;
  }).join('');
  return `<div class="mo-ed-head">金額（税込）</div>
    <div class="mo-amount-disp">${disp}<span class="mo-amount-yen">円</span></div>
    <div class="mo-amount-tax">内消費税 ${tax.toLocaleString('ja-JP')} 円</div>
    <div class="mo-keypad">${keyHtml}
      <button type="button" class="mo-key mo-key--clear" data-key="clear">クリア</button>
    </div>`;
}

function moEditorTail(kind) {
  const f = _moForm[kind];
  const stateLabel = kind === 'sales' ? '売掛（未入金）として登録' : '買掛（未払い）として登録';
  const btnLabel = `発生日 ${moFmtDate(f.date)}　登録する`;
  return `<div class="mo-tail">
    <label class="mo-toggle">
      <input type="checkbox" class="mo-unpaid" ${f.unpaid?'checked':''}>
      <span>${stateLabel}</span>
    </label>
    <label class="mo-memo-label">メモ（任意）</label>
    <textarea class="mo-memo" rows="2" placeholder="">${_moEsc(f.memo)}</textarea>
    <button type="button" class="mo-submit" data-kind="${kind}">${btnLabel}</button>
  </div>`;
}

/* ── イベント結線 ─────────────────────────────────────── */
function moBindForm(kind) {
  const box = document.getElementById(kind === 'sales' ? 'mo-form-sales' : 'mo-form-cost');
  if (!box) return;
  const f = _moForm[kind];

  // 確定ブロックタップ＝そのステップを編集
  box.querySelectorAll('.mo-chip').forEach(chip => {
    chip.addEventListener('click', () => { f.editing = chip.dataset.step; moRenderForm(kind); });
  });

  // 発生日カレンダー描画
  if (f.editing === 'date') moRenderCalendar(kind);

  // 区分タブ（コスト）
  box.querySelectorAll('.mo-divtab').forEach(tab => {
    tab.addEventListener('click', () => {
      f.divCode = tab.dataset.div;
      f.itemCode = ''; f.itemName = ''; f.taxRate = null; f.miscName = '';
      moRenderForm(kind);
    });
  });

  // 科目カード
  box.querySelectorAll('.mo-card').forEach(card => {
    card.addEventListener('click', () => {
      if (kind === 'sales') { f.svcCode = card.dataset.code; f.svcName = card.dataset.name; }
      else { f.itemCode = card.dataset.code; f.itemName = card.dataset.name; }
      f.taxRate = parseInt(card.dataset.tax, 10);
      if (!moIsMisc(kind, card.dataset.code)) f.miscName = '';
      moRenderForm(kind);
    });
  });

  // 諸口名称
  const misc = box.querySelector('.mo-misc-input');
  if (misc) misc.addEventListener('input', () => { f.miscName = misc.value; });

  // 税率チップ
  box.querySelectorAll('.mo-taxchip').forEach(chip => {
    chip.addEventListener('click', () => {
      f.taxRate = parseInt(chip.dataset.rate, 10);
      // 科目・税率が決まったら金額入力へ自動で進める
      f.editing = 'amount';
      moRenderForm(kind);
    });
  });

  // テンキー
  box.querySelectorAll('.mo-key').forEach(key => {
    key.addEventListener('click', () => {
      const k = key.dataset.key;
      let cur = String(f.amount || '');
      if (k === 'clear') cur = '';
      else if (k === 'del') cur = cur.slice(0, -1);
      else cur = (cur + k).replace(/^0+(?=\d)/, '');
      if (cur.length > 10) cur = cur.slice(0, 10);
      f.amount = cur;
      moRenderForm(kind);
    });
  });

  // 状況トグル
  const unpaid = box.querySelector('.mo-unpaid');
  if (unpaid) unpaid.addEventListener('change', () => { f.unpaid = unpaid.checked; });

  // メモ
  const memo = box.querySelector('.mo-memo');
  if (memo) memo.addEventListener('input', () => { f.memo = memo.value; });

  // 登録
  const submit = box.querySelector('.mo-submit');
  if (submit) submit.addEventListener('click', () => moSubmitForm(kind));

  // リセット（入力途中の取消）
  const reset = box.querySelector('.mo-reset');
  if (reset) reset.addEventListener('click', () => {
    moInitFormState(kind);
    _moCalView[kind] = null;
    moRenderForm(kind);
  });
}

/* ── 自作カレンダー ───────────────────────────────────── */
const _moCalView = { sales: null, cost: null };
function moRenderCalendar(kind) {
  const host = document.getElementById('mo-cal-' + kind);
  if (!host) return;
  const f = _moForm[kind];
  const base = _moCalView[kind] || (f.date ? new Date(f.date) : new Date());
  _moCalView[kind] = base;
  const y = base.getFullYear(), m = base.getMonth();
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const sel = f.date ? new Date(f.date) : null;

  let cells = '';
  const dows = ['日','月','火','水','木','金','土'];
  cells += dows.map(d => `<div class="mo-cal-dow">${d}</div>`).join('');
  for (let i = 0; i < startDow; i++) cells += `<div class="mo-cal-cell mo-cal-empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const isSel = sel && sel.getFullYear()===y && sel.getMonth()===m && sel.getDate()===d;
    cells += `<button type="button" class="mo-cal-cell ${isSel?'is-sel':''}" data-day="${d}">${d}</button>`;
  }
  host.innerHTML = `
    <div class="mo-cal-bar">
      <button type="button" class="mo-cal-nav" data-nav="-1">‹</button>
      <span class="mo-cal-title">${y}年${m+1}月</span>
      <button type="button" class="mo-cal-nav" data-nav="1">›</button>
    </div>
    <div class="mo-cal-grid">${cells}</div>`;

  host.querySelectorAll('.mo-cal-nav').forEach(b => b.addEventListener('click', () => {
    _moCalView[kind] = new Date(y, m + parseInt(b.dataset.nav,10), 1);
    moRenderCalendar(kind);
  }));
  host.querySelectorAll('.mo-cal-cell[data-day]').forEach(c => c.addEventListener('click', () => {
    const dd = parseInt(c.dataset.day, 10);
    f.date = `${y}-${String(m+1).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    f.editing = moItemResolved(kind) ? (f.amount ? null : 'amount') : 'item';
    moRenderForm(kind);
  }));
}

/* ── 登録 ─────────────────────────────────────────────── */
async function moSubmitForm(kind) {
  const f = _moForm[kind];
  const amount = parseInt(f.amount || '0', 10);
  if (!moItemResolved(kind)) { moToast('科目を選択してください'); return; }
  if (!amount || amount <= 0) { moToast('金額を入力してください'); return; }
  if (f.taxRate == null) { moToast('税率を選択してください'); return; }

  const { taxExcluded, tax } = calcTax(amount, f.taxRate);
  const btn = document.querySelector(`#mo-form-${kind} .mo-submit`);
  if (btn) { btn.disabled = true; btn.textContent = '登録中...'; }

  try {
    let result;
    if (kind === 'sales') {
      result = await callGAS('addSales', {
        date: f.date, serviceCode: f.svcCode, serviceName: f.svcName,
        miscItemName: moIsMisc('sales', f.svcCode) ? f.miscName : '',
        amountExTax: taxExcluded, taxRate: f.taxRate, tax, amountInTax: amount,
        memo: f.memo, uncollected: f.unpaid ? 1 : 0,
      });
    } else {
      result = await callGAS('addCost', {
        date: f.date, divisionCode: f.divCode, divisionName: moCostDivLabel(f.divCode),
        itemCode: f.itemCode, itemName: f.itemName,
        miscItemName: moIsMisc('cost', f.itemCode) ? f.miscName : '',
        taxExcluded, taxRate: f.taxRate, tax, taxIncluded: amount,
        memo: f.memo, unpaid: f.unpaid ? 1 : 0, staffId: '', staffName: '', clientId: '',
      });
    }
    if (result?.status !== 'ok') throw new Error(result?.message || '登録エラー');
    moToast(kind === 'sales' ? '売上を登録しました ✓' : 'コストを登録しました ✓');
    moInitFormState(kind);
    moRenderForm(kind);
    moLoadMonthly();
  } catch (e) {
    moToast('登録に失敗しました：' + (e?.message || '通信エラー'));
    if (btn) { btn.disabled = false; btn.textContent = `発生日 ${moFmtDate(f.date)}　登録する`; }
  }
}

function moToast(msg) {
  if (typeof showToast === 'function') { showToast(msg, 'info'); return; }
  let t = document.getElementById('mo-toast');
  if (!t) { t = document.createElement('div'); t.id = 'mo-toast'; t.className = 'mo-toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

/* ── 大タブ切替 ───────────────────────────────────────── */
function moBindTabs() {
  document.querySelectorAll('.ipad-input-tabs .ipad-tab[data-motab]').forEach(btn => {
    btn.addEventListener('click', () => moSwitchTab(btn.dataset.motab));
  });
}
function moSwitchTab(tab) {
  document.querySelectorAll('.ipad-input-tabs .ipad-tab[data-motab]').forEach(btn => {
    btn.classList.toggle('ipad-tab--active', btn.dataset.motab === tab);
  });
  const salesBox = document.getElementById('mo-form-sales');
  const costBox  = document.getElementById('mo-form-cost');
  if (salesBox) salesBox.style.display = tab === 'sales' ? '' : 'none';
  if (costBox)  costBox.style.display  = tab === 'cost'  ? '' : 'none';
}

function moFmtAmt(v) {
  const n = parseInt(String(v ?? '').replace(/[^0-9]/g, ''), 10);
  return '¥' + (isNaN(n) ? 0 : n).toLocaleString('ja-JP');
}
function moFmtDate(s) { return s ? String(s).replace(/-/g, '/') : ''; }

/* ── 月フィルタ（直近12ヶ月） ──────────────────────────── */
function moInitMonthFilter() {
  const sel = document.getElementById('mo-filter-month');
  if (!sel) return;
  const now = new Date();
  _moCurrentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  for (let i = 0; i < 12; i++) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = `${d.getFullYear()}年${d.getMonth()+1}月`;
    sel.appendChild(opt);
  }
  sel.value = _moCurrentMonth;
  sel.addEventListener('change', () => { _moCurrentMonth = sel.value; moLoadMonthly(); });
}

function moBindListFilters() {
  document.getElementById('mo-filter-kind')?.addEventListener('change', moRenderList);
  document.getElementById('mo-filter-state')?.addEventListener('change', moRenderList);
}

/* ── 統合読み込み（売上＋コスト） ──────────────────────── */
async function moLoadMonthly() {
  const month = document.getElementById('mo-filter-month')?.value || _moCurrentMonth;
  _moCurrentMonth = month;

  const tbody = document.getElementById('mo-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="mo-empty">読み込み中...</td></tr>';

  try {
    const [salesRes, costRes] = await Promise.all([
      callGAS('getHistory', { type: 'sales', month }).catch(() => null),
      callGAS('getHistory', { type: 'cost',  month }).catch(() => null),
    ]);

    const salesRows = (salesRes?.status === 'ok' && Array.isArray(salesRes.data)) ? salesRes.data : [];
    const costRows  = (costRes?.status  === 'ok' && Array.isArray(costRes.data))  ? costRes.data  : [];

    _moHistory = [
      ...salesRows.map(r => moNormalize(r, 'sales')),
      ...costRows.map(r  => moNormalize(r, 'cost')),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

    moRenderBreakdown();
    moRenderList();
  } catch {
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="mo-empty">読み込みエラー</td></tr>';
  }
}

/* 行を共通スキーマに正規化。
   kind: 'sales' | 'purchase'（仕入原価・D列=1） | 'sga'（販管費・D列=2）
   状況: 売掛（売上未収）/ 買掛（コスト未払）/ 空 */
function moNormalize(r, src) {
  const amount = r.taxIncluded ?? r.amount ?? 0;
  const date   = String(r.date || '');
  const memo   = r.memo || '';

  if (src === 'sales') {
    const name = r.miscItemName
      ? `諸口：${r.miscItemName}`
      : (r.service || r.serviceName || r.item || r.itemName || '—');
    return {
      src, kind: 'sales', kindLabel: '売上',
      date, item: name, memo, amount,
      state: (r.uncollected || r.unpaid) ? '売掛' : '',
      locked: !!r.locked, raw: r,
    };
  }

  // cost：区分コードで仕入原価／販管費を判定
  const div = String(r.divisionCode ?? r.division ?? '');
  const isPurchase = div === '1';
  const name = r.miscItemName
    ? `諸口：${r.miscItemName}`
    : (r.itemName || r.item || r.service || r.serviceName || '—');
  return {
    src, kind: isPurchase ? 'purchase' : 'sga',
    kindLabel: isPurchase ? '仕入原価' : '販管費',
    date, item: name, memo, amount,
    state: (r.unpaid || r.uncollected) ? '買掛' : '',
    locked: !!r.locked, raw: r,
  };
}

/* ── 科目別集計＋区分トータル（▼で内訳をアコーディオン展開） ─ */
function moRenderBreakdown() {
  const box = document.getElementById('mo-breakdown');
  if (!box) return;

  const groups = { sales: {}, purchase: {}, sga: {} };
  const totals = { sales: 0, purchase: 0, sga: 0 };
  _moHistory.forEach(r => {
    groups[r.kind][r.item] = (groups[r.kind][r.item] || 0) + r.amount;
    totals[r.kind] += r.amount;
  });

  const block = (label, kind) => {
    const items = Object.entries(groups[kind]).sort((a, b) => b[1] - a[1]);
    const hasItems = items.length > 0;
    const rows = items.map(([name, amt]) =>
      `<div class="mo-bd-row"><span class="mo-bd-name">${_moEsc(name)}</span>` +
      `<span class="mo-bd-amt">${formatYen(amt)}</span></div>`
    ).join('');
    return `<div class="mo-bd-group" data-kind="${kind}">
      <button type="button" class="mo-bd-head" ${hasItems ? '' : 'disabled'} aria-expanded="false">
        <span class="mo-bd-caret" aria-hidden="true">▶</span>
        <span class="mo-bd-label">${label}</span>
        <span class="mo-bd-total">${formatYen(totals[kind])}</span>
      </button>
      <div class="mo-bd-body" hidden>${rows || '<div class="mo-bd-row mo-bd-row--empty">内訳なし</div>'}</div>
    </div>`;
  };

  box.innerHTML = block('売上', 'sales') + block('仕入原価', 'purchase') + block('販管費', 'sga');

  box.querySelectorAll('.mo-bd-head').forEach(head => {
    head.addEventListener('click', () => {
      if (head.hasAttribute('disabled')) return;
      const body = head.parentElement.querySelector('.mo-bd-body');
      const open = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', open ? 'false' : 'true');
      head.querySelector('.mo-bd-caret').textContent = open ? '▶' : '▼';
      if (body) body.hidden = open;
    });
  });
}

/* ── 統合一覧テーブル ─────────────────────────────────── */
function moRenderList() {
  const tbody = document.getElementById('mo-tbody');
  if (!tbody) return;

  const kindVal  = document.getElementById('mo-filter-kind')?.value  || 'all';
  const stateVal = document.getElementById('mo-filter-state')?.value || 'all';

  let rows = _moHistory;
  if (kindVal !== 'all')   rows = rows.filter(r => r.kind === kindVal);
  if (stateVal === 'unpaid') rows = rows.filter(r => r.state !== '');

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="mo-empty">データなし</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const date  = r.date.replace(/(\d{4})-(\d{2})-(\d{2})/, '$2/$3');
    const kCls  = r.kind === 'sales' ? 'mo-tag--sales'
                : r.kind === 'purchase' ? 'mo-tag--purchase' : 'mo-tag--sga';
    const stCls = r.state === '売掛' ? 'mo-state--ar'
                : r.state === '買掛' ? 'mo-state--ap' : '';
    const lock  = r.locked ? ' 🔒' : '';
    return `<tr class="mo-row">
      <td class="mo-td-date">${date}</td>
      <td class="mo-td-kind"><span class="mo-tag ${kCls}">${r.kindLabel}</span></td>
      <td class="mo-td-item">${_moEsc(r.item)}</td>
      <td class="mo-td-memo">${_moEsc(r.memo)}</td>
      <td class="mo-td-amount">${formatYen(r.amount)}</td>
      <td class="mo-td-state"><span class="mo-state ${stCls}">${r.state}</span>${lock}</td>
      <td class="mo-td-edit"></td>
    </tr>`;
  }).join('');
}

function _moEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
