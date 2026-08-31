/* MoonAPI 控制台前端逻辑（原生 JS，无依赖） */
'use strict';

const API_BASE = '/api/admin';
const TOKEN_KEY = 'moonapi_admin_token';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  cards: [],
  selected: new Set(),
  filter: '',
};

/* ---------- 基础工具 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function todayCN() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function toast(message, type = 'success') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板');
  } catch {
    toast('复制失败，请手动选择复制', 'error');
  }
}

/* ---------- API 封装 ---------- */
async function api(path, method = 'GET', body) {
  const headers = {};
  if (state.token) headers['authorization'] = `Bearer ${state.token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('网络错误，无法连接服务端');
  }
  let payload = {};
  try { payload = await res.json(); } catch {}
  if (!res.ok || payload.code !== 0) {
    const err = new Error(payload.message || `请求失败（${res.status}）`);
    err.status = res.status;
    err.code = payload.code;
    throw err;
  }
  return payload;
}

/* ---------- 模态框 ---------- */
function openModal({ title, bodyHTML, wide = false, submitLabel = '确认', onSubmit, hideFooter = false }) {
  closeModal();
  const root = $('#modal-root');
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h3>${esc(title)}</h3></div>
      <form id="modal-form">
        <div class="modal-body">${bodyHTML}</div>
        ${hideFooter ? '' : `<div class="modal-foot">
          <button type="button" class="btn" id="modal-cancel">取消</button>
          <button type="submit" class="btn btn-primary" id="modal-submit">${esc(submitLabel)}</button>
        </div>`}
      </form>
    </div>`;
  root.appendChild(mask);
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) closeModal(); });
  $('#modal-cancel', mask)?.addEventListener('click', closeModal);
  $('#modal-form', mask).addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return closeModal();
    const btn = $('#modal-submit', mask);
    btn.disabled = true;
    try {
      await onSubmit(mask);
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
  const firstInput = $('input, textarea, select', mask);
  firstInput?.focus();
  return mask;
}

function closeModal() {
  $('#modal-root').innerHTML = '';
}

function confirmModal(message, onOk, okLabel = '确认删除') {
  openModal({
    title: '请确认',
    bodyHTML: `<p style="line-height:1.7">${message}</p>`,
    submitLabel: okLabel,
    onSubmit: async () => { await onOk(); closeModal(); },
  });
}

/* ---------- 认证流程 ---------- */
let authMode = 'login';

async function boot() {
  $('#topbar-date').textContent = `北京时间 ${todayCN()}`;
  if (!state.token) return showAuthScreen();
  try {
    await api('/login', 'POST', {});
    enterApp();
  } catch (err) {
    if (err.code === 50301) {
      state.token = '';
      localStorage.removeItem(TOKEN_KEY);
      showAuthScreen(true);
    } else if (err.status === 401) {
      state.token = '';
      localStorage.removeItem(TOKEN_KEY);
      showAuthScreen();
    } else {
      showAuthScreen();
      toast(err.message, 'error');
    }
  }
}

function showAuthScreen(setupMode = false) {
  authMode = setupMode ? 'setup' : 'login';
  $('#app-screen').hidden = true;
  $('#auth-screen').hidden = false;
  $('#auth-label').textContent = setupMode ? '设置管理员令牌（首次初始化）' : '管理员令牌';
  $('#auth-submit').textContent = setupMode ? '初始化并进入控制台' : '登 录';
  $('#auth-hint').textContent = setupMode
    ? '检测到管理员尚未初始化。请设置一个不少于 8 位的令牌，初始化后只保存哈希值，请牢记令牌本身。'
    : '首次使用？若管理员尚未初始化，本页会自动切换为初始化模式。';
  $('#auth-token').value = '';
}

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = $('#auth-token').value.trim();
  if (token.length < 8) return toast('令牌至少 8 个字符', 'error');
  const btn = $('#auth-submit');
  btn.disabled = true;
  try {
    if (authMode === 'setup') {
      let payload = {};
      try {
        const res = await fetch(`${API_BASE}/setup`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        payload = await res.json().catch(() => ({}));
        if (payload.code === 40901) {
          toast('管理员已初始化，请直接登录');
          showAuthScreen(false);
          $('#auth-token').value = token;
          return;
        }
        if (!res.ok || payload.code !== 0) throw new Error(payload.message || '初始化失败');
      } catch (err) {
        if (err instanceof TypeError) throw new Error('网络错误，无法连接服务端');
        throw err;
      }
      state.token = token;
      localStorage.setItem(TOKEN_KEY, token);
      toast('管理员初始化成功，已进入控制台');
      enterApp();
      return;
    }

    state.token = token;
    localStorage.setItem(TOKEN_KEY, token);
    await api('/login', 'POST', {});
    enterApp();
  } catch (err) {
    if (authMode === 'login' && err.code === 50301) {
      state.token = '';
      localStorage.removeItem(TOKEN_KEY);
      showAuthScreen(true);
      $('#auth-token').value = token;
      return;
    }
    if (err.code === 40102 || err.status === 401) {
      state.token = '';
      localStorage.removeItem(TOKEN_KEY);
      toast('管理员令牌错误', 'error');
    } else {
      toast(err.message, 'error');
    }
  } finally {
    btn.disabled = false;
  }
});

