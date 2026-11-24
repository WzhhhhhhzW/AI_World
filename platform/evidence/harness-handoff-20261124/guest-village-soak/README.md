# R117 村庄交互运行 30 分钟

在迁移到 E 盘的 Ubuntu WSL2 中启动单个 R117 x-kernel AArch64 TCG 客体。客体里的 Chromium 持续显示村庄，通过本机独立服务运行模拟。玩家恢复村庄后，按宿主单调时间实测 1800.004 秒。在起点、15 分钟及 30 分钟，客体三次实际打开委托田，按 Esc 返回地图。原始六张画面已核对，村庄时间和物资在运行中增加。最后借助客体暂停，存档及服务均确认时钟停在 7784，物资为 284 木材、196 石料和 7 作物。

本轮使用单独存档、本地规则和零模型调用。QEMU 和测试服务都在北京时间 11:24:38 前正常退出。功能验收适用于本次本地村庄流程，正式浏览器长稳和 D3000M 原生性能各有独立入口。

[实测记录](session-20261124-village-soak/MEASURED.md) · [30 分钟时打开委托田](session-20261124-village-soak/guest/04-end-board/after.png) · [30 分钟时返回地图](session-20261124-village-soak/guest/04-end-map/after.png) · [原始文件清单](PUBLICATION_FILES.json)

从本目录运行 python -B session-20261124-village-soak/audit.py，可离线复核存档、时钟、交互回执及终态。实测源固定为 a68c9eec38f34cdcea7b4a512310d9d567e056b6。
