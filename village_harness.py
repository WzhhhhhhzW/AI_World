"""Player-directed work orders, scoped village tools and optional independent advice."""
import copy
import json
import time
import uuid

from world_governance import parse_object


TOOL_LABELS = {"materials": "物资", "buildings": "建筑", "farm": "农田", "roster": "居民"}
STARTER = {
    "id": "village-inventory", "name": "村务盘点", "description": "读取物资与建筑，整理一份可核对的盘点单。",
    "instructions": "清点木材、石料和作物，区分已建成、施工中和待建建筑。注明依据与数据取样时刻。",
    "tools": ["materials", "buildings"],
}
RECORD_REVIEW = {
    "id": "contest-record-review", "name": "赛题记录复核",
    "description": "把 x-kernel / Chromium 的测量记录粘贴到任务目标，整理实测结论与待验证项目。",
    "instructions": "从用户给出的原始记录提取平台、内核、测试页、测量方法、次数与结果。逐项标明实测证据和待验证事项。"
                    "只用所给记录，避免猜测性能或判定通过。缺少支撑所问结论的关键证据时，说明具体缺少哪项记录。",
    "tools": [],
}
INDEX_FIELDS = ("id", "title", "mode", "worker_id", "reviewer_id", "skill_id", "status", "revision", "version")
MAX_REVISION = 3
MAX_ADVISORS = 3
MAX_SELECTED_HINTS = 3


def field(data, key, limit, label, optional=False):
    value = data.get(key, "")
    if not isinstance(value, str) or len(value.strip()) > limit or (not optional and not value.strip()):
        raise ValueError(f"{label}需为{'0' if optional else '1'}–{limit}个字符")
    return value.strip()


def note(task, text):
    task["events"].append({"time": time.time(), "text": text})
    del task["events"][:-50]


def tool_readings(state, tools):
    """Snapshot only the selected public facts, without copying conversations or model profiles."""
    out = {}
    for tool in tools:
        if tool == "materials":
            out[tool] = {key: state["resources"][key] for key in ("wood", "stone", "crops")}
        elif tool == "buildings":
            out[tool] = [{"name": b["name"], "state": "已建成" if b["built"] else
                          "施工中" if b.get("constructing") else "待建", "cost": dict(b["cost"])}
                         for b in state["buildings"]]
        elif tool == "farm":
            out[tool] = {"inventory": dict(state["farm"]["inventory"]),
                         "plots": [p["crop"] for p in state["farm"]["plots"]]}
        elif tool == "roster":
            out[tool] = [{"name": r["name"], "role": r["role"]} for r in state["residents"]]
    return out


def fact_lines(snapshot):
    lines = []
    for key, value in snapshot.items():
        if key == "materials":
            text = f"木材 {value['wood']}，石料 {value['stone']}，作物 {value['crops']}。"
        elif key == "buildings":
            text = "、".join(f"{b['name']}（{b['state']}）" for b in value)
        elif key == "farm":
            planted = sum(crop is not None for crop in value["plots"])
            stock = value["inventory"]
            text = f"已播种 {planted}/{len(value['plots'])} 块田，库存白菜 {stock['cabbage']}、萝卜 {stock['radish']}、杂粮 {stock['mixed']}。"
        else:
            text = "、".join(f"{r['name']}（{r['role']}）" for r in value)
        lines.append(f"{TOOL_LABELS[key]}：{text}")
    return lines