function enterApp() {
  $('#auth-screen').hidden = true;
  $('#app-screen').hidden = false;
  if (!location.hash || location.hash === '#/') location.hash = '#/cards';
  route();
  refreshStats();
}

$('#logout-btn').addEventListener('click', () => {
  state.token = '';
  localStorage.removeItem(TOKEN_KEY);
  showAuthScreen();
});

/* ---------- 路由 ---------- */
const VIEWS = {
  stats: { title: '数据概览', desc: '服务运行状态与近 7 天调用量统计', render: renderStats },
  cards: { title: '知识卡片', desc: '管理每日知识卡片库：新增、批量导入、编辑与删除', render: renderCards },
  daily: { title: '每日排期', desc: '指定某一天固定返回某张卡片，未排期的日子自动轮换', render: renderDaily },
  proxy: { title: '代理服务', desc: '配置第三方接口转发（如 api.yujin.cn），无需重新部署即可增删上游', render: renderProxy },
  media: { title: '媒体库', desc: '上传文件到 R2，通过 /api/v1/media/{id} 对外分发', render: renderMedia },
  keys: { title: 'API 密钥', desc: '创建与吊销对外接口的访问密钥，可设置每日配额', render: renderKeys },
};

function route() {
  const name = (location.hash.replace('#/', '') || 'cards').split('?')[0];
  const view = VIEWS[name] ? name : 'cards';
  $('#view-title').textContent = VIEWS[view].title;
  $('#view-desc').textContent = VIEWS[view].desc;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === view));
  VIEWS[view].render();
}

window.addEventListener('hashchange', route);

async function refreshStats() {
  try {
    const [cards, keys] = await Promise.all([api('/cards'), api('/keys')]);
    state.cards = cards.data.cards;
    $('#stat-cards').textContent = `卡片 ${cards.data.total} 张`;
    $('#stat-keys').textContent = `密钥 ${keys.data.total} 个`;
  } catch {}
}

/* ---------- 视图：知识卡片 ---------- */
async function renderCards() {
  const view = $('#view');
  view.innerHTML = `
    <div class="card-panel">
      <div class="panel-head">
        <button class="btn btn-gold" id="btn-add">＋ 新增卡片</button>
        <button class="btn" id="btn-import">批量导入</button>
        <button class="btn btn-danger" id="btn-batch-del" disabled>批量删除</button>
        <div class="spacer"></div>
        <input class="search-input" id="card-search" placeholder="搜索标题 / 分类…" value="${esc(state.filter)}">
      </div>
      <div id="cards-table-wrap"></div>
    </div>`;

  $('#btn-add').addEventListener('click', () => cardFormModal());
  $('#btn-import').addEventListener('click', importModal);
  $('#btn-batch-del').addEventListener('click', batchDelete);
  $('#card-search').addEventListener('input', (e) => { state.filter = e.target.value; drawCardsTable(); });

  await loadCards();
}

