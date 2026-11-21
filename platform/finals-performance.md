# 决赛性能本机预演

赛题性能与资源消耗共 20 分。指定页完成加载且峰值内存不超过 1.5G 是资格线，占 4 分。其余 16 分按统一主机实测排名，分为启动首帧 5 分、页加载 5 分、renderer 创建 3 分、峰值内存 3 分。稳定运行和浏览器功能完整度各有独立的 20 分。测量规范要求至少五次，报告中位数、波动范围和宿主环境。来源为《附件 2》赛题六第六、七节。

## 输入和计时口径

- 主机为 Intel Core Ultra 9 285H、32 GB 内存、Windows 11 与 WSL2 Ubuntu，QEMU 8.2.2。AArch64 客体使用 Cortex-A76、4 vCPU、2 GiB、纯 TCG。图形管线为 Weston、Wayland 和 Chromium 142.0.7444.59。QEMU 宿主侧以无窗口方式运行，客体通过 virtio-gpu 正常渲染。
- 内核与根盘来自同一份[本机复现输入](README.md#本机复现输入)。团队原始三个 HTML 页面逐个回读校验，保持其内容不变。原始首页标注为初赛测试页。工作区使用的主机、重建根盘、视觉探针和 Chromium 参数都需在现场跟组委会发布版本核对。
- 本机视觉探针由 QEMU monitor 截图识别浏览器可见白窗、首页四色块及布局页特征。renderer 由客体实际进程记录识别。宿主 QEMU 峰值 RSS 包含 TCG 缓存、设备和客体物理页在宿主进程中的常驻开销，和客体内存是不同的测量量。
- 低内存模式让 Chromium 在自身内部采用低内存策略，客体 RAM 仍为 2 GiB。它作为可选实验，只用于验证表现及功能兼容性。现场采用组委会指定的启动参数、页面和脚本。[Chromium 142 实现](https://github.com/chromium/chromium/blob/142.0.7444.59/base/system/sys_info.cc#L30-L68)

赛题跨层优化的比例以队伍首个可运行版本为基线。团队历史报告记录基线名称 `ict-first-browser-20260923`。本轮浏览器参数 A/B 使用同一重建内核和根盘，支持隔离启动参数的影响，首可用版的跨层优化分需另行核对。[队伍历史实验](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/blob/0b6c59600a8782762a6112eb02cfd96347e496e6/outputs/ict-chromium/evidence/mainline-memory-adoption-20261003/result.json)

## 五组交替冷启动

每组先跑队友原启动参数，再只增加 `--enable-low-end-device-mode`，每次重启客体并使用新的 Chromium 配置。两组均保留独立 renderer。表中为中位数，方括号内为五次最小至最大值。浏览器三项从串口记录启动命令开始计时，布局页单独从按下回车计时。抓图间隔约 0.7 秒，客体进程观察以 0.5 秒为间隔。[逐次记录](evidence/finals-20261120/startup-matrix.json)

| 本机观察 | 队友原参数 | 低内存模式 | 中位数变化 |
| --- | ---: | ---: | ---: |
| 浏览器首个白窗 | 56.88 s [54.02–60.48] | 46.20 s [44.07–48.38] | −18.8% |
| 首页四色块可见 | 60.47 s [56.17–63.35] | 50.50 s [49.79–57.69] | −16.5% |
| 首次查到 renderer PID | 31.69 s [30.70–34.67] | 30.89 s [29.85–32.94] | −2.5% |
| 宿主 QEMU 进程峰值 RSS | 1,174.26 MiB [1,166.97–1,177.38] | 1,112.29 MiB [1,108.56–1,119.97] | −5.3% |
| 回车至 CSS 布局出现 | 3.71 s [3.00–3.72] | 3.71 s [2.99–3.71] | 基本持平 |

初始化收益集中在白窗口和首页出现阶段。renderer 与布局页的波动范围重叠，暂不能确认这两项稳定加速。五组都固定先跑原参数，原参数白窗从第一轮 60.48 秒到第五轮 54.02 秒，可能混入宿主热身因素。宿主 QEMU 进程峰值以退出后 `wait4` 返回的全生命周期最大 RSS 统计。低内存组在本机五次均低于 1.5 GB，仍需以组委会现场脚本的指标口径为准。

## 功能回归

低内存模式在独立客体运行中成功识别真实 renderer，原生键盘切换两张标签并在输入框和回显区显示 `hello x-kernel`，相对鼠标左键点击原页面链接后跳转到布局页。JavaScript 和 CSS 核心检查各 6/6。用 Wayland 指针日志校准相对位移，此功能回归单独记录。30 分钟长稳本轮仍待实测。[功能证据](evidence/finals-20261120/controls.json) · [键盘回显](evidence/finals-20261120/keyboard-echo.png) · [CSS 六项检查](evidence/finals-20261120/css-checks.png)

## 复跑

在仓库的 WSL/Linux 工作目录运行。需要 QEMU 8+、Python 3、debugfs、Pillow、AArch64 交叉 GCC、两份本机复现输入和包含固定提交的队友本地 Git 仓库。输出目录应为新目录。

```sh
python3 platform/finals_benchmark.py --output data/platform/finals-repeat
python3 platform/finals_benchmark.py --controls --output data/platform/finals-controls
python3 platform/finals_benchmark.py --soak --output data/platform/finals-soak
```

键鼠、双标签耐用性和长稳各自单独运行。长稳入口持续 30 分钟，按两分钟间隔换页十次，同时保留进程存活、内存曲线与终点响应的证据。

复跑默认在奇数组先跑原参数、偶数组先跑低内存模式，以减小宿主热身影响。加 `--order baseline-first` 可复现表中每组固定先原参数的顺序。

## 11 月 21 日内核对照

在上一版预读及 VMA 优化之上，新增私有文件缺页的完整覆盖快路径与初始栈缓冲复用。用队友原 Chromium 参数和同一只读 Wayland 盘进行五组交替对照，首个白窗中位从 59.00 降至 53.97 秒，首页四色块从 62.59 降至 58.25 秒，renderer 首次观测从 33.08 降至 30.73 秒。宿主 QEMU 的峰值中位由 1,173.32 到 1,173.71 MiB。两侧时延范围有重叠，基线的两次 75 秒以上首页样本均保留。[逐次内核对照](evidence/continued-performance-20261121/kernel-file-fault-comparison.json) · [队友分支源码与复跑步骤](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/codex/kernel-finals-performance-20261120/work/performance-20261121-finals-r3)

可将 `--browser-mode baseline` 与 `--soak` 或 `--controls` 一起使用，使独立验证采用队友原启动参数。只传 `--soak` 或 `--controls` 时使用低内存模式。

## 11 月 21 日 30 分钟浏览器长稳

新内核使用队友原 Chromium 参数和同一只读 Wayland 启动盘连续运行 1811.38 秒。原始首页和布局页每隔约两分钟交替加载，10 次均通过画面检测，结束时再向 Chromium 发送导航键并确认首页显示。采样期间 Chromium 和 Weston 的 PID 一直相同，串口未发现 OOM、内核 panic 或图形进程丢失。宿主 QEMU 全生命周期峰值 RSS 为 1,199.17 MiB。本次长稳使用队友归档页面。正式长稳与得分以组委会统一环境为准。[长稳汇总](evidence/continued-performance-20261121/finals-soak.json)

## 11 月 21 日低内存模式复测与首版恢复

同一候选内核使用两种 Chromium 参数交替冷启动五组。首窗中位数从 54.76 秒降至 46.89 秒，首页从 56.91 秒降至 51.18 秒，宿主 QEMU 峰值 RSS 从 1,175.10 MiB 降至 1,119.14 MiB。五组这三项均改善。renderer 与布局页的结果处于两侧重叠范围内，布局页差距接近取图间隔。独立回归中，键鼠、双标签和 JS、CSS 检查通过。低内存模式为可选验证条件，正式测试使用组委会指定参数。[五组逐次记录](evidence/finals-20261121/low-memory-comparison.json) · [队友分支与功能证据](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/26511f19db92d1822c1571e6bc480528e5024c1e/work/performance-20261121-finals-r4)

队伍首次可运行版已从官方上游和五个冻结补丁恢复，源码树哈希和历史清单相同。用当前相同的 AArch64 展开配置和 Rust 1.95.0 完成构建。重建二进制单独记录 SHA-256，首版与当前版本使用同一运行盘和脚本复测。[首版构建校验](evidence/finals-20261121/first-build.json)

## 重建首版与当前候选的启动对照

同一运行盘、同一套 Chromium 原参数交替跑五组。首窗中位从 61.02 秒到 53.91 秒，首页四色块从 73.86 秒到 57.48 秒，renderer 从 39.52 秒到 31.10 秒。首页在四组更快，第五组慢 8.72 秒。宿主峰值 RSS 中位从 1,104.57 MiB 增至 1,156.38 MiB，五组均上升。[逐轮数据](evidence/finals-20261121/first-version-comparison.json)

首版的布局页键盘导航预试未完成。本机对照统一使用 `--startup-only`，在首页出现后固定再观察至少十秒，比较两版共有的启动阶段。报告中的内存覆盖这段宿主 QEMU 进程生命周期，完整功能、长稳和现场成绩采用各自的证据。[队友分支与复跑命令](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/338e372da71248c5cd823331dbb4e1542594ff2a/work/performance-20261121-finals-r4)

## 私有文件缺页预读的内存与启动权衡

本轮五组交替冷启动固定队友原 Chromium 参数、同一只读盘和展开配置，仅把私有文件缺页预读从八页降至一页。一页窗口的宿主峰值中位从 1,172.52 MiB 降至 1,122.19 MiB，首页从 56.13 秒增至 71.74 秒，renderer 从 30.03 秒增至 39.16 秒。五组方向一致。决赛主线继续使用八页。[逐轮数据](evidence/finals-20261121/fault-readahead-comparison.json)

单独用 `--memory-probe` 在 Chromium 启动前、同一布局页出图后采集客体计数。一页窗口的客体页缓存净增量少 57.90 MiB，管理页高水位增量少 56.36 MiB，客体 VirtMem 计数的净增量只相差 0.64 MiB。该组用于定位内存差异，计时统计仍来自单独五组。[客体原始快照](evidence/finals-20261121/fault-readahead-memory-probe.json) · [队友仓库与复跑](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/cd0d614a2cd69c52526f315eb1655a814325c0e6/work/performance-20261121-finals-r5)

## 11 月 22 日自适应预读对照

候选在冷缺页时读取两页，前一页已驻留时可扩大到八页。命中时直接复用缓存页。AArch64 客体 188 项 kvfs 回归通过，其中 7 项覆盖预读、文件尾页、脏邻页、错误回调与内存文件。五组浏览器冷启动使用队友原参数、同一配置和 Wayland 启动盘。

自适应方案的宿主峰值中位从 1,169.42 MiB 降到 1,154.33 MiB，五组均下降。首窗从 51.78 秒到 53.91 秒，首页从 56.06 秒到 57.48 秒，renderer 从 29.85 秒到 31.10 秒，这三项五组均较慢。局部节省不足以抵消当前决赛启动代价，继续用固定八页作为默认。[逐轮数据](evidence/finals-20261122/fault-readahead-adaptive.json) · [队友仓库与复跑](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/c635e9d08a6484ac93793092425cef9910a9f9fc/work/performance-20261122-finals-r6)