def local_advice(snapshot, role):
    hints = []
    if role == "学者":
        hints.append("把可以从取样读数直接验证的结论单列，并写出各项结论对应的读数。")
    elif role == "园丁" and "materials" in snapshot:
        hints.append(f"物资栏有作物 {snapshot['materials']['crops']} 份；把现有库存与之后可能收获的产量分开记录。")
    elif role == "探索者":
        hints.append("标记这次取样没有覆盖的项目；下次核查时只补读这些缺项。")
    elif role == "规划师" and "buildings" in snapshot:
        planned = sum(b["state"] == "待建" for b in snapshot["buildings"])
        hints.append(f"单列 {planned} 项待建工程，核算用料时先确认本轮计划开建哪一项。")
    if "materials" in snapshot and "buildings" in snapshot:
        stock = snapshot["materials"]
        for building in snapshot["buildings"]:
            if building["state"] == "待建":
                cost = building["cost"]
                wood, stone = max(0, cost["wood"] - stock["wood"]), max(0, cost["stone"] - stock["stone"])
                hints.append(f"若开建{building['name']}，需木材 {cost['wood']}、石料 {cost['stone']}；按采样库存，分别还缺 {wood} 和 {stone}。")
                break
    if "buildings" in snapshot:
        total = len(snapshot["buildings"])
        complete = sum(b["state"] == "已建成" for b in snapshot["buildings"])
        hints.append(f"明确统计口径：{total} 座规划建筑中已建成 {complete} 座，其余 {total-complete} 座含工地与待建地。")
    if "farm" in snapshot:
        empty = snapshot["farm"]["plots"].count(None)
        hints.append(f"比较库存与后续产能时，单列这 {empty} 块当前还未播种的田。")
    if "roster" in snapshot:
        roles = {r["role"] for r in snapshot["roster"]}
        hints.append(f"盘点人力时区分人数与职业数；采样时共有 {len(roles)} 种职业。")
    hints.append("附上采样时刻；走动、施工和入库会让稍后看到的数值变化。")
    return hints[:3]


def local_draft(task):
    lines = [f"# {task['title']}", "", f"任务备注：{task['goal']}",
             f"取样时刻：村庄时钟 {task['snapshot_clock']} 分", *fact_lines(task["snapshot"])]
    if task["input_hints"]:
        lines.extend(["", "本版采纳的补充", *task["input_hints"]])
    if task["feedback"]:
        lines.extend(["", "村长附注：" + task["feedback"]])
    return "done", "\n".join(lines), ""


def model_draft(world, task, skill):
    previous = task["history"][-1] if task["history"] else {}
    context = {"任务": task["title"], "目标": task["goal"], "技能步骤": skill["instructions"],
               "上一版自己的稿件": previous.get("artifact", ""), "原卡点": previous.get("question", ""),
               "村长补充": task["feedback"], "村长挑选的提示": task["input_hints"]}
    if task["snapshot"]:
        context.update(取样时刻=task["snapshot_clock"], 所选工具的读数=task["snapshot"])
    prompt = ("独立完成任务，信息足够请直接交付。只有确实缺少继续工作所需的信息时才报告具体卡点。"
              "返回 JSON 对象，status 为 done 或 blocked，artifact 是成果正文（最多2000字，遇阻可保留部分稿），"
              "question 是卡点（最多300字，完成时留空）。工具读数来自同一快照。\n"
              + json.dumps(context, ensure_ascii=False, separators=(",", ":")))
    if len(prompt) > 7000:
        raise ValueError("本轮输入超过居民上下文限额，请精简技能或任务材料")
    answer = world.ask(task["worker_id"], f"主办 · {task['title']}", prompt, cap=1000, isolated=True)
    try:
        obj = parse_object(answer)
        status = obj.get("status")
        if status not in ("done", "blocked"):
            raise ValueError()
        artifact = field(obj, "artifact", 2000, "成果", optional=status == "blocked")
        question = field(obj, "question", 300, "卡点", optional=status == "done")
        return status, artifact, question if status == "blocked" else ""
    except (ValueError, TypeError, RecursionError):
        raise ValueError("主办回复不符合交付格式，本轮用量已按服务返回值处理") from None


def model_advice(world, task):
    # The advisor never receives draft text, skill instructions, turn history or earlier advice.
    context = {"任务": task["title"], "原始目标": task["goal"], "本次请教的问题": task["consult_question"]}
    if task["snapshot"]:
        context.update(取样时刻=task["snapshot_clock"], 相关事实=fact_lines(task["snapshot"]))
    prompt = ("独立检查这个具体问题的盲点。给出最多3条可单独采用的提示，每条最多120字。"
              "避免代写全文。只返回 JSON 对象，hints 字段为字符串数组。\n"
              + json.dumps(context, ensure_ascii=False, separators=(",", ":")))
    answer = world.ask(task["reviewer_id"], f"独立请教 · {task['title']}", prompt, cap=480, isolated=True)
    try:
        values = parse_object(answer).get("hints")
        if not isinstance(values, list) or not 1 <= len(values) <= 3:
            raise ValueError()
        hints = [field({"hint": h}, "hint", 120, "提示") for h in values]
        if len(set(hints)) != len(hints):
            raise ValueError()
        return hints
    except (ValueError, TypeError, RecursionError):
        raise ValueError("顾问回复不符合提示格式，本轮用量已按服务返回值处理") from None