async function loadCards() {
  const wrap = $('#cards-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<table class="data"><tbody><tr class="loading-row"><td>加载中…</td></tr></tbody></table>';
  try {
    const res = await api('/cards');
    state.cards = res.data.cards;
    state.selected.clear();
    drawCardsTable();
    $('#stat-cards').textContent = `卡片 ${res.data.total} 张`;
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state"><span class="empty-ico">⚠</span><p>${esc(err.message)}</p></div>`;
  }
}

function drawCardsTable() {
  const wrap = $('#cards-table-wrap');
  if (!wrap) return;
  const kw = state.filter.trim().toLowerCase();
  const rows = state.cards.filter((c) =>
    !kw || c.title.toLowerCase().includes(kw) || (c.category || '').toLowerCase().includes(kw));

  if (rows.length === 0) {
    wrap.innerHTML = `<div class="empty-state">
      <span class="empty-ico">☾</span>
      <p>${state.cards.length === 0 ? '卡片库还是空的。新增第一张卡片，或一键导入示例数据包。' : '没有匹配的卡片。'}</p>
      ${state.cards.length === 0 ? '<button class="btn btn-gold" id="btn-empty-import">导入示例数据包</button>' : ''}
    </div>`;
    $('#btn-empty-import')?.addEventListener('click', () => importModal(true));
    updateBatchBtn();
    return;
  }

  wrap.innerHTML = `
    <table class="data">
      <thead><tr>
        <th style="width:36px"><input type="checkbox" id="check-all" aria-label="全选"></th>
        <th>标题</th><th>分类</th><th>更新时间</th><th style="text-align:right">操作</th>
      </tr></thead>
      <tbody>
        ${rows.map((c) => `
          <tr data-id="${esc(c.id)}" class="${state.selected.has(c.id) ? 'selected' : ''}">
            <td><input type="checkbox" class="row-check" ${state.selected.has(c.id) ? 'checked' : ''} aria-label="选择 ${esc(c.title)}"></td>
            <td class="td-title" title="${esc(c.title)}">${esc(c.title)}</td>
            <td><span class="tag">${esc(c.category || '未分类')}</span></td>
            <td class="td-muted">${fmtTime(c.updatedAt)}</td>
            <td class="td-actions">
              <button class="btn btn-sm act-pin" title="设为今日卡片">置顶今日</button>
              <button class="btn btn-sm act-edit">编辑</button>
              <button class="btn btn-sm btn-danger act-del">删除</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  $('#check-all').addEventListener('change', (e) => {
    rows.forEach((c) => e.target.checked ? state.selected.add(c.id) : state.selected.delete(c.id));
    drawCardsTable();
  });
  $$('.row-check', wrap).forEach((cb) => cb.addEventListener('change', (e) => {
    const id = e.target.closest('tr').dataset.id;
    e.target.checked ? state.selected.add(id) : state.selected.delete(id);
    e.target.closest('tr').classList.toggle('selected', e.target.checked);
    updateBatchBtn();
  }));
  $$('.act-edit', wrap).forEach((b) => b.addEventListener('click', async (e) => {
    const id = e.target.closest('tr').dataset.id;
    cardFormModal(id);
  }));
  $$('.act-del', wrap).forEach((b) => b.addEventListener('click', (e) => {
    const id = e.target.closest('tr').dataset.id;
    const card = state.cards.find((c) => c.id === id);
    confirmModal(`确定删除卡片「${esc(card?.title || id)}」吗？删除后不可恢复。`, async () => {
      await api(`/cards/${encodeURIComponent(id)}`, 'DELETE');
      toast('已删除');
      await loadCards();
    });
  }));
  $$('.act-pin', wrap).forEach((b) => b.addEventListener('click', async (e) => {
    const id = e.target.closest('tr').dataset.id;
    try {
      await api('/daily', 'POST', { date: todayCN(), cardId: id });
      toast('已设为今日卡片');
    } catch (err) { toast(err.message, 'error'); }
  }));
  updateBatchBtn();
}

function updateBatchBtn() {
  const btn = $('#btn-batch-del');
  if (btn) {
    btn.disabled = state.selected.size === 0;
    btn.textContent = state.selected.size > 0 ? `批量删除（${state.selected.size}）` : '批量删除';
  }
}

async function batchDelete() {
  const ids = [...state.selected];
  if (ids.length === 0) return;
  confirmModal(`确定删除选中的 ${ids.length} 张卡片吗？删除后不可恢复。`, async () => {
    await api('/cards/batch-delete', 'POST', { ids });
    toast(`已删除 ${ids.length} 张卡片`);
    await loadCards();
  });
}

async function cardFormModal(editId) {
  let card = { title: '', category: '', content: '', source: '', tags: [] };
  if (editId) {
    try {
      const res = await api(`/cards/${encodeURIComponent(editId)}`);
      card = res.data;
    } catch (err) {
      return toast(err.message, 'error');
    }
  }
  openModal({
    title: editId ? '编辑卡片' : '新增卡片',
    wide: true,
    submitLabel: editId ? '保存修改' : '保存卡片',
    bodyHTML: `
      <div class="field"><label for="f-title">标题 *</label>
        <input id="f-title" maxlength="120" required value="${esc(card.title)}" placeholder="一句话概括这条知识"></div>
      <div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label for="f-category">分类</label>
          <input id="f-category" maxlength="40" value="${esc(card.category)}" placeholder="如：科学 / 文史 / 技术"></div>
        <div><label for="f-source">来源</label>
          <input id="f-source" maxlength="200" value="${esc(card.source)}" placeholder="可选"></div>
      </div>
      <div class="field"><label for="f-content">内容 *</label>
        <textarea id="f-content" required maxlength="5000" placeholder="卡片的正文内容…">${esc(card.content)}</textarea></div>
      <div class="field"><label for="f-tags">标签（逗号分隔）</label>
        <input id="f-tags" value="${esc((card.tags || []).join(', '))}" placeholder="可选，如：天文, 冷知识"></div>`,
    onSubmit: async (mask) => {
      const payload = {
        title: $('#f-title', mask).value.trim(),
        category: $('#f-category', mask).value.trim(),
        source: $('#f-source', mask).value.trim(),
        content: $('#f-content', mask).value.trim(),
        tags: $('#f-tags', mask).value.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      };
      if (!payload.title || !payload.content) throw new Error('标题和内容不能为空');
      if (editId) {
        await api(`/cards/${encodeURIComponent(editId)}`, 'PUT', payload);
        toast('已保存修改');
      } else {
        await api('/cards', 'POST', payload);
        toast('卡片已添加');
      }
      closeModal();
      await loadCards();
    },
  });
}

async function importModal(loadSeedImmediately = false) {
  openModal({
    title: '批量导入卡片',
    wide: true,
    submitLabel: '开始导入',
    bodyHTML: `
      <div class="notice">支持两种 JSON 格式：数组 <span class="mono">[{title, content, ...}]</span>
      或对象 <span class="mono">{"cards":[...]}</span>。每条必须包含 title 与 content，单次最多 500 条。</div>
      <div class="field">
        <label for="f-json">JSON 数据</label>
        <textarea id="f-json" class="mono" style="min-height:220px" placeholder='[{"title":"…","category":"…","content":"…"}]'></textarea>
        <div class="hint">
          <button type="button" class="btn btn-sm" id="btn-load-seed">加载示例数据包</button>
          <button type="button" class="btn btn-sm" id="btn-clear-json" style="margin-left:6px">清空</button>
        </div>
      </div>`,
    onSubmit: async (mask) => {
      const raw = $('#f-json', mask).value.trim();
      if (!raw) throw new Error('请先粘贴 JSON 数据');
      let parsed;
      try { parsed = JSON.parse(raw); } catch { throw new Error('JSON 格式不合法，请检查引号与逗号'); }
      const cards = Array.isArray(parsed) ? parsed : parsed?.cards;
      if (!Array.isArray(cards) || cards.length === 0) throw new Error('未解析到卡片数组');
      const res = await api('/cards', 'POST', { cards });
      toast(`导入完成：成功 ${res.data.created} 条${res.data.skipped ? `，跳过 ${res.data.skipped} 条` : ''}`);
      closeModal();
      await loadCards();
    },
  });
  $('#btn-clear-json').addEventListener('click', () => { $('#f-json').value = ''; });
  const loadSeed = async () => {
    try {
      const res = await fetch('/data/seed-cards.json');
      const data = await res.json();
      $('#f-json').value = JSON.stringify(Array.isArray(data) ? data : data.cards, null, 2);
      toast('示例数据包已加载，点击「开始导入」完成导入');
    } catch {
      toast('示例数据包加载失败', 'error');
    }
  };
  $('#btn-load-seed').addEventListener('click', loadSeed);
  if (loadSeedImmediately) loadSeed();
}

/* ---------- 视图：每日排期 ---------- */
async function renderDaily() {
  const view = $('#view');
  view.innerHTML = `
    <div class="card-panel" style="margin-bottom:18px">
      <div class="panel-head"><strong>设置排期</strong></div>
      <div style="padding:18px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0"><label for="pin-date">日期</label>
          <input type="date" id="pin-date" value="${todayCN()}"></div>
        <div class="field" style="margin:0;flex:1;min-width:220px"><label for="pin-card">卡片</label>
          <select id="pin-card"></select></div>
        <button class="btn btn-gold" id="pin-save">保存排期</button>
        <button class="btn" id="pin-clear">清除该日排期</button>
      </div>
    </div>
    <div class="card-panel">
      <div class="panel-head"><strong>已有排期</strong></div>
      <div id="pins-wrap"></div>
    </div>`;

  if (state.cards.length === 0) await refreshStats();
  const select = $('#pin-card');
  select.innerHTML = state.cards.length
    ? state.cards.map((c) => `<option value="${esc(c.id)}">${esc(c.title)}（${esc(c.category || '未分类')}）</option>`).join('')
    : '<option value="">卡片库为空，请先到「知识卡片」添加</option>';

  $('#pin-save').addEventListener('click', async () => {
    const date = $('#pin-date').value;
    const cardId = select.value;
    if (!date) return toast('请选择日期', 'error');
    if (!cardId) return toast('请先在「知识卡片」中添加卡片', 'error');
    try {
      await api('/daily', 'POST', { date, cardId });
      toast(`${date} 的排期已保存`);
      loadPins();
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#pin-clear').addEventListener('click', async () => {
    const date = $('#pin-date').value;
    if (!date) return toast('请选择日期', 'error');
    try {
      await api('/daily', 'POST', { date, cardId: null });
      toast(`${date} 的排期已清除`);
      loadPins();
    } catch (err) { toast(err.message, 'error'); }
  });

  loadPins();
}

async function loadPins() {
  const wrap = $('#pins-wrap');
  if (!wrap) return;
  try {
    const res = await api('/daily');
    const pins = res.data.pins;
    if (pins.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><span class="empty-ico">☀</span>
        <p>暂无排期。未排期的日子会按日期自动轮换卡片。</p></div>`;
      return;
    }
    const titleOf = (id) => state.cards.find((c) => c.id === id)?.title || `(卡片 ${String(id).slice(0, 8)}…)`;
    wrap.innerHTML = `
      <table class="data">
        <thead><tr><th>日期</th><th>置顶卡片</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
        <tbody>
          ${pins.map((p) => `
            <tr>
              <td class="mono">${esc(p.date)}</td>
              <td class="td-title" title="${esc(titleOf(p.cardId))}">${esc(titleOf(p.cardId))}</td>
              <td>${p.date === todayCN() ? '<span class="tag tag-pin">今日生效</span>' : (p.date > todayCN() ? '<span class="tag">待生效</span>' : '<span class="td-muted">已过期</span>')}</td>
              <td class="td-actions"><button class="btn btn-sm btn-danger pin-del" data-date="${esc(p.date)}">清除</button></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    $$('.pin-del', wrap).forEach((b) => b.addEventListener('click', async (e) => {
      const date = e.target.dataset.date;
      try {
        await api('/daily', 'POST', { date, cardId: null });
        toast('排期已清除');
        loadPins();
      } catch (err) { toast(err.message, 'error'); }
    }));
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`;
  }
}

/* ---------- 视图：数据概览 ---------- */
async function renderStats() {
  const view = $('#view');
  view.innerHTML = '<div class="card-panel"><div class="empty-state"><p>加载中…</p></div></div>';
  try {
    const res = await api('/stats?days=7');
    const { summary, usage } = res.data;
    const tiles = [
      ['今日调用', summary.callsToday],
      ['近 7 天调用', summary.callsLast7Days],
      ['知识卡片', summary.cards],
      ['API 密钥', summary.keys],
      ['代理服务', summary.proxyServices],
    ];
    const topEndpoints = Object.entries(usage[0]?.byEndpoint || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
    view.innerHTML = `
      <div class="stat-grid">
        ${tiles.map(([label, value]) => `
          <div class="stat-tile"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`).join('')}
      </div>
      <div class="card-panel" style="margin-top:18px">
        <div class="panel-head"><strong>近 7 天调用趋势</strong></div>
        <table class="data">
          <thead><tr><th>日期</th><th>调用总量</th><th>独立密钥数</th><th>分布</th></tr></thead>
          <tbody>
            ${usage.map((d) => {
              const max = Math.max(...usage.map((x) => x.total || 0), 1);
              const pct = Math.round(((d.total || 0) / max) * 100);
              return `<tr>
                <td class="mono">${esc(d.date)}${d.date === todayCN() ? ' <span class="tag tag-pin">今天</span>' : ''}</td>
                <td><strong>${d.total || 0}</strong></td>
                <td class="td-muted">${Object.keys(d.byKey || {}).length}</td>
                <td style="width:38%"><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="card-panel" style="margin-top:18px">
        <div class="panel-head"><strong>今日接口调用分布</strong></div>
        ${topEndpoints.length === 0 ? '<div class="empty-state"><span class="empty-ico">◔</span><p>今天还没有接口调用记录。</p></div>' : `
        <table class="data">
          <thead><tr><th>接口</th><th>调用次数</th></tr></thead>
          <tbody>${topEndpoints.map(([ep, n]) => `<tr><td class="mono">${esc(ep)}</td><td><strong>${n}</strong></td></tr>`).join('')}</tbody>
        </table>`}
      </div>`;
  } catch (err) {
    view.innerHTML = `<div class="card-panel"><div class="empty-state"><p>${esc(err.message)}</p></div></div>`;
  }
}

/* ---------- 视图：代理服务 ---------- */
async function renderProxy() {
  const view = $('#view');
  view.innerHTML = `
    <div class="notice">代理服务会把请求转发到你配置的上游接口，并把 JSON 结果包装成 MoonAPI 统一响应信封（二创转发）。
    所有变更保存在 R2，<strong>无需重新部署</strong>。调用方使用：<span class="mono">GET /api/v1/proxy/{slug}</span>（需 API Key）。</div>
    <div class="card-panel">
      <div class="panel-head">
        <button class="btn btn-gold" id="btn-add-proxy">＋ 新增代理服务</button>
        <div class="spacer"></div>
        <span class="td-muted">KV 缓存仅用于 JSON 响应，尊重免费额度（按服务设置缓存秒数）</span>
      </div>
      <div id="proxy-wrap"></div>
    </div>`;
  $('#btn-add-proxy').addEventListener('click', () => proxyFormModal());
  loadProxyServices();
}

async function loadProxyServices() {
  const wrap = $('#proxy-wrap');
  if (!wrap) return;
  try {
    const res = await api('/proxy');
    const services = res.data.services;
    if (services.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><span class="empty-ico">⇄</span><p>还没有代理服务，点击右上角新增。</p></div>';
      return;
    }
    wrap.innerHTML = `
      <table class="data">
        <thead><tr><th>Slug</th><th>名称</th><th>上游地址</th><th>缓存</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
        <tbody>
          ${services.map((s) => `
            <tr>
              <td class="mono">${esc(s.slug)}</td>
              <td class="td-title" title="${esc(s.description || '')}">${esc(s.name || s.slug)}</td>
              <td class="td-muted mono" style="max-width:260px;overflow:hidden;text-overflow:ellipsis">${esc(s.url)}</td>
              <td class="td-muted">${s.cacheTtl > 0 ? `${s.cacheTtl}s` : '关闭'}</td>
              <td>${s.enabled === false ? '<span class="td-muted">已停用</span>' : '<span class="tag tag-pin">运行中</span>'}</td>
              <td class="td-actions">
                <button class="btn btn-sm proxy-test" data-slug="${esc(s.slug)}">测试</button>
                <button class="btn btn-sm proxy-edit" data-slug="${esc(s.slug)}">编辑</button>
                <button class="btn btn-sm btn-danger proxy-del" data-slug="${esc(s.slug)}">删除</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    $$('.proxy-test', wrap).forEach((b) => b.addEventListener('click', async (e) => {
      const slug = e.target.dataset.slug;
      try {
        const res = await fetch(`/api/v1/proxy/${encodeURIComponent(slug)}`, {
          headers: { authorization: `Bearer ${state.token}` },
        });
        const payload = await res.json().catch(() => ({}));
        openModal({
          title: `测试：${slug}`,
          wide: true,
          hideFooter: true,
          bodyHTML: `
            <p class="td-muted" style="margin-bottom:10px">HTTP ${res.status} ｜ code=${payload.code ?? '—'} ｜ ${esc(payload.message || '')}</p>
            <pre class="key-reveal" style="max-height:380px;overflow:auto">${esc(JSON.stringify(payload.data ?? payload, null, 2))}</pre>
            <div style="margin-top:12px"><button class="btn" id="close-test">关闭</button></div>`,
        });
        $('#close-test').addEventListener('click', closeModal);
      } catch (err) {
        toast(err.message, 'error');
      }
    }));
    $$('.proxy-edit', wrap).forEach((b) => b.addEventListener('click', async (e) => {
      const slug = e.target.dataset.slug;
      const svc = services.find((s) => s.slug === slug);
      if (svc) proxyFormModal(svc);
    }));
    $$('.proxy-del', wrap).forEach((b) => b.addEventListener('click', (e) => {
      const slug = e.target.dataset.slug;
      confirmModal(`确定删除代理服务「${esc(slug)}」吗？`, async () => {
        await api('/proxy', 'POST', { action: 'delete', slug });
        toast('代理服务已删除');
        loadProxyServices();
      });
    }));
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`;
  }
}

function proxyFormModal(service) {
  const editing = !!service;
  openModal({
    title: editing ? `编辑代理服务：${service.slug}` : '新增代理服务',
    wide: true,
    submitLabel: '保存',
    bodyHTML: `
      <div class="field" style="display:grid;grid-template-columns:1fr 2fr;gap:12px">
        <div><label for="p-slug">Slug（路由标识）</label>
          <input id="p-slug" ${editing ? 'disabled' : ''} required pattern="[a-z0-9][a-z0-9-]{0,63}" value="${esc(service?.slug || '')}" placeholder="如 yujin-wenan"></div>
        <div><label for="p-name">名称</label>
          <input id="p-name" maxlength="80" value="${esc(service?.name || '')}" placeholder="如 雨瑾云 · 随机文案"></div>
      </div>
      <div class="field"><label for="p-url">上游地址（必须 https）</label>
        <input id="p-url" class="mono" required value="${esc(service?.url || 'https://api.yujin.cn/')}" placeholder="https://api.yujin.cn/xxx"></div>
      <div class="field" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div><label for="p-method">方法</label>
          <select id="p-method">
            <option value="GET" ${service?.method !== 'POST' ? 'selected' : ''}>GET</option>
            <option value="POST" ${service?.method === 'POST' ? 'selected' : ''}>POST</option>
          </select></div>
        <div><label for="p-cache">KV 缓存秒数（0=关闭）</label>
          <input id="p-cache" type="number" min="0" max="86400" value="${service?.cacheTtl ?? 0}"></div>
        <div><label for="p-timeout">上游超时（毫秒）</label>
          <input id="p-timeout" type="number" min="1000" max="20000" step="500" value="${service?.timeoutMs ?? 8000}"></div>
      </div>
      <div class="field"><label for="p-desc">描述</label>
        <input id="p-desc" maxlength="300" value="${esc(service?.description || '')}" placeholder="可选"></div>
      <div class="field"><label style="display:flex;align-items:center;gap:8px">
        <input id="p-enabled" type="checkbox" style="width:auto" ${service?.enabled !== false ? 'checked' : ''}> 启用该代理服务</label></div>`,
    onSubmit: async (mask) => {
      const payload = {
        slug: $('#p-slug', mask).value.trim(),
        name: $('#p-name', mask).value.trim(),
        url: $('#p-url', mask).value.trim(),
        method: $('#p-method', mask).value,
        cacheTtl: Number($('#p-cache', mask).value) || 0,
        timeoutMs: Number($('#p-timeout', mask).value) || 8000,
        description: $('#p-desc', mask).value.trim(),
        enabled: $('#p-enabled', mask).checked,
      };
      await api('/proxy', 'POST', payload);
      toast('代理服务已保存');
      closeModal();
      loadProxyServices();
    },
  });
}

/* ---------- 视图：媒体库 ---------- */
async function renderMedia() {
  const view = $('#view');
  view.innerHTML = `
    <div class="card-panel">
      <div class="panel-head">
        <input type="file" id="media-file" style="display:none" multiple>
        <button class="btn btn-gold" id="btn-upload">＋ 上传文件（≤5MB）</button>
        <div class="spacer"></div>
        <span class="td-muted">存储于 R2（免费额度 10GB），经 Functions 分发，可防盗链</span>
      </div>
      <div id="media-wrap"></div>
    </div>`;
  $('#btn-upload').addEventListener('click', () => $('#media-file').click());
  $('#media-file').addEventListener('change', uploadMediaFiles);
  loadMedia();
}

async function uploadMediaFiles(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  for (const file of files) {
    if (file.size > 5 * 1024 * 1024) {
      toast(`「${file.name}」超过 5MB，已跳过`, 'error');
      continue;
    }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api('/media', 'POST', {
        name: file.name,
        contentType: file.type || 'application/octet-stream',
        base64: String(dataUrl).split(',')[1],
      });
      toast(`「${file.name}」上传成功`);
    } catch (err) {
      toast(`「${file.name}」上传失败：${err.message}`, 'error');
    }
  }
  loadMedia();
}

async function loadMedia() {
  const wrap = $('#media-wrap');
  if (!wrap) return;
  try {
    const res = await api('/media');
    const files = res.data.files;
    if (files.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><span class="empty-ico">▣</span><p>媒体库为空。上传图片或文件后即可获得分发链接。</p></div>';
      return;
    }
    const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
    wrap.innerHTML = `
      <table class="data">
        <thead><tr><th>预览</th><th>文件名</th><th>类型</th><th>大小</th><th>上传时间</th><th style="text-align:right">操作</th></tr></thead>
        <tbody>
          ${files.map((f) => {
            const url = `/api/v1/media/${encodeURIComponent(f.id)}`;
            const isImage = /^image\//.test(f.contentType);
            return `<tr>
              <td>${isImage ? `<img src="${url}" alt="${esc(f.name)}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;border:1px solid var(--line)">` : '<span class="td-muted">—</span>'}</td>
              <td class="td-title" title="${esc(f.name)}">${esc(f.name)}</td>
              <td class="td-muted mono">${esc(f.contentType)}</td>
              <td class="td-muted">${fmtSize(f.size)}</td>
              <td class="td-muted">${fmtTime(f.createdAt)}</td>
              <td class="td-actions">
                <button class="btn btn-sm media-copy" data-url="${esc(url)}">复制链接</button>
                <button class="btn btn-sm btn-danger media-del" data-id="${esc(f.id)}" data-name="${esc(f.name)}">删除</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
    $$('.media-copy', wrap).forEach((b) => b.addEventListener('click', (e) => copyText(location.origin + e.target.dataset.url)));
    $$('.media-del', wrap).forEach((b) => b.addEventListener('click', (e) => {
      const { id, name } = e.target.dataset;
      confirmModal(`确定删除文件「${esc(name)}」吗？`, async () => {
        await api('/media', 'POST', { action: 'delete', id });
        toast('文件已删除');
        loadMedia();
      });
    }));
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`;
  }
}

/* ---------- 视图：API 密钥 ---------- */
async function renderKeys() {
  const view = $('#view');
  view.innerHTML = `
    <div class="card-panel">
      <div class="panel-head">
        <div style="display:flex;gap:10px;align-items:center;flex:1;max-width:560px">
          <input class="search-input" id="key-name" placeholder="密钥用途备注，如：小程序端" style="flex:1">
          <input class="search-input" id="key-quota" type="number" min="0" placeholder="每日配额（0=不限）" style="width:170px">
          <button class="btn btn-gold" id="btn-create-key">＋ 创建密钥</button>
        </div>
        <div class="spacer"></div>
        <span class="td-muted">调用接口时携带 Authorization: Bearer &lt;密钥&gt;</span>
      </div>
      <div id="keys-wrap"></div>
    </div>`;
  $('#btn-create-key').addEventListener('click', createKey);
  loadKeys();
}

async function loadKeys() {
  const wrap = $('#keys-wrap');
  if (!wrap) return;
  try {
    const res = await api('/keys');
    const keys = res.data.keys;
    $('#stat-keys').textContent = `密钥 ${res.data.total} 个`;
    if (keys.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><span class="empty-ico">⚿</span>
        <p>还没有 API 密钥。创建一个后即可调用 /api/v1/daily-card。</p></div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="data">
        <thead><tr><th>密钥（脱敏）</th><th>备注</th><th>每日配额</th><th>创建时间</th><th style="text-align:right">操作</th></tr></thead>
        <tbody>
          ${keys.map((k) => `
            <tr>
              <td class="mono">${esc(k.masked || maskOf(k.key))}</td>
              <td>${esc(k.name || '—')}</td>
              <td class="td-muted">${k.dailyQuota > 0 ? `${k.dailyQuota} 次/天` : '不限'}</td>
              <td class="td-muted">${fmtTime(k.createdAt)}</td>
              <td class="td-actions">
                <button class="btn btn-sm key-copy" data-key="${esc(k.key)}">复制</button>
                <button class="btn btn-sm btn-danger key-revoke" data-key="${esc(k.key)}" data-masked="${esc(k.masked || maskOf(k.key))}">吊销</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    $$('.key-copy', wrap).forEach((b) => b.addEventListener('click', (e) => copyText(e.target.dataset.key)));
    $$('.key-revoke', wrap).forEach((b) => b.addEventListener('click', (e) => {
      const full = e.target.dataset.key;
      const masked = e.target.dataset.masked;
      confirmModal(
        `确定吊销密钥 <span class="mono">${esc(masked)}</span> 吗？吊销后所有使用它的客户端将立即失效，且无法恢复。`,
        async () => {
          try {
            await api('/keys', 'POST', { action: 'revoke', key: full });
            toast('密钥已吊销');
            loadKeys();
          } catch (err) { toast(err.message, 'error'); }
        },
        '确认吊销');
    }));
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`;
  }
}

function maskOf(key) {
  if (key.length <= 12) return key;
  return `${key.slice(0, 8)}${'•'.repeat(6)}${key.slice(-4)}`;
}

async function createKey() {
  const name = $('#key-name')?.value.trim() || '未命名应用';
  const dailyQuota = Math.max(0, Number($('#key-quota')?.value) || 0);
  try {
    const res = await api('/keys', 'POST', { name, dailyQuota });
    const fullKey = res.data.key;
    openModal({
      title: '密钥创建成功',
      hideFooter: true,
      bodyHTML: `
        <div class="notice" style="background:#faeeec;border-color:#e5c2be;color:#7a2d25">
          完整密钥只显示这一次，请立即复制保存。</div>
        <div class="key-reveal" id="new-key">${esc(fullKey)}</div>
        <div style="margin-top:14px;display:flex;gap:10px">
          <button class="btn btn-gold" id="copy-new-key">复制密钥</button>
          <button class="btn" id="done-new-key">我已保存，关闭</button>
        </div>`,
    });
    $('#copy-new-key').addEventListener('click', () => copyText(fullKey));
    $('#done-new-key').addEventListener('click', () => { closeModal(); loadKeys(); });
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------- 启动 ---------- */
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
boot();
