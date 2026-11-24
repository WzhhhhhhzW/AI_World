# R117 客体键盘与铁匠铺复验

2026 年 11 月 24 日，用 AI_World `680ac16050f9e4963a070ef74b6f73922de6e45b` 和冻结的 R117／Wayland 运行盘，在 E 盘上的 WSL2 内启动一台 AArch64 QEMU TCG 客体。使用空模型配置和独立存档，菜园、工坊已建成。Ubuntu 的 67 项 Python 测试全部通过。

用真实 Tab 找到「让主理人开工」，按 Enter。为留下等待状态画面，宿主的专用本地服务短暂停顿约 2.18 秒。按钮禁用时焦点落在委托手记，下一次 Tab 到同一手记的「工作记录」。服务恢复后，原任务成功交付。整段村庄时钟保持在 480 分。[开工键盘焦点](guest/07-focused-run/after.png) · [等待时焦点](guest/08-pending/after.png) · [下一次 Tab](guest/09-next-focus/after.png)

从收获的本地委托点击「锻造成技艺」，在铁匠铺确认保存。技艺册由 2 条变为 3 条，新技艺保留原成果、标题、说明和允许查阅的物资、建筑两项。实时 API 和磁盘存档一致，模型与账本计数为零。[从成果派生](guest/13-derive/after.png) · [新技艺](guest/15-new-skill/after.png) · [业务与存档回读](guest/forge-receipt.json)

点击下载后，Chromium 显示开始下载。随后下载历史与目录均为空，受管配置中记录了 `DownloadRestrictions: 3`。因此本次验收确认技艺成功保存，未取得实际下载文件。[点击后的提示](guest/16-download/after.png) · [下载历史](guest/18-download-result/before.png) · [实际受管配置](dl-policy.log)

QEMU 与宿主夹具服务均正常结束。[启动身份](guest/launch.json) · [退出凭据](terminal.json) · [原始核验索引](MEASURED.md)