class VillageHarness:
    def init_harness(self):
        h = self.s.setdefault("harness", {"revision": 0, "skills": [copy.deepcopy(STARTER)], "tasks": []})
        if not any(s["id"] == RECORD_REVIEW["id"] for s in h["skills"]):
            h["skills"].append(copy.deepcopy(RECORD_REVIEW))
            h["revision"] += 1
        for task in h["tasks"]:
            migrated = "advisor_ids" not in task
            if migrated:
                # A legacy revision could consult only one resident. The last
                # reviewer field can't identify a consultation in an older revision.
                reviewer = task["reviewer_id"] if task["stage"] == "advisor" else ""
                task["advisor_ids"] = [reviewer] if reviewer else []
                if reviewer:
                    for entry in task["consultations"]:
                        if entry["revision"] == task["revision"]:
                            entry["reviewer_id"] = reviewer
                            for hint in entry["hints"]:
                                hint["reviewer_id"] = reviewer
                    for hint in task["hints"]:
                        hint["reviewer_id"] = reviewer
            if task["status"] in ("working", "advising"):
                if task["stage"] == "advisor" and task["reviewer_id"] not in task["advisor_ids"]:
                    task["advisor_ids"].append(task["reviewer_id"])
                task.update(status="interrupted", error="服务已重启，请核对账本，再决定是否重试本阶段。")
                note(task, task["error"])
                migrated = True
            if migrated:
                task["version"] += 1
                h["revision"] += 1

    def harness_index(self):
        with self.lock:
            h = self.s["harness"]
            return {"revision": h["revision"], "skills": copy.deepcopy(h["skills"]),
                    "tasks": [{key: t[key] for key in INDEX_FIELDS} for t in h["tasks"]]}

    def _record(self, group, record_id):
        for record in self.s["harness"][group]:
            if record["id"] == record_id:
                return record
        raise ValueError("未找到这份技能或任务")

    def harness_task(self, task_id):
        with self.lock:
            return copy.deepcopy(self._record("tasks", task_id))

    def _require_building(self, building_id, label):
        if not any(b["id"] == building_id and b["built"] for b in self.s["buildings"]):
            raise ValueError(f"{label}尚未建成")

    def _insert_record(self, group, record):
        h = self.s["harness"]
        h[group].insert(0, record)
        h["revision"] += 1
        try:
            self.save()
        except Exception:
            h[group].pop(0)
            h["revision"] -= 1
            raise
        return record["id"]

    def forge_skill(self, data):
        name = field(data, "name", 40, "技能名称")
        desc = field(data, "description", 160, "用途")
        body = field(data, "instructions", 1000, "技能步骤")
        tools = data.get("tools", ["materials", "buildings"])
        if (not isinstance(tools, list) or len(tools) > len(TOOL_LABELS) or
                any(not isinstance(t, str) or t not in TOOL_LABELS for t in tools) or len(set(tools)) != len(tools)):
            raise ValueError("村务工具名称无效或重复")
        with self.lock:
            self._require_building("workshop", "工坊")
            if any(s["name"] == name for s in self.s["harness"]["skills"]):
                raise ValueError("已有同名技能，请为新技能另取名字")
            return self._insert_record("skills", {"id": uuid.uuid4().hex[:12], "name": name, "description": desc,
                                                  "instructions": body, "tools": tools[:]})

    def plant_task(self, data):
        title = field(data, "title", 80, "标题")
        goal = field(data, "goal", 800, "目标")
        mode = data.get("mode")
        if mode not in ("local", "model"):
            raise ValueError("请选择本地演练或真实模型")
        with self.lock:
            self._require_building("farm", "菜园")
            worker = self.resident(data.get("worker_id"))["id"]
            advisor = data.get("reviewer_id") or ""
            if advisor:
                self.resident(advisor)
                if worker == advisor:
                    raise ValueError("请另选一位独立顾问，或暂时留空")
            skill = self._record("skills", data.get("skill_id"))
            if mode == "local" and not skill["tools"]:
                raise ValueError("本地演练用于盘点，请选择包含村务读数的技能；纯文本技能可用真实模型执行")
            task = {"id": uuid.uuid4().hex[:12], "title": title, "goal": goal, "mode": mode,
                    "worker_id": worker, "reviewer_id": advisor, "skill_id": skill["id"],
                    "status": "planted", "revision": 1, "version": 0, "stage": "primary", "snapshot": {},
                    "snapshot_clock": None, "artifact": "", "question": "", "review": "", "feedback": "",
                    "consult_question": "", "error": "", "hints": [], "input_hints": [],
                    "history": [], "consultations": [], "advisor_ids": [], "events": []}
            note(task, "任务已播下，等待主办居民动工。")
            return self._insert_record("tasks", task)

    def _commit_task(self, updated, start=None):
        """Caller holds the village lock. The worker starts only after _spawn saves its claimed stage."""
        h = self.s["harness"]
        i = next(i for i, task in enumerate(h["tasks"]) if task["id"] == updated["id"])
        original = h["tasks"][i]
        updated["version"] = original["version"] + 1
        h["tasks"][i] = updated
        h["revision"] += 1
        try:
            if start:
                self._spawn(start, lambda: self._perform_stage(updated["id"]))
            else:
                self.save()
        except Exception:
            h["tasks"][i] = original
            h["revision"] -= 1
            if start:
                self.save()
            raise

    def _schedule_stage(self, task):
        advisor = task["stage"] == "advisor"
        actor = self.resident(task["reviewer_id"] if advisor else task["worker_id"])
        if task["mode"] == "model" and not self.model_ready(actor):
            raise ValueError(f"请先给{actor['name']}配置可用的模型服务")
        if self.s["busy"]:
            raise ValueError("当前有居民正在处理任务，请稍候")
        if task["snapshot_clock"] is None:
            skill = self._record("skills", task["skill_id"])
            task["snapshot"] = tool_readings(self.s, skill["tools"])
            task["snapshot_clock"] = self.s["clock"]
        task.update(status="advising" if advisor else "working", error="")
        name = actor["name"] + ("独立查看卡点" if advisor else f"撰写第 {task['revision']} 版")
        note(task, name + ("（本地规则演练）" if task["mode"] == "local" else "（模型调用）"))
        self._commit_task(task, start=name)

    def _perform_stage(self, task_id):
        task = self.harness_task(task_id)
        try:
            if task["stage"] == "advisor":
                reviewer = task["reviewer_id"]
                if task["mode"] == "local":
                    hints = local_advice(task["snapshot"], self.resident(reviewer)["role"])
                else:
                    hints = model_advice(self, task)
                # Ids are opaque to callers. Revision and per-revision seat
                # give each new hint a distinct ID even across retries or reloads.
                seat = task["advisor_ids"].index(reviewer) + 1
                new_hints = [{"id": f"{task['id']}-{task['revision']}-{seat}-{n}",
                              "text": text, "reviewer_id": reviewer} for n, text in enumerate(hints, 1)]
                task["hints"].extend(new_hints)
                task["consultations"].append({"revision": task["revision"], "reviewer_id": reviewer,
                                              "question": task["consult_question"],
                                              "hints": copy.deepcopy(new_hints), "selected_ids": []})
                task["status"] = "advised"
                note(task, f"收到 {len(hints)} 条独立提示，等待村长挑选。")
            else:
                skill = self._record("skills", task["skill_id"])
                if task["mode"] == "local":
                    result, artifact, question = local_draft(task)
                else:
                    result, artifact, question = model_draft(self, task, skill)
                task.update(status="ready" if result == "done" else "blocked", artifact=artifact, question=question)
                task["history"].append({"revision": task["revision"], "artifact": artifact, "question": question,
                                        "status": task["status"], "feedback": task["feedback"],
                                        "input_hints": task["input_hints"][:]})
                note(task, "主办已交稿，等待村长收获。" if result == "done" else "主办报告卡点，等待村长决定下一步。")
        except Exception as exc:
            task.update(status="failed", error=str(exc) if isinstance(exc, ValueError) else "本阶段中断，进度已保留。")
            note(task, task["error"])
        with self.lock:
            self._commit_task(task)

    def task_action(self, data):
        with self.lock:
            task = self.harness_task(data.get("id"))
            if type(data.get("version")) is not int or data["version"] != task["version"]:
                raise ValueError("任务刚有更新，请查看最新进度")
            action, status = data.get("action"), task["status"]
            failed = status in ("failed", "interrupted")
            if action == "run" and (status == "planted" or failed):
                self._schedule_stage(task)
            elif action == "assist" and (status in ("ready", "blocked", "advised") or
                                         (failed and task["stage"] == "advisor")):
                if task["revision"] >= MAX_REVISION:
                    raise ValueError("本任务已用完两次修订机会")
                supplied = data.get("reviewer_id")
                if supplied is not None and not isinstance(supplied, str):
                    raise ValueError("顾问标识无效")
                advisor = supplied or task["reviewer_id"]
                if not advisor or advisor == task["worker_id"]:
                    raise ValueError("请指定一位不同于主办的顾问")
                self.resident(advisor)
                if advisor in task["advisor_ids"]:
                    raise ValueError("本版已请教过这位顾问，请另选居民")
                if len(task["advisor_ids"]) >= MAX_ADVISORS:
                    raise ValueError("每版最多请教三位不同的顾问")
                previous_issue = task["consult_question"] if task["advisor_ids"] else ""
                question = field(data, "question", 400, "请教的问题", optional=True) or previous_issue or task["question"]
                if not question:
                    raise ValueError("请指出希望顾问独立检查的具体问题")
                task["advisor_ids"].append(advisor)
                task.update(stage="advisor", reviewer_id=advisor, consult_question=question)
                self._schedule_stage(task)
            elif ((action == "revise" and status == "ready") or
                  (action == "resume" and (status in ("blocked", "advised") or (failed and task["stage"] == "advisor")))):
                if task["revision"] >= MAX_REVISION:
                    raise ValueError("本任务已用完两次修订机会")
                feedback = field(data, "feedback", 600, "村长补充", optional=action == "resume" and status != "blocked")
                selected = data.get("hint_ids", [])
                available = {hint["id"]: hint["text"] for hint in task["hints"]}
                if (not isinstance(selected, list) or len(selected) > MAX_SELECTED_HINTS
                        or any(not isinstance(h, str) or h not in available for h in selected)
                        or len(set(selected)) != len(selected)):
                    raise ValueError("请从本版顾问提示中选择最多三条不同的提示")
                for entry in task["consultations"]:
                    if entry["revision"] == task["revision"]:
                        own_ids = {hint["id"] for hint in entry["hints"]}
                        entry["selected_ids"] = [hint_id for hint_id in selected if hint_id in own_ids]
                task.update(stage="primary", revision=task["revision"] + 1, input_hints=[available[h] for h in selected],
                            feedback=feedback, hints=[], consult_question="", advisor_ids=[], error="", status="planted")
                if action == "resume":
                    self._schedule_stage(task)
                else:
                    note(task, "收到村长的修改意见，等待主办再次动工。")
                    self._commit_task(task)
            elif action == "harvest" and (status == "ready" or
                    ((status == "advised" or (failed and task["stage"] == "advisor"))
                     and task["history"] and task["history"][-1]["status"] == "ready")):
                task["status"] = "harvested"
                note(task, "村长已验收并收获主办的成果。")
                self._commit_task(task)
            elif action == "finish" and status in ("blocked", "failed", "interrupted", "advised"):
                task["status"] = "closed"
                note(task, "村长结束任务，已保存现有进度。")
                self._commit_task(task)
            else:
                raise ValueError("当前任务阶段无法执行这项操作")
            return task["id"]
