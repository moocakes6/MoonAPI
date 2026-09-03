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
  playground: { title: '试调用', desc: '在线发起真实调用：可视化调用过程、服务端阶段计时与调用明细记录', render: renderPlayground },
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
          <button type="button" class="btn btn-sm" id="btn-load-library" style="margin-left:6px">一键导入内置资料库（342 条）</button>
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
  $('#btn-load-library').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    try {
      const res = await fetch('/data/seed-library.json');
      const data = await res.json();
      const cards = Array.isArray(data) ? data : data.cards;
      const r = await api('/cards', 'POST', { cards });
      toast(`内置资料库导入完成：成功 ${r.data.created} 条`);
      closeModal();
      await loadCards();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
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
        const text = await res.text();
        let pretty = text;
        try {
          const parsed = JSON.parse(text);
          pretty = JSON.stringify(parsed, null, 2);
        } catch {}
        if (pretty.length > 6000) pretty = pretty.slice(0, 6000) + '\n…（内容过长已截断）';
        openModal({
          title: `测试：${slug}`,
          wide: true,
          hideFooter: true,
          bodyHTML: `
            <p class="td-muted" style="margin-bottom:10px">HTTP ${res.status} ｜ ${res.headers.get('content-type') || '未知类型'}</p>
            <pre class="key-reveal" style="max-height:380px;overflow:auto;white-space:pre-wrap">${esc(pretty || '（空响应）')}</pre>
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

/* ---------- 视图：试调用（调用台 + 调用记录） ---------- */

const pg = {
  tab: 'console',
  services: [],
  target: '__daily__', // '__daily__' 或代理服务 slug
  customSlug: false,
  params: [{ k: '', v: '' }],
  date: todayCN(),
  authMode: 'admin', // admin | key | none
  apiKey: sessionStorage.getItem('moonapi_test_key') || '',
  postBody: '',
  sending: false,
  resp: null,
  logEntry: null,
  filters: { days: 7, route: '', slug: '', status: '' },
  auto: false,
  autoTimer: null,
  logs: null,
  logSummary: null,
  retentionDays: 30,
};

function fmtTimeSec(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function renderPlayground() {
  const view = $('#view');
  view.innerHTML = `
    <div class="pg-tabs" role="tablist" aria-label="试调用子页">
      <button class="pg-tab ${pg.tab === 'console' ? 'active' : ''}" data-tab="console" role="tab" aria-selected="${pg.tab === 'console'}">调用台</button>
      <button class="pg-tab ${pg.tab === 'logs' ? 'active' : ''}" data-tab="logs" role="tab" aria-selected="${pg.tab === 'logs'}">调用记录</button>
      <div class="spacer"></div>
      <span class="pg-origin mono" title="当前服务地址">${esc(location.origin)}</span>
    </div>
    <div id="pg-body"></div>`;
  $$('.pg-tab', view).forEach((b) => b.addEventListener('click', () => {
    pg.tab = b.dataset.tab;
    $$('.pg-tab', view).forEach((x) => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-selected', x === b ? 'true' : 'false');
    });
    if (pg.tab === 'console') renderPgConsole();
    else renderPgLogs();
  }));
  if (pg.services.length === 0) {
    try {
      const res = await api('/proxy');
      pg.services = res.data.services || [];
    } catch { pg.services = []; }
  }
  if (pg.tab === 'console') renderPgConsole();
  else renderPgLogs();
}

/* ----- 调用台 ----- */

function pgParamRow(p, i) {
  return `<div class="pg-param-row" data-i="${i}">
    <input class="pg-pk" value="${esc(p.k)}" placeholder="参数名" aria-label="参数名">
    <input class="pg-pv" value="${esc(p.v)}" placeholder="值（原样透传上游）" aria-label="参数值">
    <button type="button" class="btn btn-sm pg-pdel" title="删除该参数">✕</button>
  </div>`;
}

function buildPgQuery() {
  const sp = new URLSearchParams();
  for (const p of pg.params) {
    if (String(p.k).trim()) sp.set(String(p.k).trim(), String(p.v));
  }
  return sp.toString();
}

function pgTargetInfo() {
  const isDaily = pg.target === '__daily__';
  const svc = pg.services.find((s) => s.slug === pg.target) || null;
  return {
    isDaily,
    svc,
    method: isDaily ? 'GET' : (svc?.method || 'GET'),
    path: isDaily ? '/api/v1/daily-card' : `/api/v1/proxy/${pg.target}`,
  };
}

function updatePgUrl() {
  const { isDaily, method, path } = pgTargetInfo();
  const qs = isDaily ? (pg.date ? `date=${encodeURIComponent(pg.date)}` : '') : buildPgQuery();
  const line = $('#pg-url');
  if (line) line.textContent = `${path}${qs ? `?${qs}` : ''}`;
  const chip = $('.pg-method');
  if (chip) {
    chip.textContent = method;
    chip.className = `pg-method m-${method.toLowerCase()}`;
  }
}

function renderPgConsole() {
  const body = $('#pg-body');
  if (!body) return;
  const { isDaily, svc, method } = pgTargetInfo();
  body.innerHTML = `
    <div class="pg-grid">
      <section class="card-panel pg-panel" aria-label="请求构建">
        <div class="pg-panel-head">
          <strong>请求构建</strong>
          <span class="td-muted">真实调用 · 计入用量统计并写入调用日志</span>
        </div>
        <div class="pg-panel-body">
          <div class="field">
            <label for="pg-target">调用目标</label>
            <select id="pg-target">
              <option value="__daily__">每日知识卡片 · /api/v1/daily-card</option>
              ${pg.services.map((s) => `<option value="${esc(s.slug)}" ${s.slug === pg.target ? 'selected' : ''}>${esc(s.name || s.slug)} · ${esc(s.slug)}${s.enabled === false ? '（已停用）' : ''}</option>`).join('')}
            </select>
          </div>
          <div class="pg-reqline" aria-label="请求地址">
            <span class="pg-method m-${method.toLowerCase()}">${method}</span>
            <code id="pg-url">${esc(pgTargetInfo().path)}</code>
          </div>
          ${isDaily ? `
          <div class="field"><label for="pg-date">日期（默认今天）</label>
            <input type="date" id="pg-date" value="${esc(pg.date)}"></div>` : `
          <div class="pg-params">
            <div class="pg-params-head"><span>查询参数（原样透传上游）</span>
              <button type="button" class="btn btn-sm" id="pg-add-param">＋ 添加参数</button></div>
            <div id="pg-param-rows">${pg.params.map((p, i) => pgParamRow(p, i)).join('')}</div>
          </div>
          ${method === 'POST' ? `
          <div class="field"><label for="pg-postbody">请求体（POST）</label>
            <textarea id="pg-postbody" class="mono" style="min-height:88px" placeholder='{"key": "value"}'>${esc(pg.postBody)}</textarea></div>` : ''}
          ${!svc ? '<div class="hint td-muted">未找到该代理服务，可手动指定 slug 测试错误路径。</div>' : ''}
          ${svc?.enabled === false ? '<div class="notice">该代理服务已停用，调用将返回 40303。</div>' : ''}
          <div class="hint" style="margin-top:2px">
            <button type="button" class="link-btn" id="pg-custom-slug">手动指定 slug（测试 404 / 格式校验）</button>
          </div>
          <div id="pg-custom-wrap" ${pg.customSlug ? '' : 'hidden'}>
            <div class="field"><label for="pg-slug-input">slug</label>
              <input id="pg-slug-input" class="mono" value="${esc(pg.target)}" placeholder="如 nope"></div>
          </div>`}
          <div class="field">
            <label>认证方式</label>
            <div class="pg-auth">
              <label class="pg-auth-item"><input type="radio" name="pg-auth" value="admin" ${pg.authMode === 'admin' ? 'checked' : ''}> 管理员令牌</label>
              <label class="pg-auth-item"><input type="radio" name="pg-auth" value="key" ${pg.authMode === 'key' ? 'checked' : ''}> API Key</label>
              <label class="pg-auth-item"><input type="radio" name="pg-auth" value="none" ${pg.authMode === 'none' ? 'checked' : ''}> 无凭证（测 401）</label>
            </div>
            <div id="pg-key-wrap" ${pg.authMode === 'key' ? '' : 'hidden'}>
              <input id="pg-key-input" class="mono" type="password" value="${esc(pg.apiKey)}" placeholder="mk_live_…" style="margin-top:8px">
              <div class="hint">仅保存在浏览器 sessionStorage，用于真实密钥链路测试（配额、吊销等）。</div>
            </div>
          </div>
          <div class="pg-actions">
            <button class="btn btn-gold" id="pg-send">发送请求</button>
            <button class="btn" id="pg-curl">复制 cURL</button>
            <span class="hint td-muted">Ctrl / ⌘ + Enter</span>
          </div>
        </div>
      </section>
      <section class="card-panel pg-panel" aria-label="调用结果">
        <div class="pg-panel-head"><strong>调用结果</strong><span class="td-muted" id="pg-resp-meta"></span></div>
        <div class="pg-panel-body" id="pg-resp" aria-live="polite">${pgRespIdle()}</div>
      </section>
    </div>`;

  updatePgUrl();
  $('#pg-target').addEventListener('change', (e) => {
    pg.target = e.target.value;
    pg.customSlug = false;
    renderPgConsole();
  });
  const dateInput = $('#pg-date');
  if (dateInput) dateInput.addEventListener('change', (e) => { pg.date = e.target.value; updatePgUrl(); });
  const rows = $('#pg-param-rows');
  if (rows) {
    const syncParams = () => {
      $$('.pg-param-row', rows).forEach((row) => {
        const i = Number(row.dataset.i);
        if (!pg.params[i]) return;
        pg.params[i].k = $('.pg-pk', row).value;
        pg.params[i].v = $('.pg-pv', row).value;
      });
    };
    rows.addEventListener('input', (e) => { syncParams(); updatePgUrl(); });
    rows.addEventListener('click', (e) => {
      if (!e.target.classList.contains('pg-pdel')) return;
      syncParams();
      const i = Number(e.target.closest('.pg-param-row').dataset.i);
      pg.params.splice(i, 1);
      if (pg.params.length === 0) pg.params.push({ k: '', v: '' });
      rows.innerHTML = pg.params.map((p, j) => pgParamRow(p, j)).join('');
      updatePgUrl();
    });
    $('#pg-add-param').addEventListener('click', () => {
      syncParams();
      pg.params.push({ k: '', v: '' });
      rows.innerHTML = pg.params.map((p, j) => pgParamRow(p, j)).join('');
      updatePgUrl();
      $$('.pg-pk', rows).pop()?.focus();
    });
  }
  const postbody = $('#pg-postbody');
  if (postbody) postbody.addEventListener('input', (e) => { pg.postBody = e.target.value; });
  const customBtn = $('#pg-custom-slug');
  if (customBtn) customBtn.addEventListener('click', () => {
    pg.customSlug = !pg.customSlug;
    $('#pg-custom-wrap').hidden = !pg.customSlug;
    if (pg.customSlug) $('#pg-slug-input').focus();
  });
  const slugInput = $('#pg-slug-input');
  if (slugInput) slugInput.addEventListener('input', (e) => {
    pg.target = e.target.value.trim().toLowerCase() || '__none__';
    const qs = buildPgQuery();
    $('#pg-url').textContent = `/api/v1/proxy/${pg.target}${qs ? `?${qs}` : ''}`;
  });
  $$('#pg-body input[name="pg-auth"]').forEach((r) => r.addEventListener('change', () => {
    pg.authMode = document.querySelector('input[name="pg-auth"]:checked').value;
    $('#pg-key-wrap').hidden = pg.authMode !== 'key';
  }));
  $('#pg-send').addEventListener('click', sendPgRequest);
  $('#pg-curl').addEventListener('click', async () => {
    await copyText(buildPgCurl(true));
    toast('cURL 已复制（含真实凭证，注意保密）');
  });
}

function pgRespIdle() {
  return `<div class="pg-idle"><span class="pg-idle-ico" aria-hidden="true">✦</span>
    <p>在左侧构建请求并发送。<br>这里会展示真实响应与调用阶段轨迹。</p></div>`;
}

function pgTrack(entry) {
  const st = Array.isArray(entry?.stages) ? entry.stages : [];
  if (st.length === 0) return '';
  return `<div class="pg-track" role="list" aria-label="调用阶段轨迹">
    ${st.map((s) => `
      <div class="pg-node ${s.s === 'ok' ? 'ok' : s.s === 'fail' ? 'fail' : 'skip'}" role="listitem">
        <div class="pg-dot" aria-hidden="true"></div>
        <div class="pg-node-name">${esc(s.name)}</div>
        <div class="pg-node-ms">${s.ms != null ? `${s.ms}ms` : (s.s === 'skip' ? '跳过' : '')}</div>
        ${s.note ? `<div class="pg-node-note" title="${esc(s.note)}">${esc(s.note)}</div>` : ''}
      </div>`).join('')}
  </div>
  <div class="pg-track-total mono">服务端处理 ${entry.result?.ms ?? '—'}ms${entry.upstream?.ms != null ? ` ｜ 上游 ${entry.upstream.ms}ms` : ''}${entry.result?.cache === 'hit' ? ' ｜ KV 缓存命中' : ''}</div>`;
}

function renderPgResponse() {
  const wrap = $('#pg-resp');
  if (!wrap) return;
  const r = pg.resp;
  if (!r) { wrap.innerHTML = pgRespIdle(); renderPgRespMeta(); return; }

  const track = pg.logEntry
    ? pgTrack(pg.logEntry)
    : (r.requestId ? '<div class="pg-track-pending">正在获取服务端调用明细…</div>' : '');
  const cls = !r.status ? 's5' : r.status < 300 ? 's2' : r.status < 400 ? 's3' : r.status < 500 ? 's4' : 's5';
  const isImage = /^image\//i.test(r.contentType || '');

  let bodyBlock = '';
  if (r.blobUrl && isImage) {
    bodyBlock = `<img class="pg-img" src="${r.blobUrl}" alt="上游返回的图片">
      <div style="display:flex;gap:10px;margin-top:8px">
        <a class="btn btn-sm" href="${r.blobUrl}" download>下载原图</a>
        <span class="td-muted">${fmtBytes(r.bytes)}</span>
      </div>`;
  } else if (r.json !== undefined && r.json !== null) {
    let pretty = '';
    try { pretty = JSON.stringify(r.json, null, 2); } catch { pretty = String(r.text); }
    if (pretty.length > 20000) pretty = pretty.slice(0, 20000) + '\n…（内容过长已截断）';
    bodyBlock = `
      <div class="pg-bodytabs" role="tablist">
        <button class="pg-bodytab active" data-bt="pretty" role="tab">美化 JSON</button>
        <button class="pg-bodytab" data-bt="raw" role="tab">原始</button>
        <button class="pg-bodytab" data-bt="headers" role="tab">响应头</button>
      </div>
      <pre class="pg-json" id="pg-body-view" tabindex="0">${esc(pretty)}</pre>`;
  } else {
    bodyBlock = `
      <div class="pg-bodytabs" role="tablist">
        <button class="pg-bodytab active" data-bt="raw" role="tab">响应内容</button>
        <button class="pg-bodytab" data-bt="headers" role="tab">响应头</button>
      </div>
      <pre class="pg-json" id="pg-body-view" tabindex="0">${esc((r.text || '（空响应）').slice(0, 20000))}</pre>`;
  }

  wrap.innerHTML = `
    ${track}
    <div class="pg-resp-head">
      <span class="pg-status ${cls}">HTTP ${r.status ?? '—'}</span>
      ${r.code != null && r.code !== 0 ? `<span class="tag tag-err mono" title="${esc(r.message || '')}">code ${r.code}</span>` : ''}
      <div class="pg-meta">
        <span>客户端往返 <b>${r.msClient}ms</b></span>
        <span>${fmtBytes(r.bytes)}</span>
        ${r.requestId ? `<span>requestId <b class="mono">${esc(r.requestId)}</b></span>` : ''}
      </div>
    </div>
    ${r.code != null && r.code !== 0 && r.message ? `<div class="pg-err">${esc(r.message)}</div>` : ''}
    ${bodyBlock}`;

  $$('.pg-bodytab', wrap).forEach((b) => b.addEventListener('click', () => {
    $$('.pg-bodytab', wrap).forEach((x) => x.classList.toggle('active', x === b));
    const view = $('#pg-body-view', wrap);
    if (b.dataset.bt === 'headers') {
      view.textContent = (r.headers || []).map(([k, v]) => `${k}: ${v}`).join('\n') || '（无响应头）';
    } else if (b.dataset.bt === 'raw') {
      view.textContent = (r.text || '（空响应）').slice(0, 20000);
    } else {
      let pretty = '';
      try { pretty = JSON.stringify(r.json, null, 2); } catch { pretty = String(r.text || ''); }
      view.textContent = pretty.slice(0, 20000);
    }
  }));
  renderPgRespMeta();
}

function fmtBytes(n) {
  if (n == null) return '—';
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function renderPgRespMeta() {
  const el = $('#pg-resp-meta');
  if (!el) return;
  el.textContent = pg.resp
    ? (pg.logEntry ? `调用明细已归档 · ${pg.logEntry.id}` : pg.resp.requestId ? '服务端明细同步中' : '')
    : '等待调用';
}

function buildPgCurl(real) {
  const { isDaily, svc, method, path } = pgTargetInfo();
  const qs = isDaily ? (pg.date ? `date=${encodeURIComponent(pg.date)}` : '') : buildPgQuery();
  const auth = pg.authMode === 'admin' ? state.token : pg.authMode === 'key' ? pg.apiKey : '';
  const shown = real ? auth : '<令牌或API_KEY>';
  let cmd = 'curl';
  if (auth) cmd += ` -H "Authorization: Bearer ${shown}"`;
  if (method === 'POST') {
    cmd += ' -X POST';
    const bodyText = (pg.postBody || '').trim();
    if (bodyText) cmd += ` -H "content-type: application/json" -d '${bodyText.replace(/'/g, "'\\''")}'`;
  }
  cmd += ` "${location.origin}${path}${qs ? `?${qs}` : ''}"`;
  if (!isDaily && svc?.enabled === false) cmd += '  # 该服务已停用，将返回 40303';
  return cmd;
}

