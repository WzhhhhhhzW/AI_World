"""Vegetable beds and the communal pantry. Growth uses the persisted village clock."""
import copy
from contextlib import contextmanager


# The running village advances four clock minutes per real second.
CROPS = {
    "cabbage": {"name": "白菜", "seconds": 120, "tokens": 500},
    "radish": {"name": "萝卜", "seconds": 300, "tokens": 1000},
    "mixed": {"name": "杂粮", "seconds": 0, "tokens": 500},
}


def empty_plot(version=0):
    return {"crop": None, "ready_at": None, "gardener": False, "version": version}


def payment_plan(stock, deficit):
    """Cover a shortfall in whole items, minimizing excess credit and then item count."""
    needed = (max(0, deficit) + 499) // 500
    radishes = min(stock["radish"], needed // 2)
    needed -= 2 * radishes
    mixed = min(stock["mixed"], needed)
    cabbages = min(stock["cabbage"], needed - mixed)
    if needed > mixed + cabbages:
        if needed != mixed + cabbages + 1 or radishes >= stock["radish"]:
            return None
        radishes += 1
    return {k: v for k, v in (("radish", radishes), ("mixed", mixed), ("cabbage", cabbages)) if v}


class KitchenGarden:
    def init_farm(self):
        if "farm" not in self.s:
            self.s["farm"] = {
                "plots": [empty_plot() for _ in range(6)],
                "inventory": {"cabbage": 0, "radish": 0, "mixed": self.s["resources"]["crops"]},
                "stock_version": 0,
            }

    @contextmanager
    def farm_changes(self, resident=None):
        """Roll back just this transaction, under the village lock, if the atomic save fails."""
        farm = copy.deepcopy(self.s["farm"])
        events = self.s["events"][:]
        ledger_length = len(self.s["ledger"])
        if resident is not None:
            budget, reserved = resident["budget"], resident["reserved"]
        try:
            yield
            self.save()
        except Exception:
            self.s["farm"] = farm
            self.s["resources"]["crops"] = sum(farm["inventory"].values())
            self.s["events"] = events
            del self.s["ledger"][ledger_length:]
            if resident is not None:
                resident["budget"], resident["reserved"] = budget, reserved
            raise

    def stock_change(self, crop, delta):
        farm = self.s["farm"]
        farm["inventory"][crop] += delta
        farm["stock_version"] += 1
        self.s["resources"]["crops"] = sum(farm["inventory"].values())

    def water(self, plot):
        plot["ready_at"] = self.s["clock"] + CROPS[plot["crop"]]["seconds"] * 4
        plot["version"] += 1

    def tend_plot(self, data):
        with self.lock:
            if not any(b["id"] == "farm" and b["built"] for b in self.s["buildings"]):
                raise ValueError("菜园尚未建成")
            plots = self.s["farm"]["plots"]
            i, version = data.get("plot"), data.get("version")
            if type(i) is not int or not 0 <= i < len(plots):
                raise ValueError("请选择一块菜地")
            p = plots[i]
            if type(version) is not int or version != p["version"]:
                raise ValueError("这块田刚有变化，请查看最新状态")
            action = data.get("action")
            with self.farm_changes():
                if action == "plant":
                    crop = data.get("crop")
                    if p["crop"] or crop not in ("cabbage", "radish"):
                        raise ValueError("请在空地播下白菜或萝卜种子")
                    p.update(crop=crop, version=version+1)
                elif action == "water":
                    if not p["crop"] or p["ready_at"] is not None:
                        raise ValueError("只有刚播种的菜地需要浇水")
                    self.water(p)
                elif action == "harvest":
                    if p["ready_at"] is None or self.s["clock"] < p["ready_at"]:
                        raise ValueError("作物尚未成熟")
                    self.stock_change(p["crop"], 1)
                    plots[i] = empty_plot(version+1)
                else:
                    raise ValueError("未知的农事操作")

    def gardener_work(self, r):
        # Leave five beds free for the player. The gardener only harvests their own sowing.
        if not any(b["id"] == "farm" and b["built"] for b in self.s["buildings"]):
            return
        p = self.s["farm"]["plots"][-1]
        if not p["crop"]:
            crop = "cabbage" if self.s["farm"]["inventory"]["cabbage"] <= self.s["farm"]["inventory"]["radish"] else "radish"
            p.update(crop=crop, gardener=True, version=p["version"]+1)
            r["activity"] = "在共耕田播种"
        elif p["ready_at"] is None:
            self.water(p)
            r["activity"] = "给共耕田浇水"
        elif p["gardener"] and self.s["clock"] >= p["ready_at"]:
            r.update(cargo={"kind": "crops", "crop": p["crop"], "amount": 1}, phase="deliver", activity="送蔬菜入仓", path=[])
            self.s["farm"]["plots"][-1] = empty_plot(p["version"]+1)

    def credit_food(self, resident, items, reason):
        value = sum(CROPS[k]["tokens"] * count for k, count in items.items())
        for crop, count in items.items():
            self.stock_change(crop, -count)
        resident["budget"] += value
        names = "、".join(f"{CROPS[k]['name']} ×{count}" for k, count in items.items())
        self.event("粮仓兑换", f"{resident['name']} · {reason} · {names} → {value:,} Token", "budget")
        return value

    def exchange_food(self, data):
        with self.lock:
            r = self.resident(data.get("id"))
            crop, count = data.get("crop"), data.get("count")
            farm = self.s["farm"]
            if type(data.get("version")) is not int or data["version"] != farm["stock_version"]:
                raise ValueError("粮仓库存已变化，请核对后再兑换")
            if crop not in CROPS or type(count) is not int or not 1 <= count <= farm["inventory"][crop]:
                raise ValueError("请选择库存足够的作物和数量")
            with self.farm_changes(r):
                return self.credit_food(r, {crop: count}, "手动兑换")
