'use strict';

const VillageHarness = (() => {
  const titles = {
    taskBoard: '菜园委托田', sowTask: '播下委托', taskRecord: '委托手记',
    forge: '铁匠铺', skillForge: '锻造技艺', workArchive: '委托案卷',
  };
  const statuses = {
    planted: '待开工', working: '主理人工作中', ready: '可收获', blocked: '遇到卡点',
    advising: '顾问思考中', advised: '建议待挑选', harvested: '已收获',
    failed: '执行受阻', interrupted: '上次中断', closed: '已封存',
  };
  const tools = {materials:'物资库存', buildings:'建筑进度', farm:'菜田', roster:'居民名册'};
  const modeName = mode => mode === 'model' ? '真实模型' : '本地实习';
  const person = id => state.residents.find(r => r.id === id)?.name || '未找到居民';
  const nav = (view, label) => `<button type="button" class="outline" data-go="${view}">${label}</button>`;
  const toolbar = content => `<div class="harness-toolbar">${content}</div>`;
  const shop = () => state.buildings.find(b => b.id === 'workshop');
  const garden = () => state.buildings.find(b => b.id === 'farm');
  const handles = view => Object.prototype.hasOwnProperty.call(titles, view);
  let forgeDraft = null;
  let chatOrder = null;
  let chatOrderVersion = 0;

  function openOrderFromChat(workerId, goal) {
    if (!state?.harness || !state.residents.some(r => r.id === workerId)) return false;
    chatOrder = {workerId, goal:typeof goal === 'string' ? goal : ''};
    chatOrderVersion++;
    navigate(garden()?.built ? 'sowTask' : 'taskBoard');
    return true;
  }

  function board(h, archive = false) {
    const records = archive ? h.tasks.filter(t => ['closed','harvested'].includes(t.status)) : h.tasks;
    const tasks = records.map(t => `<button type="button" class="work-order" data-task-record="${esc(t.id)}">
      <span><strong>${esc(t.title)}</strong><small>${modeName(t.mode)} · ${esc(person(t.worker_id))} 主理 · 第 ${esc(t.revision)} 稿</small></span>
      <b class="order-status" data-stage="${esc(t.status)}">${esc(statuses[t.status] || t.status)}</b></button>`).join('');
    if (archive) return toolbar(nav('taskBoard','返回委托田')) + (tasks || '<p class="fine-print">验收或封存的委托会收入这里。</p>');
    return toolbar(nav('farm','打理菜田') + nav('forge','去铁匠铺') + nav('workArchive','查看案卷')) +
      `<div class="field-actions"><p>选一份技艺，交给主理人独立完成。需要第二意见时，每稿可请最多三位村民分别看盲点。</p>
      ${garden()?.built ? `<button type="button" class="primary" data-go="sowTask">${chatOrder?'继续填写聊天草稿':'＋ 播下委托'}</button>` : '<button class="outline" data-building="farm">查看菜园建设</button>'}
      ${chatOrder && !garden()?.built ? '<small role="status">聊天草稿已暂存在本页。菜园建成后可继续填写。</small>' : ''}</div>
      <h3 class="work-heading">田里的委托 <small>${h.tasks.length} 份</small></h3>
      ${tasks || '<p class="fine-print">田里还没有委托。第一次可以用本地实习盘点村庄。</p>'}`;
  }

  function forge(h) {
    const building = shop();
    const progress = building?.constructing ? '居民正在施工' : '尚待建设';
    const cards = h.skills.map(s => `<details class="skill-leaf"><summary><strong>${esc(s.name)}</strong><span>${esc(s.description)}</span></summary>
      <p class="work-text">${esc(s.instructions)}</p><p class="fine-print">${s.tools.length ? '取材于' + esc(s.tools.map(k => tools[k] || k).join('、')) : '纯文本技艺，材料由委托人提供。'}</p>
      <button type="button" class="outline" data-skill-download="${esc(s.id)}">下载 SKILL.md</button></details>`).join('');
    return toolbar(nav('taskBoard','返回委托田')) +
      `<div class="field-actions"><p>把步骤、用途和可查阅的村务材料写成技艺。村民领到委托时会带上你选的那一份。</p>
      ${building?.built ? '<button class="primary" data-go="skillForge">＋ 锻造新技艺</button>' : `<button class="outline" data-building="workshop">查看工坊建设</button><small>${progress}。落成后可锻造新技艺，册中技艺现在就能使用。</small>`}</div>
      <h3 class="work-heading">技艺册 <small>${h.skills.length} 份</small></h3>${cards}`;
  }

  function forgeForm() {
    const draft = forgeDraft;
    forgeDraft = null;
    return toolbar(nav('forge','返回技艺册')) + `<form class="work-form" data-forge-form>
      ${draft ? '<p class="fine-print">已带来收获的成果，请把可复用的步骤整理到 1000 字以内再锻造。</p>' : ''}
      <label>技艺名称<input name="name" required maxlength="40" placeholder="如：工地备料清单" value="${esc(draft?.title.slice(0,40) || '')}"></label>
      <label>何时使用<input name="description" required maxlength="160" placeholder="如：开工前检查现有物资和建筑进度" value="${esc(draft?.goal.slice(0,160) || '')}"></label>
      <label>工作步骤<textarea name="instructions" rows="5" required maxlength="1000" placeholder="先读哪些材料？进行哪些检查？成果应包含什么？">${esc(draft?.artifact || '')}</textarea></label>
      <fieldset class="source-checks"><legend>允许查阅的村务材料（可留空）</legend>
      ${Object.entries(tools).map(([k,v]) => `<label><input type="checkbox" name="tools" value="${k}" ${draft && state.harness.skills.find(s=>s.id===draft.skill_id)?.tools.includes(k)?'checked':''}>${v}</label>`).join('')}</fieldset>
      <button class="primary full" type="submit" ${shop()?.built ? '' : 'disabled'}>锻造并收入技艺册</button>
      ${shop()?.built ? '' : '<p class="fine-print">工坊落成后可锻造。你也可以随时从收获的委托中重新带来这份成果。</p><button class="outline" type="button" data-building="workshop">查看工坊建设</button>'}</form>`;
  }

  function orderForm() {
    return toolbar(nav('taskBoard','返回委托田')) + `<form class="work-form" data-sow-form>
      ${chatOrder ? `<div class="chat-order-note"><span>来自与${esc(person(chatOrder.workerId))}的聊天草稿</span><button type="button" class="outline" data-discard-chat>清除带来的草稿</button></div>` : ''}
      <label>协作方式<select name="mode"><option value="local">本地实习 · 村务盘点</option><option value="model">真实模型 · 自由委托</option></select></label>
      <p class="fine-print" data-mode-note></p>
      <label>委托名称<input name="title" required maxlength="80" placeholder="给这份委托起个名字" value="${chatOrder?'':'村庄开工前盘点'}"></label>
      <label><span data-goal-label>盘点备注</span><textarea name="goal" rows="3" required maxlength="800">${chatOrder ? esc(chatOrder.goal) : '交一份最新的村务盘点单，列出下一步要留意的事项。'}</textarea></label>
      ${chatOrder?.goal.length>800?'<p class="fine-print" data-goal-length>草稿超过 800 字，请在提交前精简。</p>':''}
      <label>携带技艺<select name="skill_id" required></select></label>
      <p class="fine-print" data-skill-note></p>
      <label>主理人<select name="worker_id" required></select></label>
      <p class="fine-print" data-connection-note></p>
      <button class="primary full" type="submit">把委托种到田里</button></form>`;
  }

  function updateAssignments(form, preferredWorker) {
    const fields = form.elements;
    const real = fields.mode.value === 'model';
    const residents = state.residents.filter(r => !real || r.connected);
    const skills = state.harness.skills.filter(s => real || s.tools.length);
    const current = fields.skill_id.value;
    fields.skill_id.innerHTML = skills.map(s => `<option value="${esc(s.id)}" ${s.id===current?'selected':''}>${esc(s.name)}</option>`).join('');
    const choices = (list, id) => list.map(r => `<option value="${esc(r.id)}" ${r.id===id?'selected':''}>${esc(r.name)} · ${esc(r.role)}</option>`).join('');
    fields.worker_id.innerHTML = choices(residents, preferredWorker ?? fields.worker_id.value);
    const enough = residents.length >= 1;
    form.querySelector('[type=submit]').disabled = !enough;
    form.querySelector('[data-goal-label]').textContent = real ? '交付目标与验收要求' : '盘点备注';
    form.querySelector('[data-mode-note]').textContent = real
      ? '主理人依据委托和所选技艺独立交稿或说明卡点。开工会调用一次模型，求援和修订由你另行决定。'
      : '程序按技艺选定的数据项生成盘点单，备注随单保存。实习中的主理与求援均由本地规则执行，无需密钥或 Token。';
    form.querySelector('[data-connection-note]').textContent = enough
      ? '' : '请先从地图打开一位居民的「API 接入设置」，或选择本地实习。';
  }

  const advisorName = id => id ? person(id) : '旧记录未记名';
  function currentAdvice(t) {
    const current = (t.consultations || []).filter(c => c.revision === t.revision);
    const asked = new Set(t.advisor_ids || []);
    const groups = new Map();
    const records = new Map();
    function group(id) {
      if (!groups.has(id)) groups.set(id, {id, question:'', hints:[]});
      return groups.get(id);
    }
    for (const id of asked) group(id);
    for (const c of current) {
      const id = c.reviewer_id || '';
      if (id) asked.add(id);
      const info = group(id);
      info.question = c.question;
      for (const hint of c.hints || []) records.set(hint.id, id);
    }
    const legacyId = !Array.isArray(t.advisor_ids) && t.reviewer_id &&
      (t.status === 'advised' || t.stage === 'advisor') ? t.reviewer_id : '';
    if (legacyId) {
      asked.add(legacyId);
      if (!current.length) group(legacyId);
    }
    for (const hint of t.hints || []) {
      const id = hint.reviewer_id || (records.has(hint.id) ? records.get(hint.id) : legacyId) || '';
      if (id) asked.add(id);
      group(id).hints.push(hint);
    }
    return {asked, groups:[...groups.values()]};
  }

  function adviserForm(t, advice, draft) {
    const asked = advice.asked;
    if (asked.size >= 3) return '<p class="fine-print">本稿已邀请三位顾问。</p>';
    const peers = state.residents.filter(r => r.id !== t.worker_id && !asked.has(r.id) &&
      (t.mode === 'local' || r.connected));
    if (!peers.length) return `<p class="fine-print">${t.mode === 'model' ? '暂无可邀请的顾问。可在其他居民的 API 接入设置中连接模型。' : '本稿中可邀请的居民都已受邀。'}</p>`;
    const question = draft.question ?? (t.consult_question || t.question || '');
    return `<details class="work-trace" data-invite ${draft.inviteOpen ? 'open' : ''}><summary>邀请独立顾问 <small>本稿已邀 ${asked.size}/3 · 可选 ${peers.length} 位</small></summary>
      <form class="work-form" data-assist-form><p class="fine-print">顾问分别收到委托、你的问题和精简材料。你决定哪些建议交给主理人。</p>
      <label>可邀请的顾问<select name="reviewer_id" required>${peers.map(r => `<option value="${esc(r.id)}" ${r.id === draft.reviewer ? 'selected' : ''}>${esc(r.name)}${r.role ? ' · ' + esc(r.role) : ''}</option>`).join('')}</select></label>
      <label>请顾问独立看什么<textarea name="question" maxlength="400" required rows="2" placeholder="写下希望这位顾问检查的问题">${esc(question)}</textarea></label>
      <button class="outline" type="submit">${t.mode === 'model' ? '请顾问独立判断 · 调用模型' : '实习 · 查看规则提示'}</button></form></details>`;
  }

  function feedbackForm(t, advice, draft) {
    const comparing = advice.groups.length > 0 || t.status === 'advised' || t.status === 'advising';
    const waiting = t.status === 'advising';
    const revise = t.status === 'ready';
    const selected = new Set((t.hints || []).filter(h => draft.picks?.has(h.id)).map(h => h.id));
    const groups = advice.groups.map(g => {
      const pending = waiting && t.stage === 'advisor' && t.reviewer_id === g.id;
      return `<fieldset class="hint-checks adviser-card"><legend>${esc(advisorName(g.id))}</legend>
        ${g.question ? `<p class="adviser-question">${esc(g.question)}</p>` : ''}
        ${g.hints.map(h => `<label><input type="checkbox" name="hint_ids" value="${esc(h.id)}" ${selected.has(h.id)?'checked':selected.size>=3?'disabled':''}><span>${esc(h.text)}</span></label>`).join('')}
        ${g.hints.length ? '' : `<p class="fine-print" role="status">${pending ? '正在独立审阅…' : '未收到建议'}</p>`}</fieldset>`;
    }).join('');
    return `<${comparing?'section':'details'} class="work-trace work-guidance" data-guidance ${!comparing && draft.guidanceOpen?'open':''}>
      ${comparing ? '<h4>对照顾问建议</h4><p class="fine-print">最多勾选三条，也可以只写自己的意见。点击交回后，主理人才会收到。</p>' : `<summary>${revise?'让主理人修改':'直接补充线索'}</summary>`}
      <form class="work-form" data-feedback-action="${revise?'revise':'resume'}">
      ${groups ? `<div class="adviser-grid">${groups}</div><output class="hint-count" aria-live="polite">已勾选 ${selected.size}/3 条</output>` : ''}
      <label>给主理人的补充<textarea name="feedback" maxlength="600" rows="2" ${revise || t.status==='blocked' ? 'required' : ''}>${esc(draft.feedback || '')}</textarea></label>
      <button class="outline" type="submit" ${waiting?'disabled':''}>${waiting?'等待顾问回复':revise ? '退回待开工' : '交回主理人继续'}${!waiting && !revise && t.mode === 'model' ? ' · 调用模型' : ''}</button>
      </form></${comparing?'section':'details'}>`;
  }

  function taskDetails(t, draft) {
    const skill = state.harness.skills.find(s => s.id === t.skill_id);
    const start = ['planted','failed','interrupted'].includes(t.status);
    const past = t.history || [];
    const advice = currentAdvice(t);
    const old = past.filter(v => v.revision < t.revision);
    const lastResult = past.find(v => v.revision === t.revision) || past[past.length-1];
    const advisorFailed = ['failed','interrupted'].includes(t.status) && t.stage === 'advisor';
    const resultReady = t.status === 'ready' || ((t.status === 'advised' || advisorFailed) && lastResult?.status === 'ready');
    const canGuide = t.revision < 3;
    const guide = canGuide && (['ready','blocked','advising','advised'].includes(t.status) || advisorFailed);
    const consulted = (t.consultations || []).filter(c => !guide || c.revision !== t.revision);
    const events = (t.events || []).map(e => `<li>${esc(e.text)}</li>`).join('');
    return `<header class="order-head"><span class="order-status" data-stage="${esc(t.status)}">${esc(statuses[t.status] || t.status)}</span>
      <h3>${esc(t.title)}</h3><p>${modeName(t.mode)} · 第 ${esc(t.revision)} 稿 · ${esc(skill?.name || '')}</p></header>
      <p class="work-text">${esc(t.goal)}</p>
      <div class="work-roles"><span><small>主理人</small>${esc(person(t.worker_id))}</span></div>
      ${t.feedback ? `<section class="work-sheet"><h4>交回主理人的意见</h4><p class="work-text">${esc(t.feedback)}</p></section>` : ''}
      ${t.question ? `<section class="work-sheet"><h4>待解决的问题</h4><p class="work-text">${esc(t.question)}</p></section>` : ''}
      ${t.error ? `<p class="fine-print warning" role="status">${esc(t.error)}</p>` : ''}
      ${start ? `<button class="primary full" data-task-action="run">${advisorFailed?'重试顾问 · '+esc(advisorName(t.reviewer_id)):t.status==='planted'?'让主理人开工':'重试主理人'}${t.mode==='model'?' · 调用模型':''}</button>` : ''}
      ${t.artifact ? `<section class="work-sheet"><h4>主理人交付</h4><p class="work-text">${esc(t.artifact)}</p></section>` : ''}
      ${old.length ? `<details class="work-trace"><summary>对照之前的稿件（${old.length}）</summary>${old.map(v=>`<section class="work-sheet"><h4>第 ${esc(v.revision)} 稿</h4><p class="work-text">${esc(v.artifact || v.question)}</p></section>`).join('')}</details>` : ''}
      ${consulted.length ? `<details class="work-trace"><summary>查阅求援记录</summary>${consulted.map(c => `<section class="work-sheet"><h4>第 ${esc(c.revision)} 稿 · ${esc(advisorName(c.reviewer_id))}</h4><p>${esc(c.question)}</p>
        <ul>${(c.hints||[]).map(h => `<li><strong>${(c.selected_ids||[]).includes(h.id)?'已回传':'未回传'}</strong> · ${esc(h.text)}</li>`).join('')}</ul></section>`).join('')}</details>` : ''}
      ${resultReady ? '<button class="primary full" data-task-action="harvest">验收并收获现稿</button>' : ''}
      ${guide ? feedbackForm(t, advice, draft) : ''}
      ${guide && t.status !== 'advising' ? adviserForm(t, advice, draft) : ''}
      ${['blocked','failed','interrupted','advised'].includes(t.status) ? '<button class="outline" data-task-action="finish">封存本次记录</button>' : ''}
      ${t.status === 'harvested' ? '<div class="harness-toolbar"><button class="primary" data-work-download>下载成果与工作记录</button><button class="outline" data-forge-work>锻造成技艺</button></div>' : ''}
      ${t.status === 'closed' ? '<button class="outline" data-work-download>下载封存记录</button>' : ''}
      <details class="work-trace" open><summary>工作记录</summary><ol>${events}</ol></details>`;
  }

  function skillMarkdown(s) {
    const name = 'skill-' + s.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    return ['---','name: ' + name, 'description: ' + JSON.stringify(s.description), '---','',
      '# ' + s.name, '', s.instructions, '', '## 可查阅的村务材料', '', ...(s.tools.length ? s.tools.map(k => '- ' + (tools[k] || k)) : ['无需村务数据，由委托人提供材料。']), ''].join('\n');
  }

  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], {type:'text/markdown;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function recordMarkdown(t) {
    const history = (t.history || []).flatMap(v => ['## 第 ' + v.revision + ' 稿', '', v.artifact, '',
      ...(v.question ? ['待解决的问题：' + v.question, ''] : []),
      ...(v.input_hints || []).map(text => '- 已回传：' + text),
      ...(v.feedback ? ['村长补充：' + v.feedback, ''] : []), '']);
    const consultations = (t.consultations || []).flatMap(c => ['## 第 ' + c.revision + ' 稿的独立求援 · ' + advisorName(c.reviewer_id), '', c.question, '',
      ...(c.hints || []).map(h => '- ' + ((c.selected_ids || []).includes(h.id) ? '已回传' : '未回传') + '：' + h.text), '']);
    return ['# ' + t.title, '', modeName(t.mode) + ' · 第 ' + t.revision + ' 稿 · ' + statuses[t.status], '',
      '主理人：' + person(t.worker_id), '', '## 委托', '', t.goal, '', ...history, ...consultations,
      ...(t.error ? ['## 中断原因', '', t.error, ''] : []),
      '## 工作记录', '', ...(t.events || []).map(e => '- ' + e.text), ''].join('\n');
  }

  function updatePicks(root, form) {
    const boxes = [...form.querySelectorAll('[name="hint_ids"]')];
    const selected = boxes.filter(b => b.checked);
    root.draft.picks = new Set(selected.map(b => b.value));
    for (const box of boxes) box.disabled = !box.checked && selected.length >= 3;
    const count = form.querySelector('.hint-count');
    if (count) count.textContent = '已勾选 ' + selected.length + '/3 条';
  }

  async function recordAction(root, action, values) {
    if (!root.task || root.sending) return;
    const task = root.task;
    root.sending = true;
    root.setAttribute('aria-busy', 'true');
    const enabled = [...root.querySelectorAll('[data-task-action]:enabled, form button[type=submit]:enabled')];
    for (const b of enabled) b.disabled = true;
    try {
      await mutate('harness/action', {id:task.id, version:task.version, action, ...values}, {
        run:'已开始处理', harvest:'已收获主理人的交付', finish:'本次委托已封存',
        assist:'问题已交给独立顾问', resume:'所选内容已交回主理人', revise:'已退回，待主理人再次开工',
      }[action]);
    } finally {
      root.sending = false;
      root.removeAttribute('aria-busy');
      for (const b of enabled) if (b.isConnected) b.disabled = false;
    }
  }

  function bind(root) {
    const forgeForm = root.querySelector('[data-forge-form]');
    if (forgeForm) forgeForm.onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(forgeForm);
      const checked = form.getAll('tools');
      if (form.get('instructions').length > 1000) return toast('请先把工作步骤精简到 1000 字以内');
      const result = await mutate('harness/skills', {name:form.get('name'), description:form.get('description'),
        instructions:form.get('instructions'), tools:checked}, '新技艺已收入铁匠铺');
      if (result && root.isConnected) navigate('forge');
    };
    const sow = root.querySelector('[data-sow-form]');
    if (sow) {
      const skillNote = () => {
        const skill = state.harness.skills.find(s => s.id === sow.elements.skill_id.value);
        sow.querySelector('[data-skill-note]').textContent = skill?.description || '';
      };
      sow.elements.mode.onchange = () => { updateAssignments(sow); skillNote(); };
      sow.elements.worker_id.onchange = () => updateAssignments(sow);
      sow.elements.skill_id.onchange = skillNote;
      const lengthNote = sow.querySelector('[data-goal-length]');
      if (lengthNote) sow.elements.goal.oninput = () => { lengthNote.hidden = sow.elements.goal.value.length <= 800; };
      if (chatOrder) sow.elements.mode.value = state.residents.find(r=>r.id===chatOrder.workerId)?.connected ? 'model' : 'local';
      updateAssignments(sow, chatOrder?.workerId);
      skillNote();
      sow.onsubmit = async event => {
        event.preventDefault();
        if (sow.elements.goal.value.length > 800) return toast('请先把委托目标精简到 800 字以内');
        const transferred = chatOrder;
        const result = await mutate('harness/tasks', Object.fromEntries(new FormData(sow)), '委托已播下');
        if (result && chatOrder === transferred) chatOrder = null;
        if (result && root.isConnected) navigate('taskRecord', result.id);
      };
    }
    root.addEventListener('click', async event => {
      const button = event.target.closest('button');
      if (!button || !root.contains(button)) return;
      const task = root.task;
      if (button.hasAttribute('data-discard-chat')) {
        if (sow && sow.elements.goal.value === chatOrder?.goal) sow.elements.goal.value = '';
        sow?.elements.goal.oninput?.();
        chatOrder = null;
        button.closest('.chat-order-note').remove();
        sow?.elements.goal.focus();
        return;
      }
      if (button.dataset.taskRecord) navigate('taskRecord', button.dataset.taskRecord);
      if (button.dataset.skillDownload) {
        const skill = state.harness.skills.find(s => s.id === button.dataset.skillDownload);
        if (skill) download('SKILL.md', skillMarkdown(skill));
      }
      if (button.hasAttribute('data-work-download') && task) download('委托-' + task.id + '.md', recordMarkdown(task));
      if (button.hasAttribute('data-forge-work') && task) {
        forgeDraft = task;
        navigate('skillForge');
      }
      if (button.dataset.taskAction && task) {
        const action = button.dataset.taskAction;
        await recordAction(root, action, {});
      }
    });
    root.addEventListener('input', event => {
      if (!root.draft) return;
      const field = event.target;
      if (field.name === 'feedback' || field.name === 'question') root.draft[field.name] = field.value;
    });
    root.addEventListener('change', event => {
      if (!root.draft) return;
      const field = event.target;
      if (field.name === 'hint_ids') updatePicks(root, field.form);
      if (field.name === 'reviewer_id') root.draft.reviewer = field.value;
    });
    root.addEventListener('submit', async event => {
      const form = event.target;
      const assist = form.hasAttribute('data-assist-form');
      const action = assist ? 'assist' : form.dataset.feedbackAction;
      if (!action) return;
      event.preventDefault();
      const fields = new FormData(form);
      const values = assist ? {question:fields.get('question'), reviewer_id:fields.get('reviewer_id')} :
        {feedback:fields.get('feedback'), hint_ids:fields.getAll('hint_ids')};
      if (values.hint_ids?.length > 3) return toast('每次最多交回三条建议');
      if (root.task?.status === 'advising') return;
      await recordAction(root, action, values);
    });
  }

  function paintRecord(root, slot, task, roster) {
    const sameDraft = root.task?.revision === task.revision;
    const focus = document.activeElement;
    const inForm = sameDraft && focus?.name && root.contains(focus);
    if (!sameDraft) root.draft = {};
    else {
      const invite = root.querySelector('[data-invite]');
      const guidance = root.querySelector('details[data-guidance]');
      if (invite) root.draft.inviteOpen = invite.open;
      if (guidance) root.draft.guidanceOpen = guidance.open;
    }
    slot.innerHTML = taskDetails(task, root.draft);
    root.task = task;
    root.roster = roster;
    if (inForm) {
      const field = [...root.querySelectorAll('form [name]')].find(el => el.name === focus.name &&
        (el.name !== 'hint_ids' || el.value === focus.value));
      if (field && !field.disabled) {
        field.focus({preventScroll:true});
        if (field.tagName === 'TEXTAREA') field.setSelectionRange(focus.selectionStart, focus.selectionEnd);
      }
    }
  }

  async function syncRecord(root, id) {
    const summary = state.harness.tasks.find(t => t.id === id);
    const slot = root.querySelector('[data-record-body]');
    if (root.loading) return;
    const roster = JSON.stringify(state.residents.map(r => [r.id, r.name, r.role, Boolean(r.connected)]));
    if (root.task && root.task.version === summary?.version) {
      if (root.roster !== roster) paintRecord(root, slot, root.task, roster);
      return;
    }
    root.loading = true;
    try {
      const task = await request('harness/task?id=' + encodeURIComponent(id));
      if (!root.isConnected) return;
      if (!root.task || root.task.version !== task.version) {
        paintRecord(root, slot, task, roster);
      }
    } catch (e) {
      if (!root.task && root.isConnected) slot.textContent = e.message;
    } finally {
      root.loading = false;
    }
  }

  function show(view, id) {
    const panel = $('#panel'), h = state.harness;
    $('#panel-kicker').textContent = view === 'forge' || view === 'skillForge' ? '村庄工坊' : '村庄菜园';
    $('#panel-title').textContent = titles[view];
    if (!h) {
      panel.textContent = '当前服务没有载入村庄协作功能。请启动与本页面配套的村庄服务。';
      return;
    }
    const key = view + '/' + (id || '');
    let root = panel.firstElementChild;
    if (!root || root.dataset.harnessPage !== key || (view === 'sowTask' && root.chatOrderVersion !== chatOrderVersion)) {
      root = document.createElement('div');
      root.className = 'harness-page';
      root.dataset.harnessPage = key;
      root.chatOrderVersion = chatOrderVersion;
      panel.replaceChildren(root);
      panel.scrollTop = 0;
      if (view === 'sowTask') root.innerHTML = orderForm();
      if (view === 'skillForge') root.innerHTML = forgeForm();
      if (view === 'taskRecord') root.innerHTML = toolbar(nav('taskBoard','返回委托田')) + '<div data-record-body>正在翻开手记…</div>';
      bind(root);
    }
    if (view === 'skillForge' && shop()?.built) {
      const submit = root.querySelector('[type=submit]');
      if (submit) submit.disabled = false;
    }
    if (view === 'taskRecord') {
      syncRecord(root, id);
    } else if (view === 'forge' || view === 'taskBoard' || view === 'workArchive') {
      const identity = state.residents.map(r => [r.id,r.name]);
      const signature = JSON.stringify([h.revision,identity,Boolean(shop()?.built),Boolean(shop()?.constructing),Boolean(garden()?.built),view === 'taskBoard' && Boolean(chatOrder)]);
      if (root.dataset.revision !== signature) {
        const openSkills = [...root.querySelectorAll('details[open] [data-skill-download]')].map(b => b.dataset.skillDownload);
        root.innerHTML = view === 'forge' ? forge(h) : board(h, view === 'workArchive');
        for (const button of root.querySelectorAll('[data-skill-download]')) {
          if (openSkills.includes(button.dataset.skillDownload)) button.closest('details').open = true;
        }
        root.dataset.revision = signature;
      }
    }
  }
  return {handles, show, skillMarkdown, openOrderFromChat};
})();