async function sendPgRequest() {
  if (pg.sending) return;
  const isDaily = pg.target === '__daily__';
  const { svc, method, path: basePath } = pgTargetInfo();
  const slugInput = $('#pg-slug-input');
  const path = !isDaily && pg.customSlug && slugInput
    ? `/api/v1/proxy/${slugInput.value.trim().toLowerCase()}`
    : basePath;
  const qs = isDaily ? (pg.date ? `date=${encodeURIComponent(pg.date)}` : '') : buildPgQuery();
  const url = `${path}${qs ? `?${qs}` : ''}`;

  const headers = {};
  if (pg.authMode === 'admin') {
    headers.authorization = `Bearer ${state.token}`;
  } else if (pg.authMode === 'key') {
    const k = ($('#pg-key-input')?.value || pg.apiKey || '').trim();
    if (!k) { toast('请先填入 API Key', 'error'); return; }
    pg.apiKey = k;
    sessionStorage.setItem('moonapi_test_key', k);
    headers.authorization = `Bearer ${k}`;
  }

  const init = { method, headers };
  if (method === 'POST' && !isDaily) {
    const bodyText = ($('#pg-postbody')?.value || '').trim();
    if (bodyText) {
      init.body = bodyText;
      headers['content-type'] = /^[[{]/.test(bodyText) ? 'application/json' : 'text/plain';
    }
  }

  pg.sending = true;
  const btn = $('#pg-send');
  if (btn) { btn.disabled = true; btn.textContent = '调用中…'; }
  const t0 = performance.now();
  try {
    const res = await fetch(url, init);
    const msClient = Math.round(performance.now() - t0);
    const ct = res.headers.get('content-type') || '';
    const payload = {
      status: res.status, ok: res.ok, contentType: ct, msClient,
      headers: [...res.headers.entries()], text: '', blobUrl: null,
      requestId: null, code: null, message: null, json: undefined, bytes: null,
    };
    if (/^image\//i.test(ct) || /octet-stream/i.test(ct)) {
      const blob = await res.blob();
      payload.blobUrl = URL.createObjectURL(blob);
      payload.bytes = blob.size;
    } else {
      payload.text = await res.text();
      payload.bytes = payload.text.length;
      try {
        const j = JSON.parse(payload.text);
        payload.json = j;
        payload.code = j?.code ?? null;
        payload.requestId = j?.requestId ?? null;
        payload.message = j?.message ?? null;
      } catch { /* 非 JSON 响应 */ }
    }
    pg.resp = payload;
    pg.logEntry = null;
    renderPgResponse();
    if (payload.requestId && pg.authMode !== 'none') pollPgLog(payload.requestId);
    else renderPgRespMeta();
  } catch (err) {
    toast(err.message || '网络错误，调用未到达服务端', 'error');
  } finally {
    pg.sending = false;
    const b = $('#pg-send');
    if (b) { b.disabled = false; b.textContent = '发送请求'; }
  }
}

async function pollPgLog(requestId) {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 400 : 900));
    if (pg.tab !== 'console' || !$('#pg-resp')) return;
    try {
      const res = await api(`/logs?days=1&limit=10&requestId=${encodeURIComponent(requestId)}`);
      const hit = (res.data.entries || []).find((e) => e.requestId === requestId);
      if (hit) {
        pg.logEntry = hit;
        renderPgResponse();
        return;
      }
    } catch { /* 明细拉取失败不影响结果展示 */ }
  }
  renderPgRespMeta();
}

