# R117 客体铁匠铺复验

在 Windows E 盘迁移后的 WSL2 上启动 R117 x-kernel AArch64 客体，实际在 Wayland Chromium 点击「委托田 → 铁匠铺 → 技艺卡 → 查看 SKILL.md」。技艺种子来自 [前一次客体内实际锻造](../guest-forge/README.md)。完整截图可读到技艺 ID、说明、正文、时钟 480 分、物资 60/40/0 和两项材料。首尾服务和持久存档读回一致，QEMU 与测试服务正常退出。

[完整截图](session-20261124-skill-preview/guest/07-complete-preview/after.png) · [本轮实测](session-20261124-skill-preview/MEASURED.md) · [实际终态](session-20261124-skill-preview/terminal.json) · [原始文件清单](PUBLICATION_FILES.json)

测试源固定为 73db41e931cc0bcbbd6a5014bf7ce5b6cd21f9bf。按 [操作步骤](session-20261124-skill-preview/PLAN.md) 复跑时，新建空白试验目录，复制运行器、夹具和前轮回执，按当地实际路径调整原始启动脚本里的仓库、Git 工作树、R117 解压内核和冻结根盘位置。参考 Markdown 是主机从同一技艺生成的 539 字节。客体记录覆盖画面与存档。普通 Windows Chrome 的实际文件下载另见 [下载复验](../forge-preview/README.md)。
