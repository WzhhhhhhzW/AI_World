# 在赛题的 x-kernel 中运行村庄

Windows 双击仓库根目录的 **启动赛题村庄.cmd**。在带桌面的 Ubuntu 或 WSLg 中，也可从仓库根目录运行 `bash platform/start.sh`。客体 Chromium 会自动打开村庄。点击左下角 **委托田 → 播下委托**，选“本地实习”即可操作一张真实存档的村务委托，全程无需模型密钥。关闭 QEMU 窗口即可结束本次演示。

同一份存档的客体窗口已经打开时，再次运行入口会尝试切回该窗口，继续当前会话。若窗口还在启动，或桌面拒绝自动切换，入口会显示原窗口的名称，可从任务栏切回。关闭原 QEMU 窗口后，下次进入会重新启动客体。

## 哪些部分运行在客体

键盘、鼠标、Weston、Chromium 及村庄页面的 JavaScript 和画布都运行在 AArch64 x-kernel 客体。宿主机 Python 服务保存世界、调度委托并连接玩家配置的模型。QEMU 使用 `restrict=on`，由 `guestfwd` 仅把客体 `10.0.2.100` 上的村庄端口转发给宿主机回环服务。玩家选用真实模型时，模型连接由宿主机发起。

启动器使用 QEMU 8.0 或更新版本、Cortex-A76、4 vCPU、2 GiB 和纯 TCG（tb-size=160），启用 virtio-blk、virtio-gpu、virtio-mouse、virtio-keyboard、virtio-net 和 virtio-rng。页面地址参数 `?render=tcg` 使用本项目为软件模拟设计的显示模式。Chromium 沿用队伍开发环境的 `--no-sandbox` 和 Wayland 软件渲染参数，这一演示会话只用于村庄应用。宿主机需有 Python 3.10+、`qemu-system-aarch64`、QEMU GTK 显示模块、`debugfs` 和 `nc`（Ubuntu 的 `netcat-openbsd`）。

村庄启动 Chromium 时启用 Linux 版自带的 zygote，让子进程继承已初始化的浏览器代码。固定网页、使用全新客体配置各测一次，启动至首次页面请求从 50.93 秒缩短到 43.57 秒，至 QMP 首次截到地图从 80.82 秒缩短到 68.03 秒。两次均从已准备的启动盘开始计时。本版 x-kernel 的 procfs 对 fork 后的子进程可能仍显示 zygote 的参数，按命令行识别 renderer 的赛题工具应配合队伍的正式启动脚本使用。[四组启动配置和实测值](evidence/performance-20261120/chromium-startup.json)

默认村庄会话也启用 Chromium 低内存模式。同一组合网页的两轮客体对照中，截到地图由 66.88 秒变为 62.69 秒。用最终默认入口复测为 59.35 秒，委托田和缩放可用。[组合版实测](performance.md#第三轮首屏与局部绘制)

## 本机复现输入

| 文件（仓库根目录下） | 来源 | 本机 SHA-256 |
| --- | --- | --- |
| `data/platform/candidate/kernel.bin` | 从队友 2026-11-18 最新提交的 `work/performance-20261117-r1/source` 重新构建 | `20dea65f87636b24b0b1df5d89f0fef736159f7758d79a31e6f2dda0aa2dde5d` |
| `data/platform/wayland.img` | 从原始 ARM64 AgentOS 盘 `441b4504…`，按队伍恢复配方加入 19 个固定版本的 Alpine 包，逐个校验哈希并回读镜像 | `2817c7e2438075a42d8fc6d01d9e525164c9ea05d6696776d94ae26e901eeac4` |

队友分支为 `codex/perf-sparse-protect-20261118`，本次固定提交 `0b6c59600a8782762a6112eb02cfd96347e496e6`。展开的 `.config` SHA-256 为 `42e8d16450352712d78813b5f78b7ca221dfb88fadc796f57ecf317d7e33f669`，与分支记录相同。队友的 11 月历史实测使用 `ff0376b1…` 内核和 `3be0a923…` 运行盘。本机采用同一源码重建内核，搭配队伍此前已归档的 `2817c7e2…` Wayland 派生盘。运行盘和生成的内核未随上游 Git 发布；转移到另一台机器时要一并复制本表两份文件并核对哈希。[候选源码与实测](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/0b6c59600a8782762a6112eb02cfd96347e496e6/work/performance-20261117-r1) · [团队 Wayland 镜像恢复配方](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/0b6c59600a8782762a6112eb02cfd96347e496e6/work/cloud-runtime-recovery-20261006-r5/runtime/wayland_reconstruction_default_shell)

村庄启动入口优先读取 `data/platform/candidate/finals-kernel.bin`，缺省时使用表中的 `kernel.bin`。本机已放入队友仓库决赛优化分支的构建产物，SHA-256 为 `248473f7490e9535c36efe4c3ac1460fde77341035fe013e7bb903446a9e881b`。[内核改动与复现](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/codex/kernel-finals-performance-20261120/work/performance-20261121-finals-r3)

首次启动会在 Linux 用户缓存中准备可复用的只读启动盘，注入并回读校验桌面会话脚本。本机的 2 GiB raw 盘在 ext4 上实际占用约 945 MiB。再次启动会复用这份盘，原盘或会话脚本变更时会重新准备。每个 QEMU 实例使用独立的临时写入层。客体固定访问 `10.0.2.100:8766`，宿主端口继续按实例分配。

启动盘保存在 `${XDG_CACHE_HOME:-$HOME/.cache}/qilin-village/disks`。退出所有演示后可以清除此缓存，下一次将自动重建。持久村庄存档位于 `${XDG_DATA_HOME:-$HOME/.local/share}/qilin-village/village.json`。

本机新旧启动耗时和进村后的慢帧数据见 [启动与画面性能](performance.md)。
赛题性能和内存的本机对照见 [决赛性能本机预演](finals-performance.md)。

## 运行与取证

无桌面测试可用两个终端运行下列命令。第一个终端启动宿主机服务。第二个终端启动 VM，打印实际 QEMU 命令、监视器位置及串口日志位置。`VILLAGE_STAGE` 行给出自启动器开始运行的秒数，依次记录启动盘创建或复用、QEMU 进程启动、内核启动、Weston 就绪和 Chromium 启动命令。页面真正显示须以客体浏览器或 QMP 截图核对。请在 VM 退出前复制需要的串口日志。

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