/* ----- 调用记录 ----- */

function pgCallerHtml(c) {
  if (!c || c.type === 'anonymous') return `<span class="tag tag-err" title="${esc(c?.note || '未携带有效凭证')}">匿名</span>`;
  if (c.type === 'admin') return '<span class="tag">管理员</span>';
  return `<span class="tag tag-pin">${esc(c.name || 'API Key')}</span> <span class="mono td-muted">${esc(c.key || '')}</span>`;
}

function pgStatusHtml(e) {
  const s = e.result?.status;
  const cls = !s ? 's5' : s < 300 ? 's2' : s < 400 ? 's3' : s < 500 ? 's4' : 's5';
  const code = e.result?.code;
  return `<span class="pg-status ${cls}">${s ?? '—'}</span>${code != null && code !== 0 ? `<span class="tag tag-err mono" title="${esc(e.result?.error || '')}">${code}</span>` : ''}`;
}

function renderPgLogs() {
  const body = $('#pg-body');
  if (!body) return;
  body.innerHTML = `
    <div class="card-panel pg-panel">
      <div class="pg-panel-head">
        <strong>调用记录</strong>
        <div class="pg-log-tools">
          <select id="pgf-days" aria-label="时间范围">
            ${[1, 7, 14, 30].map((d) => `<option value="${d}" ${pg.filters.days === d ? 'selected' : ''}>最近 ${d} 天</option>`).join('')}
          </select>
          <select id="pgf-route" aria-label="接口类型">
            <option value="">全部类型</option>
            <option value="proxy" ${pg.filters.route === 'proxy' ? 'selected' : ''}>代理转发</option>
            <option value="daily-card" ${pg.filters.route === 'daily-card' ? 'selected' : ''}>每日卡片</option>
          </select>
          <select id="pgf-slug" aria-label="代理服务" ${pg.filters.route === 'daily-card' ? 'disabled' : ''}>
            <option value="">全部服务</option>
            ${pg.services.map((s) => `<option value="${esc(s.slug)}" ${pg.filters.slug === s.slug ? 'selected' : ''}>${esc(s.slug)}</option>`).join('')}
          </select>
          <select id="pgf-status" aria-label="结果">
            <option value="">全部结果</option>
            <option value="success" ${pg.filters.status === 'success' ? 'selected' : ''}>成功</option>
            <option value="error" ${pg.filters.status === 'error' ? 'selected' : ''}>失败</option>
          </select>
          <label class="pg-auto"><input type="checkbox" id="pgf-auto" ${pg.auto ? 'checked' : ''}> 自动刷新</label>
          <button class="btn btn-sm" id="pgf-refresh">刷新</button>
          <button class="btn btn-sm btn-danger" id="pgf-clear">清理…</button>
        </div>
      </div>
      <div id="pg-log-body"></div>
    </div>`;

  $('#pgf-days').addEventListener('change', (e) => { pg.filters.days = Number(e.target.value) || 7; loadPgLogs(); });
  $('#pgf-route').addEventListener('change', (e) => {
    pg.filters.route = e.target.value;
    if (pg.filters.route === 'daily-card') pg.filters.slug = '';
    $('#pgf-slug').disabled = pg.filters.route === 'daily-card';
    loadPgLogs();
  });
  $('#pgf-slug').addEventListener('change', (e) => { pg.filters.slug = e.target.value; loadPgLogs(); });
  $('#pgf-status').addEventListener('change', (e) => { pg.filters.status = e.target.value; loadPgLogs(); });
  $('#pgf-auto').addEventListener('change', (e) => setPgAuto(e.target.checked));
  $('#pgf-refresh').addEventListener('click', loadPgLogs);
  $('#pgf-clear').addEventListener('click', pgClearModal);

  loadPgLogs();
  setPgAuto(pg.auto);
}

