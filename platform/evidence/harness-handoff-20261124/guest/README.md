# x-kernel 客体里的 AI 村庄协作复验

2026 年 11 月 24 日北京时间约 08:52 至 08:59，用提交 `74ac824ab0226990c1ca7985c4d7dea808a6c1c8` 启动一次 AArch64 x-kernel R117 客体。环境为 Intel Windows／WSL2、QEMU 8.2.2 TCG、4 vCPU、2 GiB、Weston 和 Wayland Chromium。截图来自同一个 QEMU framebuffer。真实 QMP 键鼠由客体接收，业务状态由专用宿主服务及磁盘存档交叉核对。Ubuntu 上的 67 项 Python 测试同日全部通过。

1. 点地图上的阿榆，输入 `audit village stock`，将未发送的聊天草稿转为协作委托。玩家填写标题后提交，阿榆先独立完成首稿。
2. 先请小满，再请砚秋，得到两组共六条提示。勾选砚秋的第一条，交回主理人修订并验收。
3. 第二稿和存档只包含已选建议。两位顾问的采纳列表分别为空和一条。此次使用本地实习，配置中的提供方、聊天记录和模型账本均为空。QEMU 正常退出。

键盘导航期间曾误切换一次暂停，随即恢复，村庄时钟从 480 走到 528。两份咨询仍取同一稿的已冻结材料。这次功能观测启用了额外 Wayland 客户端日志，决赛耗时使用另外的评测流程。

- [未发送草稿](evidence/07-draft/after.png) · [转进委托的画面](evidence/08-handoff/after.png) · [主理人首稿](evidence/13-primary-run/after.png)
- [两位顾问同屏](evidence/29-adviser-cards/after.png) · [只勾选一条](evidence/30-one-hint/after.png) · [二稿收获](evidence/33-harvested-title/after.png)
- [实际存档](evidence/village.json) · [API 与磁盘复核](evidence/receipt-harvested-two.json) · [Ubuntu 回归日志](evidence/ubuntu-units.log) · [QEMU 退出](evidence/exit.json) · [操作侧收尾记录](evidence/operator-exit.json)

## 启动复验

需要 Linux 或 WSL、Python 3.10+、QEMU 8+、debugfs、nc 和本项目测试工具所需的 Pillow。将 R117 的 `kernel.bin.gz` 解压到新文件，保留已校验的 `wayland.img`。工作目录为普通 AI_World Git 克隆的根目录。[R117 内核与根盘摘要](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/codex/kernel-finals-performance-20261120/work/performance-20261124-finals-r117-heap-floor)

```sh
TOOLS="$PWD/platform/evidence/harness-handoff-20261124/guest"
OUT=/path/to/new-village-guest-check
bash "$TOOLS/start.sh" "$PWD" /path/to/r117-kernel.bin /path/to/wayland.img "$OUT"
```

在第二个终端设置相同的 `TOOLS` 与 `OUT`，通过 QMP 取图和输入。每次使用新的步骤名，坐标以该次 framebuffer 中的实际 Chromium surface 为准。启动器使用新存档并关闭模型提供方。

```sh
g() { python3 -B "$TOOLS/guest_ui.py" --run "$OUT/guest" "$@"; }
g shot 01-map
g hover 02-resident-hover --x "$ACTUAL_X" --y "$ACTUAL_Y"
g click 03-resident --x "$ACTUAL_X" --y "$ACTUAL_Y" --settle 3
g receipt --save "$OUT/village.json" --status harvested --goal 'audit village stock' --first-worker --two-advisers
g quit 99-quit
```

可使用 `g text STEP --text 'audit village stock'` 输入草稿。对话、委托、顾问和验收均以真实界面完成。每次点击前后保存画面，新增的客体按下和松开事件随步骤记录。收据只读宿主 API 和磁盘存档。
