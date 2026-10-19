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
};

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
  const res = await fetch('/api/statements');
  const data = await res.json();
  state.statements = data.statements || [];

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

async function refreshActiveStatementData() {
  if (!state.activeRawDate) return;

  const qComp = state.compareRawDate ? `?compare_to=${encodeURIComponent(state.compareRawDate)}` : '';
  const [diffRes, detailRes, concRes] = await Promise.all([
    fetch(`/api/statements/${state.activeRawDate}/diff${qComp}`),
    fetch(`/api/statements/${state.activeRawDate}`),
    fetch(`/api/concentrado/overview?raw_date=${encodeURIComponent(state.activeRawDate)}`),
  ]);

  state.currentDiff = await diffRes.json();
  state.currentDetail = await detailRes.json();
  state.concentrado = await concRes.json();

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

  document.getElementById('dash-new-shipments-title').textContent =
    `🚢 Nuevos Embarques Agregados en este Statement (${diff.new_shipments.length})`;

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
    alertCards.push(`
      <div class="alert-item" onclick="openRefHistory('${esc(c.ref_no)}')">
        <div class="alert-item-icon">${isRev ? '✅' : '⚠️'}</div>
        <div style="flex:1; min-width:0;">
          <div class="alert-item-title">${esc(c.ref_no)} · ${esc(c.customer_for)}</div>
          <div class="alert-item-desc">
            ${c.diffs.map(d => `${esc(d.label)}: ${fmtMoney(d.old)} → <strong>${fmtMoney(d.new)}</strong>`).join(' | ')}
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
  const chips = c.diffs
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

async function loadMasterList() {
  if (!state.activeRawDate) return;
  const search = document.getElementById('master-search').value.trim();
  const cust = document.getElementById('master-customer-filter').value;
  const extraOnly = document.getElementById('master-extra-only').checked;

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (cust) params.set('customer_for', cust);
  if (extraOnly) params.set('only_extra_charges', 'true');

  const res = await fetch(`/api/statements/${state.activeRawDate}?${params.toString()}`);
  const data = await res.json();
  renderMasterTable(data.master_items || []);
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
      <tr style="${isChanged ? 'background:#FFF9E6;' : ''}">
        <td style="color:var(--text-muted);">${item.row_num}</td>
        <td style="white-space:nowrap;">
          <span class="ref-link" onclick="openRefHistory('${esc(item.ref_no)}')">${esc(item.ref_no)}</span>
          ${isChanged ? '<span class="status-pill" style="margin-left:4px; padding:2px 6px; font-size:10px;">Mod</span>' : ''}
          ${isNew ? '<span class="status-pill new-item" style="margin-left:4px; padding:2px 6px; font-size:10px;">Nuevo</span>' : ''}
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
async function loadConcentradoOverview() {
  if (!state.activeRawDate) return;
  const res = await fetch(`/api/concentrado/overview?raw_date=${encodeURIComponent(state.activeRawDate)}`);
  state.concentrado = await res.json();
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
            Se evalúa cada referencia en su pestaña correspondiente considerando Previo en <strong>$180</strong> ($200 en JAZ), Seguro en <strong>$100</strong> y tarifas de Tren (Rail $1,700 / $1,850).
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
            Cuando subas el próximo Statement semanal con referencias nuevas, aparecerán aquí listas para insertarse automáticamente en su pestaña respectiva.
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
            El sistema asigna automáticamente la pestaña destino según <code>CUSTOMER FOR</code>, <code>CUSTOMER</code> y prefijo de referencia, con Previo en $180 y Rail en $1,700.
          </p>
        </div>
        <button class="btn-gold" onclick="insertAllMissingToConcentrado()">
          ➕ Insertar Todas (${conc.missing_in_concentrado.length}) en el Concentrado
        </button>
      </div>
      <div class="table-wrap">
        <table class="ml-table">
          <thead>
            <tr>
              <th>Pestaña Destino</th>
              <th>REF / INV NO</th>
              <th>Customer</th>
              <th>Customer For</th>
              <th>Container</th>
              <th>Total Cost Sugerido</th>
              <th>Rail Sugerido</th>
              <th>Previo ($180) + Seg ($100)</th>
              <th>EXW / Amend</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            ${conc.missing_in_concentrado.map((m, idx) => `
              <tr>
                <td><span class="status-pill">${esc(m.target_sheet)}</span></td>
                <td><strong>${esc(m.ref_no)}</strong></td>
                <td>${esc(m.customer)}</td>
                <td>${esc(m.customer_for)}</td>
                <td><code>${esc(m.container)}</code></td>
                <td><strong>${fmtMoney(m.suggested_total_cost)}</strong></td>
                <td>${fmtMoney(m.suggested_rail)}</td>
                <td>${fmtMoney(m.suggested_previo + m.suggested_insurance)}</td>
                <td>${fmtMoney(m.suggested_exw_amend)}</td>
                <td>
                  <button class="btn-gold" style="padding:5px 10px; font-size:11.5px;" onclick="insertSingleMissingToConcentrado(${idx})">
                    ➕ Insertar en ${esc(m.target_sheet)}
                  </button>
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

async function sendConcentradoActions(actions, successMsg) {
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
}

function downloadConcentradoFile() {
  window.location.href = '/api/concentrado/download';
  showToast('⬇️ Descargando CONCENTRADO ML LOGISTICS ELIEZER 2026.xlsx...');
}

// ================= REVIEW / APPROVAL ACTIONS =================
async function toggleReviewItem(changeKey, changeType, refNo, newStatus) {
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

  await fetch('/api/reviews/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
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

  const res = await fetch(`/api/references/${encodeURIComponent(refNo)}/history`);
  const data = await res.json();
  const hist = data.history || [];

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

async function uploadStatementFile(file) {
  let customDate = null;
  if (!/(202\d{5})/.test(file.name)) {
    customDate = prompt(
      `El archivo "${file.name}" no incluye la fecha en el nombre. Ingresa la fecha del Statement en formato AAAAMMDD (ejemplo: 20261021):`,
      new Date().toISOString().slice(0, 10).replace(/-/g, '')
    );
    if (!customDate) return;
  }

  showToast(`⏳ Procesando y guardando "${file.name}"...`);
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
}

async function syncOneDriveFolder() {
  showToast('🔄 Sincronizando archivos de la carpeta OneDrive...');
  const res = await fetch('/api/statements/sync', { method: 'POST' });
  const data = await res.json();
  showToast(`✅ Carpeta sincronizada (${data.statements.length} Statements disponibles)`);
  await loadStatementsList(state.activeRawDate);
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