function setPgAuto(on) {
  pg.auto = on;
  if (pg.autoTimer) { clearInterval(pg.autoTimer); pg.autoTimer = null; }
  if (on) {
    pg.autoTimer = setInterval(() => {
      if (pg.tab !== 'logs' || !$('#pg-log-body')) return;
      loadPgLogs();
    }, 5000);
  }
}

async function loadPgLogs() {
  const wrap = $('#pg-log-body');
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty-state"><p>加载中…</p></div>';
  const q = new URLSearchParams({ days: String(pg.filters.days), limit: '150' });
  if (pg.filters.route) q.set('route', pg.filters.route);
  if (pg.filters.route === 'proxy' && pg.filters.slug) q.set('slug', pg.filters.slug);
  if (pg.filters.status) q.set('status', pg.filters.status);
  try {
    const res = await api(`/logs?${q}`);
    pg.logs = res.data.entries || [];
    pg.logSummary = res.data.summary || {};
    pg.retentionDays = res.data.retentionDays || 30;
    drawPgLogs();
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state"><span class="empty-ico">✦</span><p>${esc(err.message)}</p></div>`;
  }
}

function drawPgLogs() {
  const wrap = $('#pg-log-body');
  if (!wrap) return;
  const s = pg.logSummary || {};
  const entries = pg.logs || [];
  const sum = `
    <div class="pg-sum">
      <div class="pg-sum-item"><div class="pg-sum-v">${s.total ?? 0}</div><div class="pg-sum-l">调用次数</div></div>
      <div class="pg-sum-item"><div class="pg-sum-v">${s.ok ?? 0}</div><div class="pg-sum-l">成功</div></div>
      <div class="pg-sum-item ${s.error ? 'bad' : ''}"><div class="pg-sum-v">${s.error ?? 0}</div><div class="pg-sum-l">失败</div></div>
      <div class="pg-sum-item"><div class="pg-sum-v">${s.avgMs ?? 0}<small style="font-size:.7em;color:var(--muted)">ms</small></div><div class="pg-sum-l">平均延迟</div></div>
      <div class="pg-sum-item"><div class="pg-sum-v">${s.cacheHits ?? 0}</div><div class="pg-sum-l">缓存命中</div></div>
    </div>`;

  if (entries.length === 0) {
    wrap.innerHTML = `${sum}<div class="empty-state"><span class="empty-ico">✦</span>
      <p>该时间范围内没有调用记录。去「调用台」发起一次真实调用试试。</p></div>`;
    return;
  }

  wrap.innerHTML = `${sum}
    <table class="data">
      <thead><tr>
        <th>时间</th><th>接口</th><th>调用方</th><th>结果</th><th>延迟</th><th>缓存</th><th style="text-align:right">明细</th>
      </tr></thead>
      <tbody>
        ${entries.map((e) => `
          <tr data-key="${esc(e.key || '')}" style="cursor:pointer">
            <td class="mono td-muted">${esc((e.ts || '').slice(5, 10))} ${fmtTimeSec(e.ts)}</td>
            <td>
              <span class="tag tag-dim">${e.route === 'proxy' ? '代理' : '卡片'}</span>
              <span class="mono">${esc(e.route === 'proxy' ? e.slug : e.endpoint)}</span>
            </td>
            <td>${pgCallerHtml(e.caller)}</td>
            <td>${pgStatusHtml(e)}${e.result?.error ? `<div class="pg-node-note" style="max-width:220px;margin:0" title="${esc(e.result.error)}">${esc(e.result.error)}</div>` : ''}</td>
            <td class="mono">${e.result?.ms != null ? `${e.result.ms}ms` : '—'}</td>
            <td>${e.result?.cache === 'hit' ? '<span class="tag tag-pin">KV</span>' : '<span class="td-muted">—</span>'}</td>
            <td class="td-actions"><button class="btn btn-sm pg-detail">查看</button></td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div class="hint td-muted" style="padding:10px 18px">明细日志保留 ${pg.retentionDays} 天，超期自动清理；单次最多返回 150 条摘要。</div>`;

  $$('.pg-detail', wrap).forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openPgDetail(e.target.closest('tr').dataset.key);
  }));
  $$('tbody tr', wrap).forEach((tr) => tr.addEventListener('click', () => openPgDetail(tr.dataset.key)));
}

async function openPgDetail(key) {
  if (!key) return;
  let entry = null;
  try {
    const res = await api(`/logs?key=${encodeURIComponent(key)}`);
    entry = res.data.entry;
  } catch (err) { return toast(err.message, 'error'); }
  if (!entry) return;

  const queryRows = Object.entries(entry.query || {})
    .map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td class="mono">${esc(String(v))}</td></tr>`).join('');
  openModal({
    title: `调用明细 · ${esc(entry.id || '')}`,
    wide: true,
    hideFooter: true,
    bodyHTML: `
      ${pgTrack(entry)}
      <div class="pg-resp-head" style="margin-top:6px">${pgStatusHtml(entry)}</div>
      <table class="data">
        <tbody>
          <tr><th style="width:110px">时间</th><td class="mono">${esc(entry.ts || '')}</td></tr>
          <tr><th>接口</th><td class="mono">${esc(entry.method || 'GET')} ${esc(entry.endpoint || '')}</td></tr>
          <tr><th>调用方</th><td>${pgCallerHtml(entry.caller)}</td></tr>
          <tr><th>上游</th><td class="mono">${esc(entry.upstream?.host || '—')}${entry.upstream?.status != null ? ` · HTTP ${entry.upstream.status}` : ''}${entry.upstream?.ms != null ? ` · ${entry.upstream.ms}ms` : ''}</td></tr>
          <tr><th>耗时</th><td class="mono">服务端 ${entry.result?.ms ?? '—'}ms ｜ 字节 ${entry.result?.bytes ?? '—'} ｜ 缓存 ${esc(entry.result?.cache || '—')}</td></tr>
          ${entry.result?.error ? `<tr><th>错误</th><td style="color:var(--danger)">${esc(entry.result.error)}</td></tr>` : ''}
          ${entry.requestId ? `<tr><th>requestId</th><td class="mono">${esc(entry.requestId)}</td></tr>` : ''}
          ${entry.ray ? `<tr><th>CF Ray</th><td class="mono">${esc(entry.ray)}</td></tr>` : ''}
          ${entry.country ? `<tr><th>来源地区</th><td class="mono">${esc(entry.country)}</td></tr>` : ''}
          ${entry.ua ? `<tr><th>UA</th><td class="mono" style="word-break:break-all">${esc(entry.ua)}</td></tr>` : ''}
        </tbody>
      </table>
      ${queryRows ? `<h3 style="margin:16px 0 8px;font-size:.95rem">查询参数</h3>
        <table class="data"><thead><tr><th>参数</th><th>值</th></tr></thead><tbody>${queryRows}</tbody></table>` : ''}
      <details style="margin-top:14px">
        <summary style="cursor:pointer;font-size:.85rem;color:var(--muted)">原始日志 JSON</summary>
        <pre class="pg-json" style="margin-top:8px">${esc(JSON.stringify(entry, null, 2))}</pre>
      </details>
      <div style="margin-top:14px"><button class="btn" id="pg-detail-close">关闭</button></div>`,
  });
  $('#pg-detail-close').addEventListener('click', closeModal);
}

function pgClearModal() {
  openModal({
    title: '清理调用日志',
    submitLabel: '执行清理',
    bodyHTML: `
      <div class="notice" style="background:#faeeec;border-color:#e5c2be;color:#7a2d25">
        清理操作不可恢复。日志明细保留 ${pg.retentionDays} 天，超期会自动清理；这里可手动提前清理。
      </div>
      <div class="field"><label for="pgc-keep">保留最近多少天的日志（0 = 清空全部）</label>
        <input id="pgc-keep" type="number" min="0" max="365" value="${pg.retentionDays}"></div>`,
    onSubmit: async (mask) => {
      const keepDays = Math.max(0, Math.min(365, Number($('#pgc-keep', mask).value) || 0));
      const res = await api('/logs', 'POST', { action: 'clear', keepDays });
      toast(res.message || '清理完成');
      closeModal();
      loadPgLogs();
    },
  });
}

/* ---------- 启动 ---------- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && pg.tab === 'console') {
    const view = location.hash.replace('#/', '').split('?')[0];
    if (view !== 'playground') return;
    const btn = $('#pg-send');
    if (btn && !btn.disabled) { e.preventDefault(); sendPgRequest(); }
  }
});
boot();
