let state = {
  statements: [],
  activeRawDate: null,
  compareRawDate: null,
  currentDiff: null,
  currentDetail: null,
  concentrado: null,
  activeTab: 'dashboard',
  auditSubtab: 'cost_changes',
  concSubtab: 'diffs',
  isStaticMode: false,
  staticDetailsCache: {},
  staticDiffsCache: {},
  staticConcCache: {},
  staticRefHistory: null,
  localReviews: JSON.parse(localStorage.getItem('ml_reviews_v1') || '{}'),
};

async function fetchJsonSafe(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json') && !url.endsWith('.json')) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function fetchStaticData(relPath) {
  let d = await fetchJsonSafe(`data/${relPath}`);
  if (!d) d = await fetchJsonSafe(`/static/data/${relPath}`);
  if (!d) d = await fetchJsonSafe(`app/static/data/${relPath}`);
  return d;
}

let masterDebounceTimer = null;

function fmtMoney(val) {
  if (val === null || val === undefined || val === '') return '—';
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMoneyShort(val) {
  const num = Number(val || 0);
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function showToast(msg) {
  const box = document.getElementById('toast-box');
  box.textContent = msg;
  box.classList.add('show');
  setTimeout(() => box.classList.remove('show'), 3800);
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function drawSparkline(svgId, values, strokeColor = '#F5B81C', fillGradientId = 'gradGold') {
  const svg = document.getElementById(svgId);
  if (!svg || !values || values.length === 0) return;

  const pts = values.length === 1 ? [values[0], values[0]] : values;
  const w = 260;
  const h = 48;
  const padY = 7;

  const minV = Math.min(...pts);
  const maxV = Math.max(...pts);
  const range = maxV - minV || 1;

  const coords = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * (w - 12) + 6;
    const y = h - padY - ((v - minV) / range) * (h - padY * 2);
    return [x, y];
  });

  let pathD = `M ${coords[0][0].toFixed(1)} ${coords[0][1].toFixed(1)}`;
  for (let i = 1; i < coords.length; i++) {
    const [x0, y0] = coords[i - 1];
    const [x1, y1] = coords[i];
    const cx = (x0 + x1) / 2;
    pathD += ` C ${cx.toFixed(1)} ${y0.toFixed(1)}, ${cx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }

  const last = coords[coords.length - 1];
  const hiIdx = Math.max(0, coords.length - 2);
  const hiPt = coords[hiIdx];
  const areaD = `${pathD} L ${last[0].toFixed(1)} ${h} L ${coords[0][0].toFixed(1)} ${h} Z`;

  svg.innerHTML = `
    <defs>
      <linearGradient id="${fillGradientId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.32"/>
        <stop offset="100%" stop-color="${strokeColor}" stop-opacity="0.0"/>
      </linearGradient>
    </defs>
    <path d="${areaD}" fill="url(#${fillGradientId})" />
    <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2.4" stroke-linecap="round" />
    <circle cx="${hiPt[0].toFixed(1)}" cy="${hiPt[1].toFixed(1)}" r="3.6" fill="#FFFFFF" stroke="${strokeColor}" stroke-width="2.2" />
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" fill="${strokeColor}" stroke="#FFFFFF" stroke-width="1.5" />
  `;
}

async function initApp() {
  setupDragAndDrop();
  await loadStatementsList();
}

async function loadStatementsList(preferredRawDate = null) {
  let data = await fetchJsonSafe('/api/statements');
  if (!data) {
    state.isStaticMode = true;
    data = await fetchStaticData('statements.json');
    const customList = JSON.parse(localStorage.getItem('ml_custom_stmts_v1') || '[]');
    if (data && customList.length) {
      const existing = new Set((data.statements || []).map(s => s.raw_date));
      customList.forEach(cs => {
        if (!existing.has(cs.raw_date)) data.statements.unshift(cs);
      });
      data.statements.sort((a, b) => b.raw_date.localeCompare(a.raw_date));
    }
  } else {
    state.isStaticMode = false;
  }

  state.statements = (data && data.statements) ? data.statements : [];

  document.getElementById('dash-sync-badge').textContent = `${state.statements.length} Statements Sincronizados`;

  if (state.statements.length > 0) {
    state.activeRawDate = preferredRawDate || state.activeRawDate || state.statements[0].raw_date;
    const activeObj = state.statements.find(s => s.raw_date === state.activeRawDate) || state.statements[0];
    state.activeRawDate = activeObj.raw_date;
    state.compareRawDate = activeObj.prev_raw_date || '';

    populateSelectors();
    renderTimelineStrip();
    await refreshActiveStatementData();
  }
}

function populateSelectors() {
  const selStmt = document.getElementById('select-stmt');
  const selComp = document.getElementById('select-compare');

  selStmt.innerHTML = state.statements
    .map((s, idx) => `<option value="${s.raw_date}" ${s.raw_date === state.activeRawDate ? 'selected' : ''}>${s.stmt_date}${idx === 0 ? ' ★' : ''}</option>`)
    .join('');

  const compOptions = [`<option value="">—</option>`];
  state.statements.forEach(s => {
    if (s.raw_date !== state.activeRawDate) {
      compOptions.push(
        `<option value="${s.raw_date}" ${s.raw_date === state.compareRawDate ? 'selected' : ''}>${s.stmt_date}</option>`
      );
    }
  });
  selComp.innerHTML = compOptions.join('');
}

function renderTimelineStrip() {
  const strip = document.getElementById('timeline-strip');
  document.getElementById('timeline-count-label').textContent = `Desde ${state.statements[state.statements.length - 1]?.stmt_date || ''} hasta ${state.statements[0]?.stmt_date || ''}`;

  strip.innerHTML = state.statements
    .map(s => {
      const isAct = s.raw_date === state.activeRawDate;
      const deltaC = s.delta_containers > 0 ? `+${s.delta_containers}` : s.delta_containers;
      return `
        <div class="timeline-pill ${isAct ? 'active' : ''}" onclick="selectStatementFromTimeline('${s.raw_date}')">
          <div class="tp-date">
            <span>${s.stmt_date}</span>
            ${s.delta_containers ? `<span class="tp-delta">${deltaC}</span>` : ''}
          </div>
          <div class="tp-meta">${s.total_containers} cont. · ${fmtMoneyShort(s.acc_balance)}</div>
        </div>
      `;
    })
    .join('');
}

async function selectStatementFromTimeline(rawDate) {
  state.activeRawDate = rawDate;
  const activeObj = state.statements.find(s => s.raw_date === rawDate);
  state.compareRawDate = activeObj ? (activeObj.prev_raw_date || '') : '';
  populateSelectors();
  renderTimelineStrip();
  await refreshActiveStatementData();
}

async function onStatementChange() {
  const rawDate = document.getElementById('select-stmt').value;
  await selectStatementFromTimeline(rawDate);
}

async function onCompareChange() {
  state.compareRawDate = document.getElementById('select-compare').value;
  await refreshActiveStatementData();
}

async function getStaticDetail(rawDate) {
  if (state.staticDetailsCache[rawDate]) return state.staticDetailsCache[rawDate];
  const customDetail = localStorage.getItem(`ml_custom_detail_${rawDate}`);
  if (customDetail) {
    const parsed = JSON.parse(customDetail);
    state.staticDetailsCache[rawDate] = parsed;
    return parsed;
  }
  const d = await fetchStaticData(`detail/${rawDate}.json`);
  if (d) state.staticDetailsCache[rawDate] = d;
  return d;
}

function applyLocalReviewsToDiff(diff) {
  if (!diff) return diff;
  const rev = state.localReviews || {};
  let reviewedCount = 0;
  let pendingCount = 0;
  (diff.cost_changes || []).forEach(c => {
    if (rev[c.change_key]) c.review_status = rev[c.change_key];
    if (c.review_status === 'reviewed') reviewedCount++;
    else pendingCount++;
  });
  (diff.new_shipments || []).forEach(n => {
    if (rev[n.change_key]) n.review_status = rev[n.change_key];
    if (n.review_status === 'reviewed') reviewedCount++;
    else pendingCount++;
  });
  (diff.new_payments || []).forEach(p => {
    if (rev[p.change_key]) p.review_status = rev[p.change_key];
    if (p.review_status === 'reviewed') reviewedCount++;
    else pendingCount++;
  });
  if (diff.summary) {
    diff.summary.reviewed_count = reviewedCount;
    diff.summary.pending_review_count = pendingCount;
  }
  return diff;
}

async function computeClientSideDiff(currRawDate, compRawDate) {
  const currDetail = await getStaticDetail(currRawDate);
  const compDetail = compRawDate ? await getStaticDetail(compRawDate) : null;
  if (!currDetail) return null;

  const currStmt = currDetail.statement;
  const prevStmt = compDetail ? compDetail.statement : null;

  if (!prevStmt) {
    return applyLocalReviewsToDiff({
      raw_date: currRawDate,
      stmt_date: currStmt.stmt_date,
      compare_to: null,
      compare_to_date: null,
      current_statement: currStmt,
      previous_statement: null,
      summary: {
        new_shipments_count: currDetail.master_items.length,
        removed_shipments_count: 0,
        cost_changes_count: 0,
        eta_changes_count: 0,
        new_payments_count: currDetail.payments.length,
        net_extra_charges_delta: 0,
        new_shipments_total_cost: currStmt.total_cost_master,
        new_payments_total_amt: currStmt.acc_total_rcvd,
        pending_review_count: 0,
        reviewed_count: 0,
      },
      cost_changes: [],
      new_shipments: currDetail.master_items.map(m => ({ ...m, change_key: `NEW:${currRawDate}:${m.ref_key}`, review_status: 'pending' })),
      removed_shipments: [],
      eta_changes: [],
      new_payments: currDetail.payments.map(p => ({ ...p, change_key: `PAY:${currRawDate}:${p.payment_sig}`, review_status: 'pending' })),
      customer_cost_diffs: currDetail.customer_costs.map(c => ({ ...c, prev_cost: 0, delta: c.cost })),
    });
  }

  const prevByRef = {};
  compDetail.master_items.forEach(m => { prevByRef[m.ref_no] = m; });
  const currByRef = {};
  currDetail.master_items.forEach(m => { currByRef[m.ref_no] = m; });

  const newShipments = [];
  const costChanges = [];
  const etaChanges = [];
  let netExtraDelta = 0;

  const fields = [
    ['sea_freight', 'Sea Freight'],
    ['fob_cost', 'FOB Cost'],
    ['amend_fee', 'Amend Fee'],
    ['exw_fee', 'EXW Fee'],
    ['inland_fee', 'Inland Fee'],
    ['total_cost', 'Total Cost'],
    ['previo', 'Previo'],
    ['insurance', 'Insurance'],
  ];

  currDetail.master_items.forEach(m => {
    const p = prevByRef[m.ref_no];
    if (!p) {
      newShipments.push({ ...m, change_key: `NEW:${currRawDate}:${m.ref_key}`, review_status: 'pending' });
      return;
    }
    const fDiffs = [];
    fields.forEach(([k, label]) => {
      const vNew = Number(m[k] || 0);
      const vOld = Number(p[k] || 0);
      if (Math.abs(vNew - vOld) >= 0.01) {
        fDiffs.push({ field: k, label, old: vOld, new: vNew, delta: Number((vNew - vOld).toFixed(2)) });
      }
    });
    if (fDiffs.length > 0) {
      const dTotal = Number(((m.total_cost || 0) - (p.total_cost || 0)).toFixed(2));
      const dPrev = Number(((m.previo || 0) - (p.previo || 0)).toFixed(2));
      const dIns = Number(((m.insurance || 0) - (p.insurance || 0)).toFixed(2));
      const comb = Number((dTotal + dPrev + dIns).toFixed(2));
      netExtraDelta += comb;
      costChanges.push({
        change_key: `COST:${currRawDate}:${m.ref_key}`,
        ref_no: m.ref_no,
        customer: m.customer,
        customer_for: m.customer_for,
        container: m.container,
        shipping_line: m.shipping_line,
        pol: m.pol,
        pod: m.pod,
        eta: m.update_eta || m.eta,
        old_total_cost: p.total_cost,
        new_total_cost: m.total_cost,
        delta_total_cost: dTotal,
        combined_delta: comb,
        field_diffs: fDiffs,
        diffs: fDiffs,
        current_item: m,
        previous_item: p,
        review_status: 'pending',
      });
    }
    if ((m.eta || '') !== (p.eta || '') || (m.update_eta || '') !== (p.update_eta || '')) {
      etaChanges.push({
        ref_no: m.ref_no,
        customer: m.customer,
        customer_for: m.customer_for,
        container: m.container,
        old_eta: p.eta,
        new_eta: m.eta,
        old_update_eta: p.update_eta,
        new_update_eta: m.update_eta,
      });
    }
  });

  const removedShipments = compDetail.master_items.filter(p => !currByRef[p.ref_no]);
  const prevPayCount = {};
  compDetail.payments.forEach(p => { prevPayCount[p.payment_sig] = (prevPayCount[p.payment_sig] || 0) + 1; });
  const newPayments = [];
  currDetail.payments.forEach(p => {
    if ((prevPayCount[p.payment_sig] || 0) > 0) {
      prevPayCount[p.payment_sig]--;
    } else {
      newPayments.push({ ...p, change_key: `PAY:${currRawDate}:${p.payment_sig}`, review_status: 'pending' });
    }
  });

  const prevCustMap = {};
  compDetail.customer_costs.forEach(c => { prevCustMap[c.customer_name] = c.cost; });
  const custDiffs = currDetail.customer_costs.map(c => ({
    customer_name: c.customer_name,
    prev_cost: prevCustMap[c.customer_name] || 0,
    cost: c.cost,
    delta: Number((c.cost - (prevCustMap[c.customer_name] || 0)).toFixed(2)),
    remark: c.remark,
  }));

  return applyLocalReviewsToDiff({
    raw_date: currRawDate,
    stmt_date: currStmt.stmt_date,
    compare_to: compRawDate,
    compare_to_date: prevStmt.stmt_date,
    current_statement: currStmt,
    previous_statement: prevStmt,
    summary: {
      new_shipments_count: newShipments.length,
      removed_shipments_count: removedShipments.length,
      cost_changes_count: costChanges.length,
      eta_changes_count: etaChanges.length,
      new_payments_count: newPayments.length,
      net_extra_charges_delta: Number(netExtraDelta.toFixed(2)),
      new_shipments_total_cost: Number(newShipments.reduce((a, b) => a + (b.total_cost || 0), 0).toFixed(2)),
      new_payments_total_amt: Number(newPayments.reduce((a, b) => a + (b.rcvd_amt || 0), 0).toFixed(2)),
      pending_review_count: 0,
      reviewed_count: 0,
    },
    cost_changes: costChanges,
    new_shipments: newShipments,
    removed_shipments: removedShipments,
    eta_changes: etaChanges,
    new_payments: newPayments,
    customer_cost_diffs: custDiffs,
  });
}

async function refreshActiveStatementData() {
  if (!state.activeRawDate) return;

  if (!state.isStaticMode) {
    const qComp = state.compareRawDate ? `?compare_to=${encodeURIComponent(state.compareRawDate)}` : '';
    const [diffRes, detailRes, concRes] = await Promise.all([
      fetch(`/api/statements/${state.activeRawDate}/diff${qComp}`),
      fetch(`/api/statements/${state.activeRawDate}`),
      fetch(`/api/concentrado/overview?raw_date=${encodeURIComponent(state.activeRawDate)}`),
    ]);
    state.currentDiff = await diffRes.json();
    state.currentDetail = await detailRes.json();
    state.concentrado = await concRes.json();
  } else {
    state.currentDetail = await getStaticDetail(state.activeRawDate);
    const activeObj = state.statements.find(s => s.raw_date === state.activeRawDate);
    const isDefaultComp = !state.compareRawDate || (activeObj && state.compareRawDate === activeObj.prev_raw_date);

    let diffData = null;
    if (isDefaultComp) {
      diffData = await fetchStaticData(`diff/${state.activeRawDate}.json`);
    }
    if (!diffData) {
      diffData = await computeClientSideDiff(state.activeRawDate, state.compareRawDate);
    } else {
      diffData = applyLocalReviewsToDiff(diffData);
    }
    state.currentDiff = diffData;

    let concData = await fetchStaticData(`concentrado/${state.activeRawDate}.json`);
    if (!concData) {
      const knownBaseRaw = state.statements.find(s => s.raw_date !== state.activeRawDate)?.raw_date || '20261014';
      const baseConc = await fetchStaticData(`concentrado/${knownBaseRaw}.json`);
      if (baseConc) {
        concData = JSON.parse(JSON.stringify(baseConc));
        concData.raw_date = state.activeRawDate;

        // Cargar referencias aplicadas y desestimadas guardadas en localStorage
        const dismissedSet = new Set(JSON.parse(localStorage.getItem('ml_dismissed_refs_v1') || '[]'));
        const appliedSet = new Set(JSON.parse(localStorage.getItem('ml_applied_refs_v1') || '[]'));

        // Recolectar todas las referencias ya existentes en las hojas del Concentrado y en el Statement base
        const baseRefs = new Set();
        const baseStmtDetail = await getStaticDetail(knownBaseRaw);
        (baseStmtDetail?.master_items || []).forEach(it => baseRefs.add(String(it.ref_no || '').trim().toUpperCase()));
        (concData.discrepancies || []).forEach(d => baseRefs.add(String(d.ref_no || '').trim().toUpperCase()));

        // Referencias del nuevo Statement que no existían
        const currentItems = state.currentDetail?.master_items || [];
        const newMissing = [];
        currentItems.forEach(m => {
          const rUp = String(m.ref_no || '').trim().toUpperCase();
          if (rUp && !baseRefs.has(rUp)) {
            const targetSheet = guessConcentradoSheetClient(m, concData.sheet_distribution);
            const key = `${targetSheet}:${m.ref_no}`;
            // Si ya fue aplicada o desestimada por el usuario, no volver a mostrarla como pendiente
            if (dismissedSet.has(key) || appliedSet.has(key)) return;

            const sheetMeta = (concData.sheet_distribution || []).find(s => s.sheet === targetSheet);
            const calc = computeConcentradoTargetClient(m, targetSheet, sheetMeta);
            newMissing.push({
              ref_no: m.ref_no,
              customer: m.customer,
              customer_for: m.customer_for,
              container: m.container,
              etd: m.etd,
              eta: m.eta,
              update_eta: m.update_eta,
              shipping_line: m.shipping_line,
              pol: m.pol,
              pod: m.pod,
              sea_freight: m.sea_freight,
              fob_cost: m.fob_cost,
              inland_fee: m.inland_fee,
              total_cost: m.total_cost,
              previo: m.previo,
              insurance: m.insurance,
              exw: m.exw_fee,
              amend: m.amend_fee,
              target_sheet: targetSheet,
              ...calc,
            });
          }
        });
        concData.missing_in_concentrado = newMissing;
        concData.summary.missing_refs_count = newMissing.length;

        // Actualizar métricas financieras para el nuevo statement
        if (concData.financials) {
          const currStmt = state.currentDetail?.statement;
          if (currStmt) {
            concData.financials.debo_eliezer = currStmt.acc_balance;
            concData.financials.eliezer_pending_receive = currStmt.acc_pending_receive;
            concData.financials.eliezer_total_paid = currStmt.acc_total_rcvd;
            concData.financials.eliezer_total_cost_acc = currStmt.acc_total_cost;
            concData.financials.total_containers = currStmt.total_containers;
            concData.financials.costo_total_eliezer_2026 = currStmt.total_cost_master;
            concData.financials.flujo_neto_cartera = Number((concData.financials.me_deben_clientes - currStmt.acc_balance).toFixed(2));
            concData.financials.ganancia_bruta_operativa = Number((concData.financials.facturado_clientes_2026 - currStmt.total_cost_master).toFixed(2));
            if (concData.financials.facturado_clientes_2026 > 0) {
              concData.financials.margen_porcentaje = Number(((concData.financials.ganancia_bruta_operativa / concData.financials.facturado_clientes_2026) * 100).toFixed(2));
            }
          }
        }
      }
    }
    state.concentrado = concData;
  }

  populateMasterCustomerDropdown();
  renderDashboard();
  renderAuditView();
  renderMasterTable(state.currentDetail.master_items);
  renderAccountingView();
  renderConcentradoView();
}

function renderDashboard() {
  const diff = state.currentDiff;
  const stmt = diff.current_statement;
  const sum = diff.summary;
  const concSum = state.concentrado?.summary || { high_discrepancies_count: 0, missing_refs_count: 0 };

  document.getElementById('dash-headline').textContent = `Statement ${stmt.stmt_date} (${stmt.filename})`;
  document.getElementById('dash-subheadline').textContent = diff.compare_to_date
    ? `Comparando automáticamente contra el Statement del ${diff.compare_to_date} y contra tu Concentrado 2026`
    : `Primer Statement registrado en la línea de tiempo (${stmt.stmt_date})`;

  const totalChangesBadge = sum.cost_changes_count + sum.new_shipments_count + sum.new_payments_count;
  document.getElementById('tab-badge-diff').textContent = totalChangesBadge;
  document.getElementById('tab-badge-master').textContent = stmt.total_containers;
  document.getElementById('tab-badge-conc').textContent =
    (concSum.high_discrepancies_count || 0) + (concSum.missing_refs_count || 0);

  const railBadge = document.getElementById('rail-alert-badge');
  if (sum.cost_changes_count > 0) {
    railBadge.style.display = 'inline-block';
    railBadge.textContent = sum.cost_changes_count;
  } else {
    railBadge.style.display = 'none';
  }

  // KPI 1: Embarques en Master List
  document.getElementById('kpi-containers-val').textContent = stmt.total_containers.toLocaleString('en-US');
  document.getElementById('kpi-containers-delta').textContent = `+${sum.new_shipments_count} nuevos`;
  document.getElementById('kpi-containers-sub').textContent =
    `Total Cost Master: ${fmtMoney(stmt.total_cost_master)} · Previo: ${fmtMoneyShort(stmt.total_previo)} · Seg: ${fmtMoneyShort(stmt.total_insurance)}`;

  // KPI 2: Alertas de Cargos Extras
  document.getElementById('kpi-extras-val').textContent = `${sum.cost_changes_count} ⚠️`;
  const netDeltaSign = sum.net_extra_charges_delta >= 0 ? '+' : '';
  document.getElementById('kpi-extras-delta').textContent = `${netDeltaSign}${fmtMoney(sum.net_extra_charges_delta)}`;
  document.getElementById('kpi-extras-sub').textContent =
    sum.cost_changes_count > 0
      ? `${sum.cost_changes_count} referencias modificaron sus cargos respecto al Statement anterior`
      : `Sin modificaciones de cargos en referencias existentes`;

  // KPI 3: Cruce vs Concentrado 2026
  const totalConcAlerts = (concSum.high_discrepancies_count || 0) + (concSum.missing_refs_count || 0);
  document.getElementById('kpi-conc-val').textContent = `${totalConcAlerts} 🔍`;
  document.getElementById('kpi-conc-delta').textContent = `${concSum.missing_refs_count || 0} por insertar`;
  document.getElementById('kpi-conc-sub').textContent =
    `${concSum.high_discrepancies_count || 0} diferencias de cargos/previo/tren vs Concentrado · Cuenta Gral: ${fmtMoneyShort(state.concentrado?.cuenta_general_total || 0)}`;

  // Financial Summary Strip (Debo vs Me Deben + Margen de Ganancia)
  const fin = state.concentrado?.financials;
  if (fin) {
    document.getElementById('fin-summary-badge').textContent =
      `${fin.total_containers.toLocaleString('en-US')} contenedores 2026 · Promedio +${fmtMoney(fin.ganancia_promedio_contenedor)} / cont.`;

    // 1) Cuánto Debo (Eliezer)
    document.getElementById('fin-debo-val').textContent = fmtMoney(fin.debo_eliezer);
    document.getElementById('fin-debo-tag').textContent =
      fin.eliezer_pending_receive > 0 ? `Pend. acreditar: ${fmtMoneyShort(fin.eliezer_pending_receive)}` : 'Por pagar';
    document.getElementById('fin-debo-sub').textContent =
      `Cargos Eliezer: ${fmtMoneyShort(fin.eliezer_total_cost_acc)} · Pagado: ${fmtMoneyShort(fin.eliezer_total_paid)}`;

    // 2) Cuánto Me Deben (Clientes en Concentrado)
    document.getElementById('fin-medeben-val').textContent = fmtMoney(fin.me_deben_clientes);
    document.getElementById('fin-medeben-sub').textContent =
      `Facturado total: ${fmtMoneyShort(fin.clientes_total_billed_all)} · Cobrado: ${fmtMoneyShort(fin.clientes_total_paid_est)}`;

    // 3) Balance Neto de Cartera (Me Deben - Debo)
    const netSign = fin.flujo_neto_cartera >= 0 ? '+' : '';
    document.getElementById('fin-neto-val').textContent = `${netSign}${fmtMoney(fin.flujo_neto_cartera)}`;
    const netoEl = document.getElementById('fin-neto-val');
    netoEl.style.color = fin.flujo_neto_cartera >= 0 ? 'var(--green-text)' : 'var(--red-text)';
    document.getElementById('fin-neto-tag').textContent =
      fin.flujo_neto_cartera >= 0 ? 'Superávit Cartera' : 'Déficit Cartera';
    document.getElementById('fin-neto-sub').textContent =
      `Tus clientes te deben ${fmtMoneyShort(Math.abs(fin.flujo_neto_cartera))} ${fin.flujo_neto_cartera >= 0 ? 'más' : 'menos'} de lo que debes a Eliezer`;

    // 4) Mi Margen de Ganancia Operativa (Facturado Clientes 2026 - Costo Eliezer 2026)
    const profSign = fin.ganancia_bruta_operativa >= 0 ? '+' : '';
    document.getElementById('fin-margen-val').textContent = `${profSign}${fmtMoney(fin.ganancia_bruta_operativa)}`;
    document.getElementById('fin-margen-pct').textContent = `${fin.margen_porcentaje.toFixed(1)}% margen`;
    document.getElementById('fin-margen-sub').textContent =
      `Facturado 2026: ${fmtMoneyShort(fin.facturado_clientes_2026)} − Costo Eliezer: ${fmtMoneyShort(fin.costo_total_eliezer_2026)}`;
  }

  const asc = [...state.statements].reverse();
  drawSparkline('spark-containers', asc.map(x => x.total_containers), '#F5B81C', 'gradContainers');
  drawSparkline('spark-extras', asc.map(x => Math.max(0, x.delta_cost || 0)), '#8C8270', 'gradExtras');
  drawSparkline('spark-balance', asc.map(x => x.acc_total_rcvd || 0), '#F5B81C', 'gradBalance');

  const costTbody = document.getElementById('dash-cost-changes-tbody');
  if (diff.cost_changes.length === 0) {
    costTbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding:24px; color:var(--text-muted);">
          No se detectaron modificaciones de cargos en referencias existentes respecto al Statement seleccionado.
        </td>
      </tr>
    `;
  } else {
    costTbody.innerHTML = diff.cost_changes.map(c => renderCostChangeRow(c)).join('');
  }

  document.getElementById('dash-new-shipments-title').innerHTML =
    `🚢 Nuevos Embarques Agregados en este Statement (${diff.new_shipments.length})
     <button class="btn-secondary" style="margin-left:12px; font-size:11.5px; padding:4px 10px; font-weight:700; background:#EFF6FF; color:#1D4ED8; border-color:#BFDBFE;" onclick="showNewShipmentsInMaster()">
       Ver los ${diff.new_shipments.length} en Master List ➔
     </button>`;

  const newTbody = document.getElementById('dash-new-shipments-tbody');
  if (diff.new_shipments.length === 0) {
    newTbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding:22px; color:var(--text-muted);">
          No hay embarques nuevos en esta comparativa.
        </td>
      </tr>
    `;
  } else {
    newTbody.innerHTML = diff.new_shipments
      .slice(0, 12)
      .map(item => {
        const extras = [];
        if (item.amend_fee > 0) extras.push(`Amend: ${fmtMoney(item.amend_fee)}`);
        if (item.exw_fee > 0) extras.push(`EXW: ${fmtMoney(item.exw_fee)}`);
        if (item.inland_fee > 0) extras.push(`Inland: ${fmtMoney(item.inland_fee)}`);
        if (item.previo > 0) extras.push(`Previo: ${fmtMoney(item.previo)}`);
        if (item.insurance > 0) extras.push(`Seg: ${fmtMoney(item.insurance)}`);
        const isRev = item.review_status === 'reviewed';
        return `
          <tr class="${isRev ? 'row-reviewed' : ''}">
            <td><span class="ref-link" onclick="openRefHistory('${esc(item.ref_no)}')">${esc(item.ref_no)}</span></td>
            <td>${esc(item.customer)}</td>
            <td><strong>${esc(item.customer_for)}</strong></td>
            <td><code>${esc(item.container)}</code></td>
            <td>${esc(item.pol)} → ${esc(item.pod)}</td>
            <td>${esc(item.update_eta || item.eta || '—')}</td>
            <td><strong>${fmtMoney(item.total_cost)}</strong></td>
            <td>${extras.length ? extras.map(e => `<span class="diff-chip">${esc(e)}</span>`).join(' ') : '<span style="color:var(--text-muted)">Sin extras</span>'}</td>
            <td>
              <span class="status-pill ${isRev ? 'reviewed' : ''}" style="cursor:pointer;" onclick="toggleReviewItem('${esc(item.change_key)}', 'NEW', '${esc(item.ref_no)}', '${isRev ? 'pending' : 'reviewed'}')">
                ${isRev ? 'Revisado' : 'Nuevo'}
              </span>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  document.getElementById('assistant-comp-label').textContent = diff.compare_to_date
    ? `${stmt.stmt_date} vs ${diff.compare_to_date}`
    : `Statement base ${stmt.stmt_date}`;

  document.getElementById('assistant-summary-text').innerHTML =
    `Se detectaron <strong>${sum.cost_changes_count} cargos extras/ajustes</strong>, <strong>${sum.new_shipments_count} nuevos embarques</strong> y <strong>${concSum.high_discrepancies_count || 0} diferencias contra el Concentrado</strong>.`;

  const pct = sum.total_alert_items > 0
    ? Math.round((sum.reviewed_alert_items / sum.total_alert_items) * 100)
    : 100;
  document.getElementById('review-progress-label').textContent =
    `${sum.reviewed_alert_items} / ${sum.total_alert_items} revisados (${pct}%)`;
  document.getElementById('review-progress-bar').style.width = `${pct}%`;

  const alertsList = document.getElementById('right-alerts-list');
  const alertCards = [];

  diff.cost_changes.forEach(c => {
    const isRev = c.review_status === 'reviewed';
    const diffList = c.diffs || c.field_diffs || [];
    alertCards.push(`
      <div class="alert-item" onclick="openRefHistory('${esc(c.ref_no)}')">
        <div class="alert-item-icon">${isRev ? '✅' : '⚠️'}</div>
        <div style="flex:1; min-width:0;">
          <div class="alert-item-title">${esc(c.ref_no)} · ${esc(c.customer_for)}</div>
          <div class="alert-item-desc">
            ${diffList.map(d => `${esc(d.label)}: ${fmtMoney(d.old)} → <strong>${fmtMoney(d.new)}</strong>`).join(' | ')}
          </div>
        </div>
      </div>
    `);
  });

  diff.new_payments.slice(0, 5).forEach(p => {
    const isRev = p.review_status === 'reviewed';
    alertCards.push(`
      <div class="alert-item" onclick="switchTab('auditoria'); setAuditSubtab('new_payments');">
        <div class="alert-item-icon">${isRev ? '✅' : '💵'}</div>
        <div style="flex:1; min-width:0;">
          <div class="alert-item-title">Pago ${fmtMoney(p.rcvd_amt)} · ${esc(p.remark || p.section)}</div>
          <div class="alert-item-desc">${esc(p.rcvd_date)} · ${esc(p.paid_from)}</div>
        </div>
      </div>
    `);
  });

  document.getElementById('right-alerts-count').textContent = diff.cost_changes.length + diff.new_payments.length;
  alertsList.innerHTML = alertCards.length
    ? alertCards.join('')
    : `<div style="font-size:12.5px; color:var(--text-muted); padding:8px;">Sin alertas pendientes en este Statement.</div>`;

  document.getElementById('right-accounting-kpis').innerHTML = `
    <div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid var(--border-warm);">
      <span style="color:var(--text-secondary);">Balance Eliezer:</span>
      <strong>${fmtMoney(stmt.acc_balance)}</strong>
    </div>
    <div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid var(--border-warm);">
      <span style="color:var(--text-secondary);">Cuenta Gral Concentrado:</span>
      <strong>${fmtMoney(state.concentrado?.cuenta_general_total || 0)}</strong>
    </div>
    <div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid var(--border-warm);">
      <span style="color:var(--text-secondary);">Total Rcvd (Stmt):</span>
      <strong style="color:var(--green-text);">${fmtMoney(stmt.acc_total_rcvd)}</strong>
    </div>
    <div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid var(--border-warm);">
      <span style="color:var(--text-secondary);">Paid from México:</span>
      <strong>${fmtMoney(stmt.acc_paid_mexico)}</strong>
    </div>
    <div style="display:flex; justify-content:space-between; padding:5px 0;">
      <span style="color:var(--text-secondary);">Paid in China:</span>
      <strong>${fmtMoney(stmt.acc_paid_china)}</strong>
    </div>
  `;
}

function renderCostChangeRow(c) {
  const isRev = c.review_status === 'reviewed';
  const diffList = c.diffs || c.field_diffs || [];
  const chips = diffList
    .map(d => {
      const sign = d.delta > 0 ? '+' : '';
      const cls = d.delta > 0 ? 'delta-pos' : 'delta-neg';
      return `
        <span class="diff-chip">
          <span>${esc(d.label)}:</span>
          <span class="old-val">${fmtMoney(d.old)}</span> →
          <span class="new-val">${fmtMoney(d.new)}</span>
          <span class="${cls}">(${sign}${fmtMoney(d.delta)})</span>
        </span>
      `;
    })
    .join('');

  return `
    <tr class="${isRev ? 'row-reviewed' : ''}">
      <td>
        <span class="ref-link" onclick="openRefHistory('${esc(c.ref_no)}')">${esc(c.ref_no)}</span>
      </td>
      <td>
        <div style="font-weight:700;">${esc(c.customer_for)}</div>
        <div style="font-size:11.5px; color:var(--text-secondary);">${esc(c.customer)}</div>
      </td>
      <td><code>${esc(c.container)}</code></td>
      <td><div class="diff-badge-list">${chips}</div></td>
      <td style="color:var(--text-secondary);">${fmtMoney(c.old_total_cost)}</td>
      <td><strong>${fmtMoney(c.new_total_cost)}</strong></td>
      <td>
        <span class="status-pill ${isRev ? 'reviewed' : ''}">
          ${isRev ? 'Revisado' : 'Cargo Extra'}
        </span>
      </td>
      <td>
        <button class="btn-soft" style="padding:5px 10px; font-size:12px;" onclick="toggleReviewItem('${esc(c.change_key)}', 'COST', '${esc(c.ref_no)}', '${isRev ? 'pending' : 'reviewed'}')">
          ${isRev ? '↩ Desmarcar' : '✓ Revisar'}
        </button>
      </td>
    </tr>
  `;
}

// ================= VIEW 2: AUDITORÍA ENTRE STATEMENTS =================
function setAuditSubtab(sub) {
  state.auditSubtab = sub;
  ['cost_changes', 'new_shipments', 'new_payments', 'customer_diffs', 'eta_changes', 'removed_shipments'].forEach(k => {
    const btn = document.getElementById(`subtab-btn-${k}`);
    if (btn) btn.classList.toggle('active', k === sub);
  });
  renderAuditView();
}

function renderAuditView() {
  if (!state.currentDiff) return;
  const diff = state.currentDiff;
  const sum = diff.summary;

  document.getElementById('audit-title').textContent =
    `Auditoría de Diferencias — Statement ${diff.stmt_date}`;
  document.getElementById('audit-subtitle').textContent = diff.compare_to_date
    ? `Comparando ${diff.stmt_date} contra ${diff.compare_to_date}`
    : `Mostrando Statement inicial ${diff.stmt_date}`;

  document.getElementById('sub-cnt-cost').textContent = sum.cost_changes_count;
  document.getElementById('sub-cnt-new').textContent = sum.new_shipments_count;
  document.getElementById('sub-cnt-pay').textContent = sum.new_payments_count;
  document.getElementById('sub-cnt-eta').textContent = sum.eta_changes_count;
  document.getElementById('sub-cnt-rem').textContent = sum.removed_shipments_count;

  const container = document.getElementById('audit-subtab-container');

  if (state.auditSubtab === 'cost_changes') {
    if (diff.cost_changes.length === 0) {
      container.innerHTML = `<p style="padding:20px; color:var(--text-muted);">No hay cargos extras ni modificaciones de monto en referencias existentes en este corte.</p>`;
      return;
    }
    container.innerHTML = `
      <div class="table-wrap">
        <table class="ml-table">
          <thead>
            <tr>
              <th>REF / INV NO</th>
              <th>Customer / Customer For</th>
              <th>Contenedor</th>
              <th>Desglose de Cambios Detectados (Antes → Ahora)</th>
              <th>Total Anterior</th>
              <th>Total Nuevo</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            ${diff.cost_changes.map(c => renderCostChangeRow(c)).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (state.auditSubtab === 'new_shipments') {
    if (diff.new_shipments.length === 0) {
      container.innerHTML = `<p style="padding:20px; color:var(--text-muted);">No se agregaron embarques nuevos en este Statement.</p>`;
      return;
    }
    container.innerHTML = `
      <div class="table-wrap">
        <table class="ml-table">
          <thead>
            <tr>
              <th>REF / INV NO</th>
              <th>Customer</th>
              <th>Customer For</th>
              <th>Container</th>
              <th>Naviera / Ruta</th>
              <th>ETD / ETA</th>
              <th>Sea Freight</th>
              <th>FOB</th>
              <th>Amend / EXW / Inland</th>
              <th>Total Cost</th>
              <th>Previo / Seg</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${diff.new_shipments.map(item => {
              const isRev = item.review_status === 'reviewed';
              return `
                <tr class="${isRev ? 'row-reviewed' : ''}">
                  <td><span class="ref-link" onclick="openRefHistory('${esc(item.ref_no)}')">${esc(item.ref_no)}</span></td>
                  <td>${esc(item.customer)}</td>
                  <td><strong>${esc(item.customer_for)}</strong></td>
                  <td><code>${esc(item.container)}</code></td>
                  <td>${esc(item.shipping_line)} · ${esc(item.pol)} → ${esc(item.pod)}</td>
                  <td>${esc(item.etd)} / ${esc(item.update_eta || item.eta)}</td>
                  <td>${fmtMoney(item.sea_freight)}</td>
                  <td>${fmtMoney(item.fob_cost)}</td>
                  <td>${fmtMoney((item.amend_fee || 0) + (item.exw_fee || 0) + (item.inland_fee || 0))}</td>
                  <td><strong>${fmtMoney(item.total_cost)}</strong></td>
                  <td>${fmtMoney((item.previo || 0) + (item.insurance || 0))}</td>
                  <td>
                    <button class="btn-soft" style="padding:4px 10px; font-size:12px;" onclick="toggleReviewItem('${esc(item.change_key)}', 'NEW', '${esc(item.ref_no)}', '${isRev ? 'pending' : 'reviewed'}')">
                      ${isRev ? '✅ Revisado' : '✓ Marcar Revisado'}
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (state.auditSubtab === 'new_payments') {
    if (diff.new_payments.length === 0) {
      container.innerHTML = `<p style="padding:20px; color:var(--text-muted);">No se registraron pagos nuevos en ACCOUNTING SUMMARY respecto al Statement anterior.</p>`;
      return;
    }
    container.innerHTML = `
      <div class="table-wrap">
        <table class="ml-table">
          <thead>
            <tr>
              <th>Sección</th>
              <th>Fecha (RCVD DATE)</th>
              <th>Monto (RCVD AMT)</th>
              <th>Razón Social Pagadora (Paid From)</th>
              <th>Paid To</th>
              <th>Cliente / Referencia (REMARK)</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            ${diff.new_payments.map(p => {
              const isRev = p.review_status === 'reviewed';
              return `
                <tr class="${isRev ? 'row-reviewed' : ''}">
                  <td><span class="status-pill new-item">${esc(p.section)}</span></td>
                  <td>${esc(p.rcvd_date)}</td>
                  <td><strong style="color:var(--green-text); font-size:14px;">${fmtMoney(p.rcvd_amt)}</strong></td>
                  <td><strong>${esc(p.paid_from)}</strong></td>
                  <td>${esc(p.paid_to)}</td>
                  <td><span class="diff-chip">${esc(p.remark)}</span></td>
                  <td><span class="status-pill ${isRev ? 'reviewed' : ''}">${isRev ? 'Revisado' : 'Pago Nuevo'}</span></td>
                  <td>
                    <button class="btn-soft" style="padding:4px 10px; font-size:12px;" onclick="toggleReviewItem('${esc(p.change_key)}', 'PAY', '${esc(p.remark || p.paid_from)}', '${isRev ? 'pending' : 'reviewed'}')">
                      ${isRev ? '↩ Desmarcar' : '✓ Revisar'}
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (state.auditSubtab === 'customer_diffs') {
    container.innerHTML = `
      <div class="table-wrap">
        <table class="ml-table">
          <thead>
            <tr>
              <th>Cliente (Customer Name en Accounting Summary)</th>
              <th>Costo Acumulado Anterior</th>
              <th>Costo Acumulado Actual</th>
              <th>Variación Semanal</th>
            </tr>
          </thead>
          <tbody>
            ${diff.customer_cost_diffs.map(cc => {
              const d = cc.delta || 0;
              return `
                <tr>
                  <td><strong>${esc(cc.customer_name)}</strong></td>
                  <td>${fmtMoney(cc.old_cost)}</td>
                  <td><strong>${fmtMoney(cc.cost)}</strong></td>
                  <td>
                    ${Math.abs(d) >= 0.01
                      ? `<span class="diff-chip"><span class="${d > 0 ? 'delta-pos' : 'delta-neg'}">${d > 0 ? '+' : ''}${fmtMoney(d)}</span></span>`
                      : '<span style="color:var(--text-muted)">Sin cambio</span>'}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (state.auditSubtab === 'eta_changes') {
    if (diff.eta_changes.length === 0) {
      container.innerHTML = `<p style="padding:20px; color:var(--text-muted);">No hubo actualizaciones de ETA o contenedor en este corte.</p>`;
      return;
    }
    container.innerHTML = `
      <div class="table-wrap">
        <table class="ml-table">
          <thead>
            <tr>
              <th>REF / INV NO</th>
              <th>Customer For</th>
              <th>Container</th>
              <th>Cambios Operativos (Antes → Ahora)</th>
            </tr>
          </thead>
          <tbody>
            ${diff.eta_changes.map(e => `
              <tr>
                <td><span class="ref-link" onclick="openRefHistory('${esc(e.ref_no)}')">${esc(e.ref_no)}</span></td>
                <td><strong>${esc(e.customer_for)}</strong> (${esc(e.customer)})</td>
                <td><code>${esc(e.container)}</code></td>
                <td>
                  <div class="diff-badge-list">
                    ${e.diffs.map(d => `<span class="diff-chip">${esc(d.label)}: <span class="old-val">${esc(d.old || 'vacío')}</span> → <span class="new-val">${esc(d.new || 'vacío')}</span></span>`).join('')}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (state.auditSubtab === 'removed_shipments') {
    if (diff.removed_shipments.length === 0) {
      container.innerHTML = `<p style="padding:20px; color:var(--text-muted);">Ninguna referencia fue eliminada respecto al Statement anterior.</p>`;
      return;
    }
    container.innerHTML = `
      <div class="table-wrap">
        <table class="ml-table">
          <thead>
            <tr>
              <th>REF / INV NO (En Statement Anterior)</th>
              <th>Customer</th>
              <th>Customer For</th>
              <th>Container</th>
              <th>Total Cost Anterior</th>
            </tr>
          </thead>
          <tbody>
            ${diff.removed_shipments.map(r => `
              <tr>
                <td><span class="ref-link" onclick="openRefHistory('${esc(r.ref_no)}')">${esc(r.ref_no)}</span></td>
                <td>${esc(r.customer)}</td>
                <td><strong>${esc(r.customer_for)}</strong></td>
                <td><code>${esc(r.container)}</code></td>
                <td>${fmtMoney(r.total_cost)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
}

// ================= VIEW 3: MASTER LIST =================
function populateMasterCustomerDropdown() {
  if (!state.currentDetail) return;
  const sel = document.getElementById('master-customer-filter');
  const currentVal = sel.value;
  const list = state.currentDetail.customers_for || [];
  sel.innerHTML = `<option value="">Todos los Clientes (${list.length})</option>` +
    list.map(c => `<option value="${esc(c)}" ${c === currentVal ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

function debounceLoadMaster() {
  clearTimeout(masterDebounceTimer);
  masterDebounceTimer = setTimeout(() => loadMasterList(), 220);
}

function showNewShipmentsInMaster() {
  switchTab('master');
  const chkNew = document.getElementById('master-new-only');
  if (chkNew) chkNew.checked = true;
  loadMasterList();
}

async function loadMasterList() {
  if (!state.activeRawDate) return;
  const search = document.getElementById('master-search').value.trim().toLowerCase();
  const cust = document.getElementById('master-customer-filter').value;
  const extraOnly = document.getElementById('master-extra-only')?.checked;
  const newOnly = document.getElementById('master-new-only')?.checked;

  const newRefsSet = new Set((state.currentDiff?.new_shipments || []).map(n => n.ref_no));

  if (!state.isStaticMode && !newOnly) {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (cust) params.set('customer_for', cust);
    if (extraOnly) params.set('only_extra_charges', 'true');

    const res = await fetch(`/api/statements/${state.activeRawDate}?${params.toString()}`);
    const data = await res.json();
    renderMasterTable(data.master_items || []);
  } else {
    const allItems = state.currentDetail?.master_items || [];
    const filtered = allItems.filter(item => {
      if (newOnly && !newRefsSet.has(item.ref_no)) return false;
      if (cust && item.customer_for !== cust) return false;
      if (extraOnly && !((item.amend_fee > 0) || (item.exw_fee > 0) || (item.inland_fee > 0) || (item.previo > 0) || (item.insurance > 0))) {
        return false;
      }
      if (search) {
        const hay = `${item.ref_no} ${item.customer} ${item.customer_for} ${item.container} ${item.shipping_line} ${item.pol} ${item.pod}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
    renderMasterTable(filtered);
  }
}

function renderMasterTable(items) {
  const tbody = document.getElementById('master-table-tbody');
  document.getElementById('master-title').textContent =
    `Hoja Master List (${items.length} embarques mostrados)`;

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="16" style="text-align:center; padding:24px; color:var(--text-muted);">No se encontraron referencias con los filtros seleccionados.</td></tr>`;
    return;
  }

  const changedRefs = new Set((state.currentDiff?.cost_changes || []).map(c => c.ref_no));
  const newRefs = new Set((state.currentDiff?.new_shipments || []).map(n => n.ref_no));

  tbody.innerHTML = items.map(item => {
    const isChanged = changedRefs.has(item.ref_no);
    const isNew = newRefs.has(item.ref_no);
    return `
      <tr style="${isNew ? 'background:#EFF6FF;' : (isChanged ? 'background:#FFF9E6;' : '')}">
        <td style="color:var(--text-muted);">${item.row_num}</td>
        <td style="white-space:nowrap;">
          <span class="ref-link" onclick="openRefHistory('${esc(item.ref_no)}')">${esc(item.ref_no)}</span>
          ${isChanged ? '<span class="status-pill" style="margin-left:4px; padding:2px 6px; font-size:10px;">Mod</span>' : ''}
          ${isNew ? '<span class="status-pill" style="margin-left:4px; padding:2px 6px; font-size:10px; background:#DBEAFE; color:#1E40AF; border:1px solid #93C5FD; font-weight:700;">✨ Nuevo</span>' : ''}
        </td>
        <td>${esc(item.customer)}</td>
        <td><strong>${esc(item.customer_for)}</strong></td>
        <td><code>${esc(item.container)}</code></td>
        <td><strong>${esc(item.shipping_line)}</strong> · ${esc(item.pol)} → ${esc(item.pod)}</td>
        <td style="white-space:nowrap;">${esc(item.etd)}<br/><span style="color:var(--text-secondary); font-size:11px;">ETA: ${esc(item.update_eta || item.eta || '—')}</span></td>
        <td>${fmtMoney(item.sea_freight)}</td>
        <td>${item.fob_cost ? fmtMoney(item.fob_cost) : '—'}</td>
        <td>${item.amend_fee ? `<strong style="color:var(--amber-text);">${fmtMoney(item.amend_fee)}</strong>` : '—'}</td>
        <td>${item.exw_fee ? `<strong style="color:var(--amber-text);">${fmtMoney(item.exw_fee)}</strong>` : '—'}</td>
        <td>${item.inland_fee ? `<strong style="color:var(--amber-text);">${fmtMoney(item.inland_fee)}</strong>` : '—'}</td>
        <td><strong>${fmtMoney(item.total_cost)}</strong></td>
        <td>${item.previo ? fmtMoney(item.previo) : '—'}</td>
        <td>${item.insurance ? fmtMoney(item.insurance) : '—'}</td>
        <td>${item.bill_amt !== null ? fmtMoney(item.bill_amt) : `<span style="font-size:11px; color:var(--text-muted);">${esc(item.bill_amt_text || item.remark)}</span>`}</td>
      </tr>
    `;
  }).join('');
}

// ================= VIEW 4: ACCOUNTING SUMMARY =================
function renderAccountingView() {
  if (!state.currentDetail || !state.currentDiff) return;
  const stmt = state.currentDetail.statement;

  document.getElementById('acc-top-kpis').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label"><span>Balance Pendiente (Eliezer)</span><span class="kpi-delta-pill">Accounting Summary</span></div>
      <div class="kpi-value-row"><span class="kpi-value">${fmtMoney(stmt.acc_balance)}</span></div>
      <div class="kpi-subtext">Total Cost (${fmtMoney(stmt.acc_total_cost)}) − Total Rcvd (${fmtMoney(stmt.acc_total_rcvd)})</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label"><span>Pagos desde México</span><span class="kpi-delta-pill green">Paid from Mexico</span></div>
      <div class="kpi-value-row"><span class="kpi-value">${fmtMoney(stmt.acc_paid_mexico)}</span></div>
      <div class="kpi-subtext">Pending Receive: ${fmtMoney(stmt.acc_pending_receive)} (${esc(stmt.acc_pending_note || 'Sin nota')})</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label"><span>Pagos en China</span><span class="kpi-delta-pill">Paid in China</span></div>
      <div class="kpi-value-row"><span class="kpi-value">${fmtMoney(stmt.acc_paid_china)}</span></div>
      <div class="kpi-subtext">Total Recibido Global: ${fmtMoney(stmt.acc_total_rcvd)}</div>
    </div>
  `;

  renderAccountingTables();
}

function renderAccountingTables() {
  if (!state.currentDetail || !state.currentDiff) return;
  const search = (document.getElementById('acc-pay-search')?.value || '').trim().toLowerCase();
  const secFilter = document.getElementById('acc-pay-section')?.value || 'ALL';

  const newPaySigs = new Set((state.currentDiff.new_payments || []).map(p => p.payment_sig));

  const payments = (state.currentDetail.payments || []).filter(p => {
    if (secFilter !== 'ALL' && p.section !== secFilter) return false;
    if (search) {
      const hay = `${p.paid_from} ${p.paid_to} ${p.remark} ${p.rcvd_date} ${p.rcvd_amt}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  document.getElementById('acc-payments-tbody').innerHTML = payments.map(p => {
    const isNew = newPaySigs.has(p.payment_sig);
    return `
      <tr style="${isNew ? 'background:#FFF9E6;' : ''}">
        <td>
          <span class="status-pill ${isNew ? '' : 'new-item'}">${esc(p.section)}${isNew ? ' · Nuevo' : ''}</span>
        </td>
        <td style="white-space:nowrap;">${esc(p.rcvd_date)}</td>
        <td><strong style="color:var(--green-text);">${fmtMoney(p.rcvd_amt)}</strong></td>
        <td><strong>${esc(p.paid_from)}</strong></td>
        <td>${esc(p.paid_to)}</td>
        <td><span class="diff-chip">${esc(p.remark)}</span></td>
      </tr>
    `;
  }).join('');

  document.getElementById('acc-cust-costs-tbody').innerHTML = (state.currentDiff.customer_cost_diffs || []).map(cc => {
    const d = cc.delta || 0;
    return `
      <tr>
        <td><strong>${esc(cc.customer_name)}</strong></td>
        <td><strong>${fmtMoney(cc.cost)}</strong></td>
        <td>
          ${Math.abs(d) >= 0.01
            ? `<span class="diff-chip"><span class="${d > 0 ? 'delta-pos' : 'delta-neg'}">${d > 0 ? '+' : ''}${fmtMoney(d)}</span></span>`
            : '<span style="color:var(--text-muted)">—</span>'}
        </td>
      </tr>
    `;
  }).join('');
}

// ================= VIEW 5: CONCENTRADO ML 2026 VS STATEMENT =================
function roundUp50Client(val) {
  if (!val || val <= 0) return 0;
  return Math.ceil((val - 1e-9) / 50.0) * 50.0;
}

function guessConcentradoSheetClient(m, sheetDist) {
  const cfor = String(m.customer_for || '').trim().toUpperCase();
  const cust = String(m.customer || '').trim().toUpperCase();
  const ref = String(m.ref_no || '').trim().toUpperCase();
  const sheetNames = (sheetDist || []).map(s => s.sheet.toUpperCase());

  if (sheetNames.includes(cfor)) {
    return sheetDist.find(s => s.sheet.toUpperCase() === cfor).sheet;
  }
  const directMap = {
    'MOBIL ZONE': 'MOBIL',
    'RED': 'RED',
    'RED PACK': 'RED',
    'LOGISTICA': 'LOGISTICA ',
    'CARSO': 'CICSA',
    'CICSA': 'CICSA',
    'SALOMON': 'SALOMON JASQUI',
    'JASQUI': 'SALOMON JASQUI',
    'BODEGA AURRERA': 'AURRERA',
    'DECATHLON': 'DECATHLON',
    'HUAWEI': 'HUAWEI',
    'MINISO': 'MINISO',
  };
  if (directMap[cfor]) return directMap[cfor];
  if (directMap[cust]) return directMap[cust];

  for (const s of (sheetDist || [])) {
    if ((s.mapped_customers_for || []).some(cf => cf.toUpperCase() === cfor)) {
      return s.sheet;
    }
  }
  if (sheetNames.includes(cust)) {
    return sheetDist.find(s => s.sheet.toUpperCase() === cust).sheet;
  }
  return cfor || cust || 'GENERAL';
}

function computeConcentradoTargetClient(m, targetSheet, sheetMeta) {
  const hdrs = (sheetMeta?.headers || []).map(h => String(h || '').toUpperCase());
  const hasRailCol = hdrs.some(h => h.includes('RAIL'));
  const hasSepPrevIns = hdrs.includes('PREVIO') && hdrs.includes('INSURANCE');
  const hasCombPrevIns = hdrs.some(h => h.includes('PREVIO') && h.includes('INSURANCE')) || (!hasSepPrevIns && hdrs.includes('INSURANCE'));
  const hasExwCol = hdrs.some(h => h.includes('EXW') || h.includes('AMEND') || h.includes('OTHER COST'));
  const hasDetCol = hdrs.some(h => h.includes('DETENTION'));

  const sea = Number(m.sea_freight || 0);
  const fob = Number(m.fob_cost || 0);
  const amend = Number(m.amend_fee || 0);
  const exw = Number(m.exw_fee || 0);
  const inland = Number(m.inland_fee || 0);
  const stmtTotal = Number(m.total_cost || 0);
  const stmtPrev = Number(m.previo || 0);
  const stmtIns = Number(m.insurance || 0);
  const stmtBill = typeof m.bill_amt === 'number' && m.bill_amt > 0 ? m.bill_amt : null;

  const suggRail = inland > 0 ? (inland <= 1700 ? 1700 : 1850) : 0;
  const suggPrevio = stmtPrev > 0 ? (String(targetSheet).trim().toUpperCase() === 'JAZ' ? 200 : 180) : 0;
  const suggIns = stmtIns > 0 ? stmtIns : 0;
  const suggExwAmend = exw + amend;

  const baseNoRail = sea + fob + (hasExwCol ? 0 : (exw + amend));
  let suggTotalCost = 0;
  let formulaLabel = '';

  if (stmtBill !== null) {
    if (hasRailCol && inland > 0 && stmtBill >= (baseNoRail + inland)) {
      suggTotalCost = stmtBill - suggRail;
      formulaLabel = `Tomado de BILL AMT ($${stmtBill.toLocaleString()}) − Rail ($${suggRail.toLocaleString()})`;
    } else {
      suggTotalCost = stmtBill;
      formulaLabel = `Tomado directo de BILL AMT ($${stmtBill.toLocaleString()})`;
    }
  } else {
    if (hasRailCol || inland === 0) {
      suggTotalCost = roundUp50Client(baseNoRail + 350);
      formulaLabel = `Redondeo múltiplo $50 (Costo $${baseNoRail.toLocaleString()} + $350 → $${suggTotalCost.toLocaleString()})`;
    } else {
      const baseWithRail = baseNoRail + suggRail;
      suggTotalCost = roundUp50Client(baseWithRail + 350);
      formulaLabel = `Redondeo múltiplo $50 c/Tren ($${baseWithRail.toLocaleString()} + $350 → $${suggTotalCost.toLocaleString()})`;
    }
  }

  const suggBillAmt = (
    suggTotalCost +
    (hasRailCol ? suggRail : 0) +
    ((hasSepPrevIns || hasCombPrevIns) ? (suggPrevio + suggIns) : 0) +
    (hasExwCol ? suggExwAmend : 0)
  );

  return {
    suggested_total_cost: suggTotalCost,
    suggested_rail: hasRailCol ? suggRail : 0,
    suggested_previo: suggPrevio,
    suggested_insurance: suggIns,
    suggested_previo_ins_comb: suggPrevio + suggIns,
    suggested_exw_amend: hasExwCol ? suggExwAmend : 0,
    suggested_exw_only: exw,
    suggested_amend_only: amend,
    suggested_detention: 0,
    suggested_bill_amt: suggBillAmt,
    stmt_bill_amt: stmtBill,
    formula_label: formulaLabel,
  };
}

async function loadConcentradoOverview() {
  if (!state.activeRawDate) return;
  if (!state.isStaticMode) {
    const res = await fetch(`/api/concentrado/overview?raw_date=${encodeURIComponent(state.activeRawDate)}`);
    state.concentrado = await res.json();
  } else {
    // En modo estático ya se pobló y preparó en refreshActiveStatementData()
    if (!state.concentrado || state.concentrado.raw_date !== state.activeRawDate) {
      await refreshActiveStatementData();
    }
  }
  renderConcentradoView();
  renderDashboard();
}

function setConcSubtab(sub) {
  state.concSubtab = sub;
  ['diffs', 'missing', 'sheets', 'razones'].forEach(k => {
    const btn = document.getElementById(`conc-subtab-btn-${k}`);
    if (btn) btn.classList.toggle('active', k === sub);
  });
  renderConcentradoView();
}

function renderConcentradoView() {
  if (!state.concentrado || !state.concentrado.exists) return;
  const conc = state.concentrado;
  const sum = conc.summary;

  document.getElementById('conc-cnt-diffs').textContent = conc.discrepancies.length;
  document.getElementById('conc-cnt-missing').textContent = conc.missing_in_concentrado.length;

  document.getElementById('conc-top-kpis').innerHTML = `
    <div class="kpi-card" onclick="setConcSubtab('diffs')">
      <div class="kpi-label">
        <span>Diferencias Statement vs Concentrado</span>
        <span class="kpi-delta-pill">${sum.high_discrepancies_count} por corregir</span>
      </div>
      <div class="kpi-value-row"><span class="kpi-value">${sum.high_discrepancies_count} ⚠️</span></div>
      <div class="kpi-subtext">+ ${sum.info_discrepancies_count} notas donde el Previo ($180) ya va sumado en Total Cost</div>
    </div>
    <div class="kpi-card" onclick="setConcSubtab('missing')">
      <div class="kpi-label">
        <span>Referencias por Insertar en Concentrado</span>
        <span class="kpi-delta-pill green">${sum.missing_refs_count === 0 ? '100% al día' : 'Pendientes'}</span>
      </div>
      <div class="kpi-value-row"><span class="kpi-value">${sum.missing_refs_count}</span></div>
      <div class="kpi-subtext">Del Statement ${state.currentDiff?.stmt_date || ''} hacia las ${sum.total_sheets} hojas de clientes</div>
    </div>
    <div class="kpi-card" onclick="setConcSubtab('razones')">
      <div class="kpi-label">
        <span>Saldo Cuenta General Concentrado</span>
        <span class="kpi-delta-pill">${sum.total_sheets} pestañas</span>
      </div>
      <div class="kpi-value-row"><span class="kpi-value">${fmtMoney(conc.cuenta_general_total)}</span></div>
      <div class="kpi-subtext">Archivo activo: ${esc(conc.filename)}</div>
    </div>
  `;

  const container = document.getElementById('conc-subtab-container');

  if (state.concSubtab === 'diffs') {
    const fixableCount = conc.discrepancies.filter(d => d.can_autofix).length;
    container.innerHTML = `
      <div class="card-panel-header">
        <div>
          <div class="card-panel-title">🔍 Diferencias Detectadas entre Statement (${state.currentDiff?.stmt_date || ''}) y Concentrado</div>
          <p style="font-size:12.5px; color:var(--text-secondary); margin-top:2px;">
            Se evalúa cada referencia según la lógica de su pestaña: si trae <code>BILL AMT</code> en el Statement pasa como <strong>TOTAL COST</strong> (descontando Rail $1,700 si la hoja tiene columna Rail); si viene vacío se suma <strong>+$350 y se redondea hacia arriba al múltiplo de $50</strong>, más Previo ($180 / $200 en JAZ) y Seguro ($100) sumados o separados según la hoja.
          </p>
        </div>
        <div style="display:flex; gap:8px;">
          ${fixableCount > 0 ? `
            <button class="btn-gold" onclick="applyAllConcentradoFixes()">
              ⚡ Aplicar las ${fixableCount} Correcciones en el Excel Concentrado
            </button>
          ` : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table class="ml-table">
          <thead>
            <tr>
              <th>Pestaña Concentrado</th>
              <th>Fila</th>
              <th>REF / INV NO</th>
              <th>Cliente (Customer / For)</th>
              <th>Categoría</th>
              <th>Columna en Hoja</th>
              <th>Valor en Concentrado</th>
              <th>Valor Esperado</th>
              <th>Explicación Detallada</th>
              <th>Acción en Excel</th>
            </tr>
          </thead>
          <tbody>
            ${conc.discrepancies.map((d, idx) => `
              <tr style="${d.severity === 'high' ? '' : 'background:#F8FBF8; opacity:0.88;'}">
                <td><span class="status-pill ${d.severity === 'high' ? '' : 'reviewed'}">${esc(d.sheet)}</span></td>
                <td>R${d.row}</td>
                <td><span class="ref-link" onclick="openRefHistory('${esc(d.ref_no)}')">${esc(d.ref_no)}</span></td>
                <td><strong>${esc(d.customer_for)}</strong><br/><span style="font-size:11px; color:var(--text-secondary);">${esc(d.customer)}</span></td>
                <td><span class="diff-chip">${esc(d.category)}</span></td>
                <td><code>${esc(d.column_name)}</code></td>
                <td style="color:var(--red-text); font-weight:700;">${fmtMoney(d.conc_value)}</td>
                <td style="color:var(--green-text); font-weight:800;">${fmtMoney(d.expected_value)}</td>
                <td style="max-width:360px; line-height:1.35;">${esc(d.description)}</td>
                <td>
                  ${d.can_autofix ? `
                    <button class="btn-gold" style="padding:5px 10px; font-size:11.5px;" onclick="applySingleConcentradoFix(${idx})">
                      ⚡ Corregir en Excel
                    </button>
                  ` : '<span style="font-size:11.5px; color:var(--green-text); font-weight:600;">✓ Incluido en Total</span>'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (state.concSubtab === 'missing') {
    if (conc.missing_in_concentrado.length === 0) {
      container.innerHTML = `
        <div style="padding:28px; text-align:center;">
          <div style="font-size:32px; margin-bottom:8px;">✅</div>
          <h3 style="font-size:16px; font-weight:800; margin-bottom:4px;">¡Todas las referencias del Statement ${state.currentDiff?.stmt_date || ''} ya están en sus hojas del Concentrado!</h3>
          <p style="font-size:13px; color:var(--text-secondary);">
            Cuando subas el próximo Statement semanal con referencias nuevas, aparecerán aquí con su <strong>TOTAL COST</strong> calculado (ya sea tomando el <code>BILL AMT</code> del Statement o sumando <strong>+$350 redondeado hacia arriba al múltiplo de $50</strong> cuando venga vacío) y respetando las columnas propias de cada hoja.
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="card-panel-header">
        <div>
          <div class="card-panel-title">➕ Referencias Nuevas del Statement Pendientes de Insertar en el Concentrado</div>
          <p style="font-size:12.5px; color:var(--text-secondary);">
            Si el Statement trae <code>BILL AMT</code> se usa como base para <strong>TOTAL COST</strong>; si viene vacío se calcula <strong>Costo + $350 redondeado al múltiplo de $50 superior</strong> y se respeta si la pestaña une o separa Previo ($180) y Seguro ($100).
          </p>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-soft" style="font-size:12px; color:var(--text-muted);" onclick="dismissAllMissing()" title="Desestimar todas las referencias pendientes">
            ✕ Desestimar Todas
          </button>
          <button class="btn-gold" onclick="insertAllMissingToConcentrado()">
            ➕ Insertar Todas (${conc.missing_in_concentrado.length}) en el Concentrado
          </button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="ml-table">
          <thead>
            <tr>
              <th>Pestaña Destino</th>
              <th>REF / INV NO</th>
              <th>Customer / For</th>
              <th>Container</th>
              <th>Costo Eliezer</th>
              <th>BILL AMT (Stmt)</th>
              <th>Regla Sugerida</th>
              <th style="min-width:130px;">TOTAL COST (Editable)</th>
              <th>Rail</th>
              <th>Previo + Seg</th>
              <th>EXW / Amend</th>
              <th>BILL AMT Total</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            ${conc.missing_in_concentrado.map((m, idx) => `
              <tr>
                <td><span class="status-pill">${esc(m.target_sheet)}</span></td>
                <td><strong>${esc(m.ref_no)}</strong></td>
                <td><strong>${esc(m.customer_for)}</strong><br/><span style="font-size:11px; color:var(--text-secondary);">${esc(m.customer)}</span></td>
                <td><code>${esc(m.container)}</code></td>
                <td>${fmtMoney(m.total_cost)}</td>
                <td>${m.stmt_bill_amt ? `<strong>${fmtMoney(m.stmt_bill_amt)}</strong>` : '<span style="color:var(--text-muted)">Vacío (Comercial)</span>'}</td>
                <td><span class="diff-chip">${esc(m.formula_label || 'Redondeo múltiplo $50 (+350)')}</span></td>
                <td>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <span style="font-weight:700; color:var(--text-secondary); font-size:12px;">$</span>
                    <input
                      type="number"
                      step="50"
                      id="edit-total-cost-${idx}"
                      value="${m.suggested_total_cost}"
                      style="width:95px; padding:4px 6px; font-weight:800; font-size:13px; color:var(--green-text); border:1.5px solid var(--border-warm); border-radius:6px; background:#FFFFFF; text-align:right;"
                      oninput="onEditMissingTotalCost(${idx}, this.value)"
                    />
                  </div>
                </td>
                <td>${fmtMoney(m.suggested_rail)}</td>
                <td>${fmtMoney((m.suggested_previo || 0) + (m.suggested_insurance || 0))}</td>
                <td>${fmtMoney(m.suggested_exw_amend)}</td>
                <td><strong id="missing-bill-amt-${idx}">${fmtMoney(m.suggested_bill_amt || ((m.suggested_total_cost || 0) + (m.suggested_rail || 0) + (m.suggested_previo || 0) + (m.suggested_insurance || 0) + (m.suggested_exw_amend || 0)))}</strong></td>
                <td>
                  <div style="display:flex; gap:6px; align-items:center;">
                    <button class="btn-gold" style="padding:5px 9px; font-size:11.5px; white-space:nowrap;" onclick="insertSingleMissingToConcentrado(${idx})" title="Insertar en la hoja ${esc(m.target_sheet)}">
                      ➕ Insertar
                    </button>
                    <button class="btn-soft" style="padding:5px 8px; font-size:11px; color:var(--text-muted); border-color:var(--border-warm); white-space:nowrap;" onclick="dismissSingleMissing(${idx})" title="Desestimar / Desechar esta referencia para que no se inserte">
                      ✕ Descartar
                    </button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (state.concSubtab === 'sheets') {
    container.innerHTML = `
      <div class="card-panel-header">
        <div>
          <div class="card-panel-title">🗂️ Análisis de Distribución y Margen por Cliente (${conc.sheet_distribution.length} Pestañas)</div>
          <p style="font-size:12.5px; color:var(--text-secondary);">
            Comparativa por pestaña: embarques registrados, saldo pendiente por cobrar (Me deben), Costo Eliezer vs Facturado en Concentrado y tu Margen de Ganancia por cliente.
          </p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="ml-table">
          <thead>
            <tr>
              <th>Pestaña en Concentrado</th>
              <th>Embarques</th>
              <th>Saldo Pendiente (Me Deben)</th>
              <th>Costo Eliezer (2026)</th>
              <th>Facturado Cliente (2026)</th>
              <th>Ganancia Bruta</th>
              <th>Clientes del Statement (CUSTOMER FOR)</th>
            </tr>
          </thead>
          <tbody>
            ${conc.sheet_distribution.map(s => {
              const gm = Number(s.gross_margin || 0);
              const gmClass = gm > 0 ? 'delta-neg' : (gm < 0 ? 'delta-pos' : '');
              return `
                <tr>
                  <td><strong>${esc(s.sheet)}</strong></td>
                  <td><strong>${s.rows_count}</strong></td>
                  <td><strong>${fmtMoney(s.balance)}</strong></td>
                  <td>${fmtMoney(s.stmt_cost_matched || 0)}</td>
                  <td><strong>${fmtMoney(s.conc_billed_matched || 0)}</strong></td>
                  <td><span class="${gmClass}" style="font-weight:800;">${gm >= 0 ? '+' : ''}${fmtMoney(gm)}</span></td>
                  <td>${s.mapped_customers_for.length ? s.mapped_customers_for.map(c => `<span class="diff-chip">${esc(c)}</span>`).join(' ') : '<span style="color:var(--text-muted)">Sin embarques 2026</span>'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (state.concSubtab === 'razones') {
    const map = new Map();
    (state.currentDetail?.payments || []).forEach(p => {
      const razon = (p.paid_from || '').trim();
      if (!razon) return;
      if (!map.has(razon)) {
        map.set(razon, { razon, remarks: new Set(), count: 0, total: 0 });
      }
      const entry = map.get(razon);
      if (p.remark) entry.remarks.add(p.remark.replace(/\n/g, ' ').trim());
      entry.count += 1;
      entry.total += Number(p.rcvd_amt || 0);
    });
    const razonesRows = Array.from(map.values()).sort((a, b) => b.total - a.total);

    container.innerHTML = `
      <div class="split-grid-2">
        <div>
          <h3 style="font-size:15px; font-weight:700; margin-bottom:10px;">📊 Hoja CUENTA GENERAL (Concentrado)</h3>
          <div class="table-wrap">
            <table class="ml-table">
              <thead>
                <tr>
                  <th>Cliente en Cuenta General</th>
                  <th>Saldo en Concentrado</th>
                </tr>
              </thead>
              <tbody>
                ${(conc.cuenta_general || []).map(r => `
                  <tr>
                    <td><strong>${esc(r.cliente)}</strong></td>
                    <td><strong>${fmtMoney(r.monto)}</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 style="font-size:15px; font-weight:700; margin-bottom:10px;">🔗 Razones Sociales Detectadas en Pagos (Paid From → Cliente)</h3>
          <div class="table-wrap">
            <table class="ml-table">
              <thead>
                <tr>
                  <th>Razón Social Pagadora (Paid From)</th>
                  <th>Cliente(s) (REMARK)</th>
                  <th>Pagos</th>
                  <th>Total Pagado</th>
                </tr>
              </thead>
              <tbody>
                ${razonesRows.map(r => `
                  <tr>
                    <td><strong>${esc(r.razon)}</strong></td>
                    <td>${Array.from(r.remarks).map(rem => `<span class="diff-chip">${esc(rem)}</span>`).join(' ')}</td>
                    <td>${r.count}</td>
                    <td><strong>${fmtMoney(r.total)}</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }
}

async function applySingleConcentradoFix(idx) {
  const d = state.concentrado?.discrepancies?.[idx];
  if (!d || !d.fix_action) return;
  await sendConcentradoActions([d.fix_action], `✅ Actualizado ${d.ref_no} en hoja ${d.sheet}`);
}

async function applyAllConcentradoFixes() {
  const actions = (state.concentrado?.discrepancies || [])
    .filter(d => d.can_autofix && d.fix_action)
    .map(d => d.fix_action);
  if (!actions.length) return;
  await sendConcentradoActions(actions, `✅ Se aplicaron ${actions.length} correcciones en el archivo Concentrado`);
}

function onEditMissingTotalCost(idx, val) {
  const m = state.concentrado?.missing_in_concentrado?.[idx];
  if (!m) return;
  const num = parseFloat(val) || 0;
  m.suggested_total_cost = num;
  m.suggested_bill_amt = num + (m.suggested_rail || 0) + (m.suggested_previo || 0) + (m.suggested_insurance || 0) + (m.suggested_exw_amend || 0);

  const billEl = document.getElementById(`missing-bill-amt-${idx}`);
  if (billEl) {
    billEl.textContent = fmtMoney(m.suggested_bill_amt);
  }
}

function dismissSingleMissing(idx) {
  const m = state.concentrado?.missing_in_concentrado?.[idx];
  if (!m) return;
  const key = `${m.target_sheet}:${m.ref_no}`;
  state.dismissedMissingRefs = state.dismissedMissingRefs || new Set(JSON.parse(localStorage.getItem('ml_dismissed_refs_v1') || '[]'));
  state.dismissedMissingRefs.add(key);
  try {
    localStorage.setItem('ml_dismissed_refs_v1', JSON.stringify(Array.from(state.dismissedMissingRefs)));
  } catch (e) {}

  state.concentrado.missing_in_concentrado = (state.concentrado.missing_in_concentrado || []).filter(
    x => `${x.target_sheet}:${x.ref_no}` !== key
  );
  state.concentrado.summary.missing_refs_count = state.concentrado.missing_in_concentrado.length;
  showToast(`✕ Referencia ${m.ref_no} desestimada`);
  renderConcentradoView();
  renderDashboard();
}

function dismissAllMissing() {
  const list = state.concentrado?.missing_in_concentrado || [];
  if (!list.length) return;
  if (!confirm(`¿Deseas desestimar las ${list.length} referencias para que no se inserten en el Concentrado?`)) return;

  state.dismissedMissingRefs = state.dismissedMissingRefs || new Set(JSON.parse(localStorage.getItem('ml_dismissed_refs_v1') || '[]'));
  list.forEach(m => state.dismissedMissingRefs.add(`${m.target_sheet}:${m.ref_no}`));
  try {
    localStorage.setItem('ml_dismissed_refs_v1', JSON.stringify(Array.from(state.dismissedMissingRefs)));
  } catch (e) {}

  state.concentrado.missing_in_concentrado = [];
  state.concentrado.summary.missing_refs_count = 0;
  showToast(`✕ Se desestimaron las ${list.length} referencias`);
  renderConcentradoView();
  renderDashboard();
}

async function insertSingleMissingToConcentrado(idx) {
  const m = state.concentrado?.missing_in_concentrado?.[idx];
  if (!m) return;
  await sendConcentradoActions([{
    type: 'INSERT_REF',
    sheet: m.target_sheet,
    ref_no: m.ref_no,
    item: m,
  }], `✅ Referencia ${m.ref_no} insertada en la hoja ${m.target_sheet}`);
}

async function insertAllMissingToConcentrado() {
  const actions = (state.concentrado?.missing_in_concentrado || []).map(m => ({
    type: 'INSERT_REF',
    sheet: m.target_sheet,
    ref_no: m.ref_no,
    item: m,
  }));
  if (!actions.length) return;
  await sendConcentradoActions(actions, `✅ Se insertaron ${actions.length} referencias nuevas en el Concentrado`);
}

async function handleUploadNewConcentrado(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    alert('Por favor selecciona un archivo Excel (.xlsx)');
    event.target.value = '';
    return;
  }

  const confirmMsg = `¿Deseas subir "${file.name}" y establecerlo como la NUEVA LEY del Concentrado?\n\nEsto actualizará todas las hojas, saldos y referencias base.`;
  if (!confirm(confirmMsg)) {
    event.target.value = '';
    return;
  }

  showToast('⏳ Procesando y analizando el nuevo Concentrado...');

  if (!state.isStaticMode) {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch('/api/concentrado/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.detail || 'Error al subir el archivo');
      }
      showToast('✅ Nuevo Concentrado guardado y establecido como ley');
      await loadConcentradoOverview();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  } else {
    // Modo Azure Static Web App: procesar con SheetJS en el navegador
    try {
      const reader = new FileReader();
      reader.onload = async function(e) {
        try {
          const data = new Uint8Array(e.target.result);
          if (typeof XLSX === 'undefined') {
            throw new Error('La librería SheetJS no está disponible');
          }
          const wb = XLSX.read(data, { type: 'array', cellDates: true });

          // 1. Limpiar referencias aplicadas / pendientes previas porque este nuevo archivo ya es ley
          localStorage.removeItem('ml_applied_refs_v1');
          localStorage.removeItem('ml_dismissed_refs_v1');
          localStorage.removeItem('ml_pending_actions_v1');
          state.pendingStaticConcentradoActions = [];

          // 2. Extraer todas las referencias del nuevo Concentrado
          const concRefs = new Set();
          wb.SheetNames.forEach(sName => {
            if (sName === 'CUENTA GENERAL') return;
            const ws = wb.Sheets[sName];
            if (!ws || !ws['!ref']) return;
            const range = XLSX.utils.decode_range(ws['!ref']);
            for (let R = 2; R <= range.e.r; ++R) {
              const cell = ws[XLSX.utils.encode_cell({ r: R, c: 0 })];
              if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
                concRefs.add(String(cell.v).trim().toUpperCase());
              }
            }
          });

          // 3. Recalcular las referencias faltantes del Statement actual contra este nuevo Concentrado
          if (state.concentrado) {
            state.concentrado.filename = file.name;
            const currentItems = state.currentDetail?.master_items || [];
            const newMissing = [];

            currentItems.forEach(m => {
              const rUp = String(m.ref_no || '').trim().toUpperCase();
              if (rUp && !concRefs.has(rUp)) {
                const targetSheet = guessConcentradoSheetClient(m, state.concentrado.sheet_distribution);
                const sheetMeta = (state.concentrado.sheet_distribution || []).find(s => s.sheet === targetSheet);
                const calc = computeConcentradoTargetClient(m, targetSheet, sheetMeta);
                newMissing.push({
                  ref_no: m.ref_no,
                  customer: m.customer,
                  customer_for: m.customer_for,
                  container: m.container,
                  etd: m.etd,
                  eta: m.eta,
                  update_eta: m.update_eta,
                  shipping_line: m.shipping_line,
                  pol: m.pol,
                  pod: m.pod,
                  sea_freight: m.sea_freight,
                  fob_cost: m.fob_cost,
                  inland_fee: m.inland_fee,
                  total_cost: m.total_cost,
                  previo: m.previo,
                  insurance: m.insurance,
                  exw: m.exw_fee,
                  amend: m.amend_fee,
                  target_sheet: targetSheet,
                  ...calc,
                });
              }
            });

            state.concentrado.missing_in_concentrado = newMissing;
            state.concentrado.summary.missing_refs_count = newMissing.length;
          }

          showToast(`✅ "${file.name}" cargado y establecido como Ley (${concRefs.size} referencias leídas)`);
          renderConcentradoView();
          renderDashboard();
        } catch (parseErr) {
          console.error(parseErr);
          alert('Error al leer el archivo Excel: ' + parseErr.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err) {
      alert('Error al procesar archivo: ' + err.message);
    }
  }

  event.target.value = '';
}

async function sendConcentradoActions(actions, successMsg) {
  if (!state.isStaticMode) {
    showToast('⏳ Actualizando CONCENTRADO ML LOGISTICS ELIEZER 2026.xlsx...');
    const res = await fetch('/api/concentrado/apply-fixes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.detail || 'Error al actualizar el archivo Concentrado');
      return;
    }
    showToast(successMsg);
    await loadConcentradoOverview();
  } else {
    state.pendingStaticConcentradoActions = (state.pendingStaticConcentradoActions || []).concat(actions);
    const fixedRefs = new Set(actions.map(a => `${a.sheet}:${a.ref_no}`));

    // Guardar en localStorage para que persista tras refrescar la página
    try {
      const appliedList = JSON.parse(localStorage.getItem('ml_applied_refs_v1') || '[]');
      const appliedSet = new Set(appliedList);
      actions.forEach(a => {
        if (a.sheet && a.ref_no) appliedSet.add(`${a.sheet}:${a.ref_no}`);
      });
      localStorage.setItem('ml_applied_refs_v1', JSON.stringify(Array.from(appliedSet)));

      // También guardar las acciones pendientes acumuladas
      const storedPending = JSON.parse(localStorage.getItem('ml_pending_actions_v1') || '[]');
      const combined = storedPending.concat(actions);
      localStorage.setItem('ml_pending_actions_v1', JSON.stringify(combined));
    } catch (e) {}

    if (state.concentrado) {
      state.concentrado.discrepancies = (state.concentrado.discrepancies || []).filter(
        d => !fixedRefs.has(`${d.sheet}:${d.ref_no}`)
      );
      state.concentrado.missing_in_concentrado = (state.concentrado.missing_in_concentrado || []).filter(
        m => !fixedRefs.has(`${m.target_sheet}:${m.ref_no}`)
      );
      state.concentrado.summary.high_discrepancies_count = state.concentrado.discrepancies.filter(d => d.severity === 'high').length;
      state.concentrado.summary.missing_refs_count = state.concentrado.missing_in_concentrado.length;
    }
    showToast(`${successMsg} (Usa "Descargar Concentrado" para bajar el Excel actualizado)`);
    renderConcentradoView();
    renderDashboard();
  }
}

async function downloadConcentradoFile() {
  if (!state.isStaticMode) {
    window.location.href = '/api/concentrado/download';
    showToast('⬇️ Descargando CONCENTRADO ML LOGISTICS ELIEZER 2026.xlsx...');
    return;
  }

  // En modo estático (Azure Static Web Apps)
  // Recuperar las acciones pendientes de memoria o de localStorage
  const storedPending = JSON.parse(localStorage.getItem('ml_pending_actions_v1') || '[]');
  const pending = (state.pendingStaticConcentradoActions && state.pendingStaticConcentradoActions.length)
    ? state.pendingStaticConcentradoActions
    : storedPending;

  if (!pending.length) {
    const a = document.createElement('a');
    a.href = 'data/CONCENTRADO ML LOGISTICS ELIEZER 2026.xlsx';
    a.download = `CONCENTRADO ML LOGISTICS ELIEZER 2026 (${new Date().toISOString().slice(0, 10)}).xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('⬇️ Descargando Concentrado base...');
    return;
  }

  showToast('⏳ Modificando Concentrado conservando el 100% de formatos, fórmulas y colores...');

  try {
    // 1. Cargar el ZIP del Excel original y los metadatos XML
    const [xlsxResp, metaResp] = await Promise.all([
      fetch('data/CONCENTRADO ML LOGISTICS ELIEZER 2026.xlsx'),
      fetch('data/concentrado_xml_meta.json')
    ]);

    const xlsxArrayBuf = await xlsxResp.arrayBuffer();
    const meta = await metaResp.json();

    if (typeof JSZip === 'undefined') {
      throw new Error('La librería JSZip no se ha cargado en el navegador');
    }

    const zip = await JSZip.loadAsync(xlsxArrayBuf);
    const blueXfs = new Set(meta.blue_xfs || []);
    const blueToWhite = meta.blue_to_white || {};
    const sheetBlueTemplates = meta.sheet_blue_templates || {};
    const sheetPaths = meta.sheet_paths || {};
    const sheetHeaders = meta.sheet_headers || {};
    const sheetFormulaTemplates = meta.sheet_formula_templates || {};

    // Agrupar acciones por hoja
    const actionsBySheet = {};
    for (const act of pending) {
      if (!actionsBySheet[act.sheet]) actionsBySheet[act.sheet] = [];
      actionsBySheet[act.sheet].push(act);
    }

    const parser = new DOMParser();
    const serializer = new XMLSerializer();

    for (const sheetName of Object.keys(actionsBySheet)) {
      const sheetPath = sheetPaths[sheetName];
      if (!sheetPath) continue;
      const fileEntry = zip.file(sheetPath);
      if (!fileEntry) continue;

      const xmlText = await fileEntry.async('string');
      const doc = parser.parseFromString(xmlText, 'application/xml');
      const sheetData = doc.querySelector('sheetData');
      if (!sheetData) continue;

      const existingRows = Array.from(sheetData.querySelectorAll('row'));
      let maxRow = 2;
      for (const r of existingRows) {
        const rNum = parseInt(r.getAttribute('r') || '0', 10);
        if (rNum > maxRow) maxRow = rNum;
      }

      // PASO 1: Blanquear filas previas que estaban en azul (SIN TOCAR LAS AMARILLAS)
      for (const r of existingRows) {
        const rNum = parseInt(r.getAttribute('r') || '0', 10);
        if (rNum < 3) continue;

        let rowHasBlue = false;
        const cells = Array.from(r.querySelectorAll('c'));
        for (const c of cells) {
          const sId = parseInt(c.getAttribute('s') || '0', 10);
          if (blueXfs.has(sId)) {
            rowHasBlue = true;
            break;
          }
        }

        if (rowHasBlue) {
          for (const c of cells) {
            const sId = parseInt(c.getAttribute('s') || '0', 10);
            if (blueXfs.has(sId)) {
              const newSId = blueToWhite[sId] !== undefined ? blueToWhite[sId] : 0;
              c.setAttribute('s', String(newSId));
            }
          }
        }
      }

      // PASO 2: Procesar las acciones (INSERT_REF y SET_CELL)
      const hdrs = sheetHeaders[sheetName] || {};
      const formulaTpl = sheetFormulaTemplates[sheetName] || {};
      const blueTpl = sheetBlueTemplates[sheetName] || {};

      let currNextRow = maxRow + 1;

      for (const act of actionsBySheet[sheetName]) {
        if (act.type === 'INSERT_REF' && act.item) {
          const it = act.item;
          const newRowElem = doc.createElementNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'row');
          newRowElem.setAttribute('r', String(currNextRow));
          newRowElem.setAttribute('spans', '1:24');

          // Iterar por las columnas definidas en las cabeceras
          for (const colLetter of Object.keys(hdrs)) {
            const hText = hdrs[colLetter] || '';
            const cellElem = doc.createElementNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'c');
            const cellRef = `${colLetter}${currNextRow}`;
            cellElem.setAttribute('r', cellRef);

            // Asignar estilo azul exacto
            const styleId = blueTpl[colLetter] !== undefined ? blueTpl[colLetter] : 423;
            cellElem.setAttribute('s', String(styleId));

            // Fórmulas automáticas (por ejemplo SUM(J4:K4) o L4)
            if (formulaTpl[colLetter]) {
              const [origR, origF] = formulaTpl[colLetter];
              // Adaptar números de fila en la fórmula
              const adaptedFormula = origF.replace(new RegExp(`([A-Z]+)${origR}`, 'g'), `$1${currNextRow}`);
              const fElem = doc.createElementNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'f');
              fElem.textContent = adaptedFormula;
              cellElem.appendChild(fElem);

              // Valor estimado calculado
              const vElem = doc.createElementNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'v');
              const estVal = Number(it.suggested_bill_amt || it.suggested_total_cost || 0);
              vElem.textContent = String(estVal);
              cellElem.appendChild(vElem);
            } else {
              // Valores directos
              let cellVal = null;
              let isNum = false;

              if (hText.includes('REF/INV')) cellVal = it.ref_no || '';
              else if (hText === 'CUSTOMER') cellVal = it.customer || '';
              else if (hText === 'CUSTOMER FOR') cellVal = it.customer_for || '';
              else if (hText === 'CONTAINER') cellVal = it.container || '';
              else if (hText === 'ETD') cellVal = it.etd || '';
              else if (hText === 'ETA') cellVal = it.update_eta || it.eta || '';
              else if (hText === 'SHIPPING LINE') cellVal = it.shipping_line || '';
              else if (hText === 'POL') cellVal = it.pol || '';
              else if (hText === 'POD') cellVal = it.pod || '';
              else if (hText === 'TOTAL COST') { cellVal = Number(it.suggested_total_cost || 0); isNum = true; }
              else if (hText.includes('RAIL')) { cellVal = Number(it.suggested_rail || 0); isNum = true; }
              else if (hText.includes('PREVIO') && hText.includes('INSURANCE')) {
                cellVal = Number(it.suggested_previo_ins_comb ?? ((it.suggested_previo || 0) + (it.suggested_insurance || 0)));
                isNum = true;
              } else if (hText.includes('PREVIO')) { cellVal = Number(it.suggested_previo || 0); isNum = true; }
              else if (hText.includes('INSURANCE')) {
                const hasSep = Object.values(hdrs).includes('PREVIO') && Object.values(hdrs).includes('INSURANCE');
                cellVal = Number(hasSep ? (it.suggested_insurance || 0) : (it.suggested_previo_ins_comb ?? ((it.suggested_previo || 0) + (it.suggested_insurance || 0))));
                isNum = true;
              } else if (hText.includes('EXW') && !hText.includes('AMEND')) { cellVal = Number(it.suggested_exw_only ?? it.exw ?? 0); isNum = true; }
              else if (hText.includes('AMEND') && !hText.includes('EXW')) { cellVal = Number(it.suggested_amend_only ?? it.amend ?? 0); isNum = true; }
              else if (hText.includes('EXW') || hText.includes('AMEND') || hText.includes('OTHER COST')) {
                cellVal = Number(it.suggested_exw_amend || 0);
                isNum = true;
              } else if (hText === 'BILL AMT') {
                cellVal = Number(it.suggested_bill_amt || it.suggested_total_cost || 0);
                isNum = true;
              }

              if (cellVal !== null && cellVal !== undefined) {
                const vElem = doc.createElementNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'v');
                if (isNum) {
                  vElem.textContent = String(cellVal);
                } else {
                  // Textos directos mediante inlineStr para no corromper la tabla de strings compartidos
                  cellElem.setAttribute('t', 'inlineStr');
                  const isElem = doc.createElementNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'is');
                  const tElem = doc.createElementNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 't');
                  tElem.textContent = String(cellVal);
                  isElem.appendChild(tElem);
                  cellElem.appendChild(isElem);
                }
                if (isNum) cellElem.appendChild(vElem);
              }
            }

            newRowElem.appendChild(cellElem);
          }

          sheetData.appendChild(newRowElem);
          currNextRow++;
        }
      }

      // Guardar el XML modificado dentro del ZIP
      const newXmlText = serializer.serializeToString(doc);
      zip.file(sheetPath, newXmlText);
    }

    // 3. Generar el nuevo archivo XLSX intacto y descargarlo
    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CONCENTRADO ML LOGISTICS ELIEZER 2026 (${new Date().toISOString().slice(0, 10)}).xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    showToast('✅ Concentrado descargado con las referencias añadidas, azules actualizados y amarillos 100% protegidos');
  } catch (err) {
    console.error(err);
    alert('Error al generar el Concentrado: ' + err.message);
  }
}

// ================= REVIEW / APPROVAL ACTIONS =================
async function toggleReviewItem(changeKey, changeType, refNo, newStatus) {
  if (!state.isStaticMode) {
    await fetch('/api/reviews/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        change_key: changeKey,
        raw_date: state.activeRawDate,
        change_type: changeType,
        ref_no: refNo,
        status: newStatus,
        note: '',
      }),
    });
  } else {
    state.localReviews[changeKey] = newStatus;
    localStorage.setItem('ml_reviews_v1', JSON.stringify(state.localReviews));
  }
  showToast(newStatus === 'reviewed' ? `✓ ${refNo} marcado como Revisado` : `↩ ${refNo} marcado como Pendiente`);
  await refreshActiveStatementData();
}

async function markAllChangesReviewed() {
  if (!state.currentDiff) return;
  const items = [];
  state.currentDiff.cost_changes.forEach(c => {
    items.push({ change_key: c.change_key, raw_date: state.activeRawDate, change_type: 'COST', ref_no: c.ref_no, status: 'reviewed', note: '' });
  });
  state.currentDiff.new_shipments.forEach(n => {
    items.push({ change_key: n.change_key, raw_date: state.activeRawDate, change_type: 'NEW', ref_no: n.ref_no, status: 'reviewed', note: '' });
  });
  state.currentDiff.new_payments.forEach(p => {
    items.push({ change_key: p.change_key, raw_date: state.activeRawDate, change_type: 'PAY', ref_no: p.remark || p.paid_from, status: 'reviewed', note: '' });
  });

  if (items.length === 0) {
    showToast('No hay cambios pendientes por marcar en este Statement.');
    return;
  }

  if (!state.isStaticMode) {
    await fetch('/api/reviews/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
  } else {
    items.forEach(it => { state.localReviews[it.change_key] = 'reviewed'; });
    localStorage.setItem('ml_reviews_v1', JSON.stringify(state.localReviews));
  }
  showToast(`✅ Se marcaron ${items.length} cambios del Statement ${state.currentDiff.stmt_date} como Revisados`);
  await refreshActiveStatementData();
}

// ================= REFERENCE HISTORY MODAL =================
async function openRefHistory(refNo) {
  const modal = document.getElementById('ref-history-modal');
  const body = document.getElementById('modal-ref-body');
  document.getElementById('modal-ref-title').textContent = `Historial Semanal de Referencia: ${refNo}`;
  body.innerHTML = `<p style="padding:16px;">Consultando los 21 Statements para <strong>${esc(refNo)}</strong>...</p>`;
  modal.classList.add('open');

  let hist = [];
  if (!state.isStaticMode) {
    const res = await fetch(`/api/references/${encodeURIComponent(refNo)}/history`);
    const data = await res.json();
    hist = data.history || [];
  } else {
    if (!state.staticRefHistory) {
      state.staticRefHistory = (await fetchStaticData('ref_history.json')) || {};
    }
    hist = state.staticRefHistory[refNo] || [];
  }

  if (!hist.length) {
    body.innerHTML = `<p style="padding:16px;">No se encontró historial para ${esc(refNo)}.</p>`;
    return;
  }

  const latest = hist[hist.length - 1];
  document.getElementById('modal-ref-subtitle').textContent =
    `Cliente: ${latest.customer} (Customer For: ${latest.customer_for}) · Contenedor: ${latest.container} · Apariciones: ${hist.length} Statements`;

  body.innerHTML = `
    <div class="table-wrap">
      <table class="ml-table">
        <thead>
          <tr>
            <th>Fecha Statement</th>
            <th>Contenedor</th>
            <th>ETA / Update ETA</th>
            <th>Sea Freight</th>
            <th>FOB Cost</th>
            <th>Amend Fee</th>
            <th>EXW Fee</th>
            <th>Inland Fee</th>
            <th>Total Cost</th>
            <th>Previo</th>
            <th>Insurance</th>
            <th>Cambio en esa Semana</th>
          </tr>
        </thead>
        <tbody>
          ${hist.map((h, i) => {
            const prev = i > 0 ? hist[i - 1] : null;
            const changes = [];
            if (prev) {
              if (Math.abs((h.sea_freight || 0) - (prev.sea_freight || 0)) >= 0.01) changes.push(`Sea: ${fmtMoney(prev.sea_freight)}→${fmtMoney(h.sea_freight)}`);
              if (Math.abs((h.fob_cost || 0) - (prev.fob_cost || 0)) >= 0.01) changes.push(`FOB: ${fmtMoney(prev.fob_cost)}→${fmtMoney(h.fob_cost)}`);
              if (Math.abs((h.amend_fee || 0) - (prev.amend_fee || 0)) >= 0.01) changes.push(`Amend: ${fmtMoney(prev.amend_fee)}→${fmtMoney(h.amend_fee)}`);
              if (Math.abs((h.exw_fee || 0) - (prev.exw_fee || 0)) >= 0.01) changes.push(`EXW: ${fmtMoney(prev.exw_fee)}→${fmtMoney(h.exw_fee)}`);
              if (Math.abs((h.inland_fee || 0) - (prev.inland_fee || 0)) >= 0.01) changes.push(`Inland: ${fmtMoney(prev.inland_fee)}→${fmtMoney(h.inland_fee)}`);
              if (Math.abs((h.previo || 0) - (prev.previo || 0)) >= 0.01) changes.push(`Previo: ${fmtMoney(prev.previo)}→${fmtMoney(h.previo)}`);
              if (Math.abs((h.insurance || 0) - (prev.insurance || 0)) >= 0.01) changes.push(`Seg: ${fmtMoney(prev.insurance)}→${fmtMoney(h.insurance)}`);
              if (Math.abs((h.total_cost || 0) - (prev.total_cost || 0)) >= 0.01) changes.push(`Total: ${fmtMoney(prev.total_cost)}→${fmtMoney(h.total_cost)}`);
            }
            const hasDiff = changes.length > 0;
            return `
              <tr style="${hasDiff ? 'background:#FFF8E1;' : ''}">
                <td><strong>${esc(h.stmt_date)}</strong></td>
                <td><code>${esc(h.container)}</code></td>
                <td>${esc(h.update_eta || h.eta || '—')}</td>
                <td>${fmtMoney(h.sea_freight)}</td>
                <td>${h.fob_cost ? fmtMoney(h.fob_cost) : '—'}</td>
                <td>${h.amend_fee ? `<strong>${fmtMoney(h.amend_fee)}</strong>` : '—'}</td>
                <td>${h.exw_fee ? `<strong>${fmtMoney(h.exw_fee)}</strong>` : '—'}</td>
                <td>${h.inland_fee ? `<strong>${fmtMoney(h.inland_fee)}</strong>` : '—'}</td>
                <td><strong>${fmtMoney(h.total_cost)}</strong></td>
                <td>${h.previo ? fmtMoney(h.previo) : '—'}</td>
                <td>${h.insurance ? fmtMoney(h.insurance) : '—'}</td>
                <td>
                  ${i === 0
                    ? '<span class="status-pill new-item">Alta Inicial</span>'
                    : hasDiff
                      ? changes.map(c => `<span class="diff-chip">${esc(c)}</span>`).join(' ')
                      : '<span style="color:var(--text-muted)">Sin cambio</span>'}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function closeRefModal(e) {
  document.getElementById('ref-history-modal').classList.remove('open');
}

// ================= UPLOAD & ONEDRIVE SYNC =================
function triggerFileInput() {
  document.getElementById('hidden-file-input').click();
}

async function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  await uploadStatementFile(file);
  event.target.value = '';
}

function setupDragAndDrop() {
  const dz = document.getElementById('dropzone');
  if (!dz) return;

  ['dragenter', 'dragover'].forEach(evName => {
    dz.addEventListener(evName, e => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(evName => {
    dz.addEventListener(evName, e => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove('dragover');
    });
  });

  dz.addEventListener('drop', async e => {
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await uploadStatementFile(files[0]);
    }
  });
}

function parseExcelStatementClientSide(file, rawDate) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
        const fmtD = v => {
          if (!v) return '';
          if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
          return String(v).trim();
        };
        const num = v => {
          if (v === null || v === undefined || v === '' || v === '-') return 0;
          if (typeof v === 'number') return isFinite(v) ? v : 0;
          const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
          return isNaN(n) ? 0 : n;
        };

        const mlSheetName = wb.SheetNames.find(s => s.toLowerCase().includes('master')) || wb.SheetNames[1];
        const mlRows = XLSX.utils.sheet_to_json(wb.Sheets[mlSheetName], { header: 1, defval: null });
        const masterItems = [];
        const seenRefs = {};
        let totalCostMaster = 0, totalPrevio = 0, totalIns = 0;

        for (let i = 1; i < mlRows.length; i++) {
          const r = mlRows[i];
          if (!r || !r[0] || String(r[0]).trim().toUpperCase().startsWith('REF')) continue;
          const refNo = String(r[0]).trim();
          seenRefs[refNo] = (seenRefs[refNo] || 0) + 1;
          const refKey = seenRefs[refNo] === 1 ? refNo : `${refNo}__ROW${i + 1}`;
          const item = {
            raw_date: rawDate,
            row_num: i + 1,
            ref_key: refKey,
            ref_no: refNo,
            customer: String(r[1] || '').trim(),
            customer_for: String(r[2] || '').trim(),
            container: String(r[3] || '').trim(),
            etd: fmtD(r[4]),
            eta: fmtD(r[5]),
            update_eta: fmtD(r[6]),
            shipping_line: String(r[7] || '').trim(),
            pol: String(r[8] || '').trim(),
            pod: String(r[9] || '').trim(),
            sea_freight: num(r[10]),
            fob_cost: num(r[11]),
            amend_fee: num(r[12]),
            exw_fee: num(r[13]),
            inland_fee: num(r[14]),
            total_cost: num(r[15]),
            previo: num(r[16]),
            insurance: num(r[17]),
            bill_amt: typeof r[18] === 'number' ? r[18] : null,
            bill_amt_text: typeof r[18] === 'number' ? '' : String(r[18] || '').trim(),
            remark: String(r[19] || '').trim(),
          };
          totalCostMaster += item.total_cost;
          totalPrevio += item.previo;
          totalIns += item.insurance;
          masterItems.push(item);
        }

        const accSheetName = wb.SheetNames.find(s => s.toUpperCase().includes('ACCOUNTING')) || wb.SheetNames[0];
        const accRows = XLSX.utils.sheet_to_json(wb.Sheets[accSheetName], { header: 1, defval: null });
        const accBalance = num(accRows[0]?.[1]);
        const accPending = num(accRows[1]?.[1]);
        const accPendingNote = String(accRows[1]?.[2] || '').trim();
        const accTotalRcvd = num(accRows[2]?.[1]);
        const accTotalCost = num(accRows[2]?.[3]);
        const accPaidMexico = num(accRows[3]?.[1]);
        let accPaidChina = 0;
        const payments = [];
        const custCosts = [];
        let section = 'MEXICO';

        for (let i = 5; i < accRows.length; i++) {
          const r = accRows[i];
          if (!r) continue;
          const c0 = String(r[0] || '').trim();
          if (c0.toUpperCase().includes('PAID IN CHINA')) {
            section = 'CHINA';
            accPaidChina = num(r[1]);
            continue;
          }
          if (c0.toUpperCase().includes('RCVD')) continue;
          const amt = num(r[1]);
          if (c0 && amt > 0) {
            const pDate = fmtD(r[0]);
            const pFrom = String(r[2] || '').trim();
            const pTo = String(r[3] || '').trim();
            const rem = String(r[4] || '').trim();
            payments.push({
              raw_date: rawDate,
              row_num: i + 1,
              section,
              rcvd_date: pDate,
              rcvd_amt: amt,
              paid_from: pFrom,
              paid_to: pTo,
              remark: rem,
              payment_sig: `${section}|${pDate}|${amt.toFixed(2)}|${pFrom.toUpperCase()}|${rem.toUpperCase()}`,
            });
          }
          if (section === 'MEXICO' && r[6] && num(r[7]) > 0) {
            custCosts.push({
              raw_date: rawDate,
              customer_name: String(r[6]).trim(),
              cost: num(r[7]),
              remark: String(r[8] || '').trim(),
            });
          }
        }

        const stmtDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
        const prevStmt = state.statements[0];
        const stmtSummary = {
          raw_date: rawDate,
          stmt_date: stmtDate,
          filename: file.name,
          total_containers: masterItems.length,
          total_cost_master: Number(totalCostMaster.toFixed(2)),
          total_previo: Number(totalPrevio.toFixed(2)),
          total_insurance: Number(totalIns.toFixed(2)),
          acc_balance: accBalance,
          acc_pending_receive: accPending,
          acc_pending_note: accPendingNote,
          acc_total_rcvd: accTotalRcvd,
          acc_total_cost: accTotalCost,
          acc_paid_mexico: accPaidMexico,
          acc_paid_china: accPaidChina,
          prev_raw_date: prevStmt ? prevStmt.raw_date : null,
          delta_containers: prevStmt ? masterItems.length - prevStmt.total_containers : 0,
          delta_cost: prevStmt ? Number((totalCostMaster - prevStmt.total_cost_master).toFixed(2)) : 0,
          delta_balance: prevStmt ? Number((accBalance - prevStmt.acc_balance).toFixed(2)) : 0,
        };

        const cforSet = Array.from(new Set(masterItems.map(m => m.customer_for).filter(Boolean))).sort();
        resolve({
          stmtSummary,
          detailPayload: {
            statement: stmtSummary,
            master_items: masterItems,
            payments,
            customer_costs: custCosts,
            customers_for: cforSet,
          },
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function uploadStatementFile(file) {
  let customDate = null;
  const mDate = file.name.match(/(202\d{5})/);
  if (!mDate) {
    customDate = prompt(
      `El archivo "${file.name}" no incluye la fecha en el nombre. Ingresa la fecha del Statement en formato AAAAMMDD (ejemplo: 20261021):`,
      new Date().toISOString().slice(0, 10).replace(/-/g, '')
    );
    if (!customDate) return;
  }
  const rawDate = mDate ? mDate[1] : customDate.replace(/\D/g, '').slice(0, 8);

  showToast(`⏳ Procesando "${file.name}"...`);

  if (!state.isStaticMode) {
    const formData = new FormData();
    formData.append('file', file);
    if (customDate) formData.append('custom_date', customDate);

    const res = await fetch('/api/statements/upload', {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.detail || 'Error al cargar el archivo');
      return;
    }

    showToast(`✅ Statement ${data.raw_date} cargado y auditado con éxito`);
    await loadStatementsList(data.raw_date);
  } else {
    try {
      const { stmtSummary, detailPayload } = await parseExcelStatementClientSide(file, rawDate);
      state.staticDetailsCache[rawDate] = detailPayload;
      try {
        localStorage.setItem(`ml_custom_detail_${rawDate}`, JSON.stringify(detailPayload));
        const customList = JSON.parse(localStorage.getItem('ml_custom_stmts_v1') || '[]').filter(s => s.raw_date !== rawDate);
        customList.unshift(stmtSummary);
        localStorage.setItem('ml_custom_stmts_v1', JSON.stringify(customList));
      } catch (storageErr) {
        console.warn('Almacenamiento local lleno, manteniendo en sesión:', storageErr);
      }
      state.statements = [stmtSummary, ...state.statements.filter(s => s.raw_date !== rawDate)];
      state.statements.sort((a, b) => b.raw_date.localeCompare(a.raw_date));
      showToast(`✅ Statement ${rawDate} procesado en navegador con éxito`);
      await loadStatementsList(rawDate);
    } catch (err) {
      alert('Error al leer el archivo Excel: ' + err.message);
    }
  }
}

async function syncOneDriveFolder() {
  if (!state.isStaticMode) {
    showToast('🔄 Sincronizando archivos de la carpeta OneDrive...');
    const res = await fetch('/api/statements/sync', { method: 'POST' });
    const data = await res.json();
    showToast(`✅ Carpeta sincronizada (${data.statements.length} Statements disponibles)`);
    await loadStatementsList(state.activeRawDate);
  } else {
    showToast('✅ Datos sincronizados en la Aplicación Web Estática');
    await loadStatementsList(state.activeRawDate);
  }
}

async function deleteCurrentStatement() {
  if (!state.activeRawDate) return;
  const curr = state.statements.find(s => s.raw_date === state.activeRawDate);
  const name = curr ? curr.filename : state.activeRawDate;

  if (!confirm(`¿Estás seguro de que deseas borrar el Statement "${name}" (${state.activeRawDate})?`)) {
    return;
  }

  showToast(`⏳ Eliminando Statement ${state.activeRawDate}...`);

  if (!state.isStaticMode) {
    try {
      const res = await fetch(`/api/statements/${encodeURIComponent(state.activeRawDate)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.detail || 'Error al eliminar el Statement');
        return;
      }
      showToast(`🗑️ ${data.message || 'Statement eliminado correctamente'}`);
      // Seleccionar el siguiente disponible
      state.statements = state.statements.filter(s => s.raw_date !== state.activeRawDate);
      state.activeRawDate = state.statements[0]?.raw_date || null;
      await loadStatementsList(state.activeRawDate);
    } catch (err) {
      alert('Error al eliminar: ' + err.message);
    }
  } else {
    // Modo estático (Azure Static Web App / LocalStorage)
    const raw = state.activeRawDate;
    try {
      localStorage.removeItem(`ml_custom_detail_${raw}`);
      const customList = JSON.parse(localStorage.getItem('ml_custom_stmts_v1') || '[]').filter(s => s.raw_date !== raw);
      localStorage.setItem('ml_custom_stmts_v1', JSON.stringify(customList));
    } catch (e) {
      console.warn(e);
    }

    delete state.staticDetailsCache[raw];
    state.statements = state.statements.filter(s => s.raw_date !== raw);
    state.activeRawDate = state.statements[0]?.raw_date || null;
    showToast(`🗑️ Statement ${raw} eliminado de la sesión actual`);
    await loadStatementsList(state.activeRawDate);
  }
}

// ================= TAB NAVIGATION =================
function switchTab(tabName) {
  state.activeTab = tabName;
  ['dashboard', 'auditoria', 'master', 'accounting', 'clientes'].forEach(t => {
    const view = document.getElementById(`view-${t}`);
    const topBtn = document.getElementById(`tab-${t}`);
    const railBtn = document.getElementById(`rail-${t}`);
    if (view) view.style.display = t === tabName ? 'grid' : 'none';
    if (topBtn) topBtn.classList.toggle('active', t === tabName);
    if (railBtn) railBtn.classList.toggle('active', t === tabName);
  });
}

window.addEventListener('DOMContentLoaded', initApp);
