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

  function board(h, archive = false) {
    const records = archive ? h.tasks.filter(t => ['closed','harvested'].includes(t.status)) : h.tasks;
    const tasks = records.map(t => `<button type="button" class="work-order" data-task-record="${esc(t.id)}">
      <span><strong>${esc(t.title)}</strong><small>${modeName(t.mode)} · ${esc(person(t.worker_id))} 主理 · 第 ${esc(t.revision)} 稿</small></span>
      <b class="order-status" data-stage="${esc(t.status)}">${esc(statuses[t.status] || t.status)}</b></button>`).join('');
    if (archive) return toolbar(nav('taskBoard','返回委托田')) + (tasks || '<p class="fine-print">验收或封存的委托会收入这里。</p>');
    return toolbar(nav('farm','打理菜田') + nav('forge','去铁匠铺') + nav('workArchive','查看案卷')) +
      `<div class="field-actions"><p>选一份技艺，交给一位主理人。有疑问时，你可以请另一位村民单独找盲点。</p>
      ${garden()?.built ? '<button type="button" class="primary" data-go="sowTask">＋ 播下委托</button>' : '<button class="outline" data-building="farm">查看菜园建设</button>'}</div>
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
      <label>协作方式<select name="mode"><option value="local">本地实习 · 村务盘点</option><option value="model">真实模型 · 自由委托</option></select></label>
      <p class="fine-print" data-mode-note></p>
      <label>委托名称<input name="title" required maxlength="80" value="村庄开工前盘点"></label>
      <label><span data-goal-label>盘点备注</span><textarea name="goal" rows="3" required maxlength="800">交一份最新的村务盘点单，列出下一步要留意的事项。</textarea></label>
      <label>携带技艺<select name="skill_id" required></select></label>
      <p class="fine-print" data-skill-note></p>
      <label>主理人<select name="worker_id" required></select></label>
      <p class="fine-print" data-connection-note></p>
      <button class="primary full" type="submit">把委托种到田里</button></form>`;
  }

  function updateAssignments(form) {
    const fields = form.elements;
    const real = fields.mode.value === 'model';
    const residents = state.residents.filter(r => !real || r.connected);
    const skills = state.harness.skills.filter(s => real || s.tools.length);
    const current = fields.skill_id.value;
    fields.skill_id.innerHTML = skills.map(s => `<option value="${esc(s.id)}" ${s.id===current?'selected':''}>${esc(s.name)}</option>`).join('');
    const choices = (list, id) => list.map(r => `<option value="${esc(r.id)}" ${r.id===id?'selected':''}>${esc(r.name)} · ${esc(r.role)}</option>`).join('');
    fields.worker_id.innerHTML = choices(residents, fields.worker_id.value);
    const enough = residents.length >= 1;
    form.querySelector('[type=submit]').disabled = !enough;
    form.querySelector('[data-goal-label]').textContent = real ? '交付目标与验收要求' : '盘点备注';
    form.querySelector('[data-mode-note]').textContent = real
      ? '主理人依据委托和所选技艺独立交稿或说明卡点。开工会调用一次模型，求援和修订由你另行决定。'
      : '程序按技艺选定的数据项生成盘点单，备注随单保存。实习中的主理与求援均由本地规则执行，无需密钥或 Token。';
    form.querySelector('[data-connection-note]').textContent = enough
      ? '' : '请先从地图打开一位居民的「API 接入设置」，或选择本地实习。';
  }

  function adviserForm(t) {
    const peers = state.residents.filter(r => r.id !== t.worker_id && (t.mode === 'local' || r.connected));
    if (!peers.length) return '<p class="fine-print">如要求援，请先为另一位村民配置模型。</p>';
    return `<details class="work-trace"><summary>找另一位村民看盲点</summary>
      <form class="work-form" data-assist-form><p class="fine-print">顾问只收到委托、这条问题和精简材料。初稿、主理人的过程和聊天记录都留在这边。</p>
      <label>顾问<select name="reviewer_id" required>${peers.map(r => `<option value="${esc(r.id)}" ${r.id === t.reviewer_id ? 'selected' : ''}>${esc(r.name)} · ${esc(r.role)}</option>`).join('')}</select></label>
      <label>请顾问独立看什么<textarea name="question" maxlength="400" required rows="2" placeholder="只描述尚未解决的问题">${esc(t.status === 'blocked' ? t.question : '')}</textarea></label>
      <button class="outline" type="submit">${t.mode === 'model' ? '请顾问独立判断 · 调用模型' : '实习 · 查看规则提示'}</button></form></details>`;
  }

  function feedbackForm(t) {
    const advised = t.status === 'advised';
    const hints = advised ? (t.hints || []) : [];
    const revise = t.status === 'ready';
    const label = advised ? '也可补充自己的意见' : '给主理人的补充';
    const controls = hints.map(h => `<label><input type="checkbox" name="hint_ids" value="${esc(h.id)}"><span>${esc(h.text)}</span></label>`).join('');
    return `<${advised?'section':'details'} class="work-trace work-guidance">
      ${advised ? '<h4>顾问独立建议</h4><p class="fine-print">只将勾选的建议和你的补充交回主理人。也可以全部略过。</p>' : `<summary>${revise?'让主理人修改':'直接补充线索'}</summary>`}
      <form class="work-form" data-feedback-action="${revise?'revise':'resume'}">
      ${controls ? `<fieldset class="hint-checks"><legend>选择回传内容</legend>${controls}</fieldset>` : ''}
      <label>${label}<textarea name="feedback" maxlength="600" rows="2" ${advised?'':'required'}></textarea></label>
      <button class="outline" type="submit">${revise ? '退回待开工' : '交回主理人继续' }${!revise && t.mode === 'model' ? ' · 调用模型' : ''}</button>
      </form></${advised?'section':'details'}>`;
  }

  function taskDetails(t) {
    const skill = state.harness.skills.find(s => s.id === t.skill_id);
    const start = ['planted','failed','interrupted'].includes(t.status);
    const past = t.history || [];
    const consulted = (t.consultations || []).filter(c => t.status !== 'advised' || c.revision !== t.revision);
    const old = past.filter(v => v.revision < t.revision);
    const lastResult = past.find(v => v.revision === t.revision) || past[past.length-1];
    const advisorFailed = ['failed','interrupted'].includes(t.status) && t.stage === 'advisor';
    const resultReady = t.status === 'ready' || ((t.status === 'advised' || advisorFailed) && lastResult?.status === 'ready');
    const canGuide = t.revision < 3;
    const events = t.events.map(e => `<li>${esc(e.text)}</li>`).join('');
    return `<header class="order-head"><span class="order-status" data-stage="${esc(t.status)}">${esc(statuses[t.status] || t.status)}</span>
      <h3>${esc(t.title)}</h3><p>${modeName(t.mode)} · 第 ${esc(t.revision)} 稿 · ${esc(skill?.name || '')}</p></header>
      <p class="work-text">${esc(t.goal)}</p>
      <div class="harness-pair work-roles"><span><small>主理人</small>${esc(person(t.worker_id))}</span>${t.reviewer_id ? `<span><small>顾问</small>${esc(person(t.reviewer_id))}</span>` : ''}</div>
      ${t.feedback ? `<section class="work-sheet"><h4>交回主理人的意见</h4><p class="work-text">${esc(t.feedback)}</p></section>` : ''}
      ${t.question ? `<section class="work-sheet"><h4>待解决的问题</h4><p class="work-text">${esc(t.question)}</p></section>` : ''}
      ${t.error ? `<p class="fine-print warning" role="status">${esc(t.error)}</p>` : ''}
      ${start ? `<button class="primary full" data-task-action="run">${t.status==='planted'?'让村民开工':'继续这份委托'}${t.mode==='model'?' · 调用模型':''}</button>` : ''}
      ${t.artifact ? `<section class="work-sheet"><h4>主理人交付</h4><p class="work-text">${esc(t.artifact)}</p></section>` : ''}
      ${old.length ? `<details class="work-trace"><summary>对照之前的稿件（${old.length}）</summary>${old.map(v=>`<section class="work-sheet"><h4>第 ${esc(v.revision)} 稿</h4><p class="work-text">${esc(v.artifact || v.question)}</p></section>`).join('')}</details>` : ''}
      ${consulted.length ? `<details class="work-trace"><summary>查阅求援记录</summary>${consulted.map(c => `<section class="work-sheet"><h4>第 ${esc(c.revision)} 稿 · ${esc(c.question)}</h4>
        <ul>${c.hints.map(h => `<li>${c.selected_ids.includes(h.id)?'已回传':'未回传'} · ${esc(h.text)}</li>`).join('')}</ul></section>`).join('')}</details>` : ''}
      ${resultReady ? '<button class="primary full" data-task-action="harvest">验收并收获现稿</button>' : ''}
      ${canGuide && (['ready','blocked','advised'].includes(t.status) || advisorFailed) ? feedbackForm(t) : ''}
      ${canGuide && ['ready','blocked'].includes(t.status) ? adviserForm(t) : ''}
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
    const history = t.history.flatMap(v => ['## 第 ' + v.revision + ' 稿', '', v.artifact, '',
      ...(v.question ? ['待解决的问题：' + v.question, ''] : []),
      ...v.input_hints.map(text => '- 已回传：' + text),
      ...(v.feedback ? ['村长补充：' + v.feedback, ''] : []), '']);
    const consultations = t.consultations.flatMap(c => ['## 第 ' + c.revision + ' 稿的独立求援', '', c.question, '',
      ...c.hints.map(h => '- ' + (c.selected_ids.includes(h.id) ? '已回传' : '未回传') + '：' + h.text), '']);
    return ['# ' + t.title, '', modeName(t.mode) + ' · 第 ' + t.revision + ' 稿 · ' + statuses[t.status], '',
      '主理人：' + person(t.worker_id), '', '## 委托', '', t.goal, '', ...history, ...consultations,
      ...(t.error ? ['## 中断原因', '', t.error, ''] : []),
      '## 工作记录', '', ...t.events.map(e => '- ' + e.text), ''].join('\n');
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
      updateAssignments(sow);
      skillNote();
      sow.onsubmit = async event => {
        event.preventDefault();
        const result = await mutate('harness/tasks', Object.fromEntries(new FormData(sow)), '委托已播下');
        if (result && root.isConnected) navigate('taskRecord', result.id);
      };
    }
    root.addEventListener('click', async event => {
      const button = event.target.closest('button');
      if (!button || !root.contains(button)) return;
      const task = root.task;
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
        await mutate('harness/action', {id:task.id, version:task.version, action}, {run:'委托已开工',harvest:'已收获主理人的交付',finish:'本次委托已封存'}[action]);
      }
    });
    root.addEventListener('submit', async event => {
      const form = event.target;
      const assist = form.hasAttribute('data-assist-form');
      const action = assist ? 'assist' : form.dataset.feedbackAction;
      if (!action) return;
      event.preventDefault();
      const task = root.task;
      const fields = new FormData(form);
      const values = assist ? {question:fields.get('question'), reviewer_id:fields.get('reviewer_id')} :
        {feedback:fields.get('feedback'), hint_ids:fields.getAll('hint_ids')};
      await mutate('harness/action', {id:task.id, version:task.version, action, ...values},
        {assist:'求援问题已交给顾问',resume:'选中的材料已交回主理人',revise:'已退回，再次开工后会准备下一稿'}[action]);
    });
  }

  async function syncRecord(root, id) {
    const summary = state.harness.tasks.find(t => t.id === id);
    if (root.loading || (root.task && root.task.version === summary?.version)) return;
    root.loading = true;
    const slot = root.querySelector('[data-record-body]');
    try {
      const task = await request('harness/task?id=' + encodeURIComponent(id));
      if (!root.isConnected) return;
      if (!root.task || root.task.version !== task.version) {
        slot.innerHTML = taskDetails(task);
        root.task = task;
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
    if (!root || root.dataset.harnessPage !== key) {
      root = document.createElement('div');
      root.className = 'harness-page';
      root.dataset.harnessPage = key;
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
      const signature = JSON.stringify([h.revision,identity,Boolean(shop()?.built),Boolean(shop()?.constructing),Boolean(garden()?.built)]);
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
  return {handles, show, skillMarkdown};
})();
