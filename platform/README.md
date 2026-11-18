# 在赛题的 x-kernel 中运行村庄

Windows 双击仓库根目录的 **启动赛题村庄.cmd**。在带桌面的 Ubuntu 或 WSLg 中，也可从仓库根目录运行 `bash platform/start.sh`。出现 Weston 桌面后稍等，客体 Chromium 会自动打开村庄。点击左下角 **委托田 → 播下委托**，选“本地实习”即可操作一张真实存档的村务委托，全程无需模型密钥。关闭 QEMU 窗口即可结束本次演示。

## 哪些部分运行在客体

键盘、鼠标、Weston、Chromium 及村庄页面的 JavaScript 和画布都运行在 AArch64 x-kernel 客体。宿主机 Python 服务保存世界、调度委托并连接玩家配置的模型。QEMU 使用 `restrict=on`，由 `guestfwd` 仅把客体 `10.0.2.100` 上的村庄端口转发给宿主机回环服务。玩家选用真实模型时，模型连接由宿主机发起。

启动器使用 QEMU 8.0 或更新版本、Cortex-A76、4 vCPU、2 GiB 和纯 TCG（tb-size=160），启用 virtio-blk、virtio-gpu、virtio-mouse、virtio-keyboard、virtio-net 和 virtio-rng。页面地址参数 `?render=tcg` 使用本项目为软件模拟设计的显示模式。Chromium 沿用队伍开发环境的 `--no-sandbox` 和 Wayland 软件渲染参数，这一演示会话只用于村庄应用。宿主机需有 Python 3.10+、`qemu-system-aarch64`、QEMU GTK 显示模块、`debugfs` 和 `nc`（Ubuntu 的 `netcat-openbsd`）。

## 本机复现输入

| 文件（仓库根目录下） | 来源 | 本机 SHA-256 |
| --- | --- | --- |
| `data/platform/candidate/kernel.bin` | 从队友 2026-11-18 最新提交的 `work/performance-20261117-r1/source` 重新构建 | `20dea65f87636b24b0b1df5d89f0fef736159f7758d79a31e6f2dda0aa2dde5d` |
| `data/platform/wayland.img` | 从原始 ARM64 AgentOS 盘 `441b4504…`，按队伍恢复配方加入 19 个固定版本的 Alpine 包，逐个校验哈希并回读镜像 | `2817c7e2438075a42d8fc6d01d9e525164c9ea05d6696776d94ae26e901eeac4` |

队友分支为 `codex/perf-sparse-protect-20261118`，本次固定提交 `0b6c59600a8782762a6112eb02cfd96347e496e6`。展开的 `.config` SHA-256 为 `42e8d16450352712d78813b5f78b7ca221dfb88fadc796f57ecf317d7e33f669`，与分支记录相同。队友的 11 月历史实测使用 `ff0376b1…` 内核和 `3be0a923…` 运行盘。本机采用同一源码重建内核，搭配队伍此前已归档的 `2817c7e2…` Wayland 派生盘。运行盘和生成的内核未随上游 Git 发布；转移到另一台机器时要一并复制本表两份文件并核对哈希。[候选源码与实测](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/0b6c59600a8782762a6112eb02cfd96347e496e6/work/performance-20261117-r1) · [团队 Wayland 镜像恢复配方](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/0b6c59600a8782762a6112eb02cfd96347e496e6/work/cloud-runtime-recovery-20261006-r5/runtime/wayland_reconstruction_default_shell)

每次启动会在临时 raw 镜像中加入桌面会话脚本，再以快照模式启动客体。原运行盘保持上述哈希。持久村庄存档位于宿主机的 `${XDG_DATA_HOME:-$HOME/.local/share}/qilin-village/village.json`。

## 运行与取证

无桌面测试可用两个终端运行下列命令。第一个终端启动宿主机服务。第二个终端启动 VM，打印实际 QEMU 命令、监视器位置及串口日志位置。请在 VM 退出前复制需要的串口日志。

```sh
# 终端一
python3 server.py --port 8766 --qemu-guest --data "$HOME/.local/share/qilin-village/village.json"
# 终端二
python3 platform/qemu_demo.py launch --port 8766 --headless
```

在另一个终端，把下面的路径替换为启动器本次打印的监视器路径。这会用 QEMU monitor 的 `screendump` 直接生成 PNG；输出文件须为新文件。

```sh
python3 platform/qemu_demo.py capture --monitor /tmp/village-qemu-实际目录/monitor.sock --output village.png
```

2026-11-18 本机以 QEMU 8.2.2 跑通了上述组合。通过 virtio 鼠标点击委托田、通过客体键盘提交“村庄开工前盘点”，再点击开工并用键盘验收。宿主服务读回委托 `5749c03ade34` 的终态为 `harvested`，本次共调用外部模型 0 次。两张原始 1280×800 截图取自 QEMU monitor；串口日志能核对真实内核、设备和客体查询宿主服务的响应。[客体村庄截图](evidence/village.png) · [委托可收获时截图](evidence/task-ready.png) · [运行参数、终态与文件 SHA-256](evidence/run.json) · [客体串口原始记录](evidence/guest-serial.log)

本目录验证自由发挥应用的内核、图形、交互和存档链路。赛题的指定 HTML、稳定性、峰值内存和多轮性能测量仍以组委会材料与脚本单独验收。
