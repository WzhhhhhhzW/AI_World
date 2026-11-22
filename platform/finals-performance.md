# 决赛性能本机预演

赛题性能与资源消耗共 20 分。指定页完成加载且峰值内存不超过 1.5G 是资格线，占 4 分。其余 16 分按统一主机实测排名，分为启动首帧 5 分、页加载 5 分、renderer 创建 3 分、峰值内存 3 分。稳定运行和浏览器功能完整度各有独立的 20 分。测量规范要求至少五次，报告中位数、波动范围和宿主环境。来源为《附件 2》赛题六第六、七节。

## 决赛平台补充

据队员转达的官方补充，决赛统一机为飞腾 D3000M、银河麒麟 Linux 笔记本，允许 KVM 加速。这一补充更新原文第七节第（一）款第 2 项对决赛的纯 TCG 要求。决赛沿用 AArch64 QEMU 8.0 及以上、x-kernel `kplat-aarch64` 和组委会提供的 `qemu_defconfig`、设备组合、rootfs、测试页、Chromium 参数与统一评分脚本。功能验收证据使用 QEMU `screendump`。初赛仍按原文使用纯 TCG。

优先在决赛机确认指定页面、峰值内存资格线、键鼠和双标签、30 分钟长稳与 10 次周期加载；基准内核和候选内核使用相同 KVM 配置交替冷启动至少五组。跨层优化评分另外使用队伍首个可运行版本的 Git 标签做基线，保留原始数据。以下 Intel/WSL2 的 TCG 样本属于开发对照；首窗抓图、首次观察到 renderer 和宿主 QEMU RSS 以组委会脚本口径复核。已准备 KVM 复测入口，待 D3000M 实机验证。

在 AArch64 银河麒麟 Linux 上使用 `platform/finals_benchmark.py --accel kvm` 运行本仓库的对照脚本。脚本要求 `/dev/kvm` 可读写、KVM API 版本为 12 和 QEMU 版本至少 8.0，并使用 `-accel kvm -cpu host`。各轮 `metrics.json` 保存 QMP `query-kvm`，其中 `present` 和 `enabled` 均为 `true` 才进入观测流程。KVM 模式取首张采样到的浏览器白窗或首页截图，报告 `browser_to_first_visible_s`。`inputs.json` 记录宿主 CPU、内存、内核、发行版和 QEMU 版本。[QEMU virt CPU 与图形设备](https://www.qemu.org/docs/master/system/arm/virt.html) · [QEMU QMP 加速状态](https://www.qemu.org/docs/master/interop/qemu-qmp-ref.html#command-QMP-query-kvm)

现场可用 `--prepared-assets` 读取预先导出的 `guest-browser.sh` 和静态 AArch64 `renderer-watch`，省去克隆仓库和现场交叉编译。脚本校验浏览器启动脚本与固定提交的字节一致，并把两个离线文件的 SHA-256 写入 `inputs.json`。本地传输包包含已通过长稳的 CRC32C 版、同配置重建首版和 R20 对照的两份内核，附镜像与文件校验值。首版共同启动阶段使用 `--startup-only`，完整功能及长稳单独验证。

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

## 11 月 22 日固定八页下的缓存命中对照

预读保持固定八页，只去掉命中缓存之后的重复查询。五组交替冷启动的首页中位数从 58.22 秒变为 57.51 秒，峰值内存从 1,179.75 MiB 变为 1,167.88 MiB。首页三组快、两组慢，其中一个候选样本慢 7.88 秒。峰值内存同样有两组上升，renderer 中位数近似持平。当前决赛配置沿用已验证内核。[逐轮数据](evidence/finals-20261122/fault-folio-hit-only.json) · [队友仓库与复跑](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/00c041b7a9b6bf1142633b557aaf1a64c0783153/work/performance-20261122-finals-r7)

## 11 月 22 日进程复制页表优化

候选跳过相同非空父页权限的重复更新，保留可写页降权、子映射和失败回滚。AArch64 客体 memspace 的 53 项全部通过。五组同盘、原 Chromium 参数交替冷启动中，首窗中位从 53.97 秒降到 52.49 秒，首页从 58.97 秒降到 56.06 秒，renderer 从 30.97 秒降到 29.58 秒，宿主峰值从 1,167.38 MiB 到 1,168.86 MiB。三组首页和 renderer 更快，另两组首页各慢约 0.7 秒。

候选已通过键盘输入与回显、鼠标链接、双标签切换、JS 和 CSS 各 6 项。使用相同二进制和原 Chromium 参数单独测试，长稳持续 1,805.16 秒，十次交替加载全部通过，结束时可导航回首页。Chromium 和 Weston 进程编号在观察期间保持一致，串口未记录 OOM 或 panic。宿主 QEMU 全生命周期峰值为 1,205.30 MiB。[逐轮和功能记录](evidence/finals-20261122/fork-skip-protect.json) · [长稳汇总](evidence/finals-20261122/fork-skip-protect-soak.json)

源码变更已加入队友决赛协作分支，生产源码提交为 `38d221e`，实测证据提交为 `d113f8e`。本机启动入口的默认内核已替换为同一通过长稳的二进制，上一版保存在本地 `data/platform/finals-next/pre-fork-final-kernel.bin`。比赛现场仍采用组委会统一环境和计时方式。[队友仓库与复跑](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/d113f8e9d128bf2455f9210233b6b7fec7c23d49/work/performance-20261122-finals-r8)

部署后通过本机默认入口启动 Xvfb 临时存档，地图正常显示，三次重复启动均复用原 QEMU。此回合包含首次准备启动盘，作为入口验证留档。[启动器验证](evidence/finals-20261122/fork-deployed-entry.json)

## 11 月 22 日 ThinLTO 构建对照

从同一已采用源码 38d221e 分别构建默认和 ThinLTO，展开配置、Rust 版本、运行盘和 Chromium 原参数一致。AArch64 最终链接日志验证了两种配置。五组交替冷启动中，默认 5/5 完成，ThinLTO 4/5 完成。成功样本的首页中位数为 55.36 秒和 57.12 秒，宿主峰值为 1,176.61 和 1,175.05 MiB。超时的实际截图显示 Chromium 页面无响应。独立预试的另一次超时和反向复测均保留，当前采用默认构建。[逐轮对照](evidence/finals-20261122/thinlto-release-comparison.json) · [构建参数](evidence/finals-20261122/thinlto-build-proof.json) · [队友仓库与故障画面](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/d167aafa7f7fbbacd3d22921f9bce4924487f03e/work/performance-20261122-finals-r9)

## 11 月 22 日启动复制与装载耗时定位

基于 38d221e 构建默认版与独立诊断版。两组冷启动共四轮，按 AB、BA 交替，全部观测到首页、首窗和独立 renderer。两次诊断中，renderer 首次被观测前各记录 12 次私有地址空间复制和 11 次成功映像装载。两类区间并集分别为 3.278 和 3.576 秒。复制中位数为 153.80 和 175.54 毫秒，装载中位数为 17.81 和 24.14 毫秒，单次锁等待最长为 3.06 毫秒。计时使用客体时钟并扣除跨任务重叠，覆盖该窗口内客体任务。继续分解复制路径的匿名对象、页表和 VMA 环节。[逐轮结果](evidence/finals-20261122/startup-fork-exec-observations.json) · [队友仓库计时补丁与复跑步骤](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/b7b9ad36311e4db7095f22a38c3f52908955a121/work/performance-20261122-finals-r10)

## 11 月 22 日私有复制分段计时

同一发布源码的默认版和分段诊断版各运行两次，共四次原参数冷启动，均观察到首窗、首页和 renderer。renderer 首次被观测前，两次诊断各记录 12 次私有复制。对象准备与提交合计为 822.01 和 936.36 毫秒，均约占复制记录总时长的 39%。准备和提交分别检查了约 10.2 万个空子对象中的页项。父页只在约 6.5% 的页项上降权。先测试能复用准备向量、跳过空子对象重复扫描并直接移交页句柄的候选。观察使用客体单调时钟，跨任务区间可能重叠。[逐轮分段数据](evidence/finals-20261122/private-fork-stages.json) · [队友分支补丁与复跑](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/2b9380c00182c479a68e8b2020a9e6cb3ef8b71a/work/performance-20261122-finals-r11)

## 11 月 22 日私有复制页对象分配对照

候选复用页项向量、跳过空子对象的冲突扫描，并在提交时直接移交页句柄。AArch64 客体 `anon`、`memspace`、`filemap` 合计 74 项通过，包括两项新增回滚测试。五组交替冷启动均完成。首窗和布局页中位数分别约 53.23 秒和 3.00 秒，基本持平。首页从 56.14 秒到 56.81 秒，两组慢约 2.85 秒，renderer 从 30.56 到 30.51 秒，宿主峰值从 1,175.21 到 1,177.50 MiB。此次采用决定仍为通过长稳的默认版本。[五组对照与测试明细](evidence/finals-20261122/private-fork-object-bookkeeping.json) · [队友分支补丁与复跑](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/c62ec79de2b47d847db60a6100b7d723afe18c9d/work/performance-20261122-finals-r12)

## 11 月 22 日私有文件首次缺页抽样

两次独立诊断冷启动各采集三份客体累计计数。启动前至首次观测 renderer 分别记录 55,831 和 55,745 次首次触页，各有 873 个计时样本。文件页获取及复制占样本累计计时的 74.4% 和 77.0%，在 renderer 至首页的区间仍是两次的最大分项。计时涵盖整个客体的首次私有文件缺页，包含可能重叠的任务区间和调度等待。继续分解缓存查找、锁等待、缓存未命中后的读取和内存复制。[快照与分阶段数据](evidence/finals-20261122/private-file-faults/observations.json) · [队友分支的诊断补丁与复跑](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/066d4ba7675ca4eaf77763590de7ce8c139d6df6/work/performance-20261122-finals-r13)

## 11 月 22 日同步预读及重复尾页

同盘、原 Chromium 参数两轮诊断中，首次观测 renderer 前同步预读占 folio 获取与复制的抽样计时约 73.9%。两轮各完成 781 和 784 个抽样预读页，其中 231 和 199 个重复，连续重复尾页为 228 和 199 个。renderer 观测至首页的连续重复尾页是 179/320 和 122/352。重复统计使用预读完成时的插入结果，可能包含并发插入。以此为依据测试仅裁剪已驻留尾段的候选，保留夹在缓存页之间的缺页及按需读取回退。[诊断数据与原始快照](evidence/finals-20261122/private-file-fault-io/observations.json) · [队友分支的诊断补丁与复跑](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/5f246e2e42e7eddfe12c40ca350e5fc683a9850d/work/performance-20261122-finals-r14)

## 11 月 22 日预读驻留尾段裁剪对照

候选仅在文件私有缺页预读中裁去连续驻留尾页，保留中间缺页、脏页、EOF 和错误回退。AArch64 客体 `kvfs`、`pagecache`、`filemap` 和 `kext4` 共 650 项通过。五组两版均完成。首页中位数从 56.858 到 56.804 秒，其中一组候选慢 2.124 秒。renderer 四组更早，配对差值中位数为 −0.407 秒，接近约 0.5 秒扫描间隔。首窗、布局页近乎持平，宿主峰值中位数从 1,179.05 到 1,180.14 MiB。当前仍采用已通过长稳的默认内核。[逐轮对照与测试明细](evidence/finals-20261122/readahead-tail-comparison.json) · [队友分支的候选补丁与复跑](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/158ff41de0064edecec2163dc449dddc284b8ca8/work/performance-20261122-finals-r15)

## 11 月 22 日预读尾段裁剪计数复核

两组同探针交替诊断均完成。renderer 观测前抽样预读页数分别从 771 到 583、从 877 到 514，减少 24.4% 和 41.4%。同步预读累计耗时分别从 200.69 到 204.04 毫秒、从 214.93 到 204.94 毫秒。两组对耗时的影响方向不同。计时可含任务重叠，且同步预读区间不含裁剪判断的页缓存查询。继续测量 ext4 每次读取、缓冲分配和缓存完成的开销。[逐轮计数及快照](evidence/finals-20261122/readahead-tail-io-probe/observations.json) · [队友分支的补丁与复跑](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/e169ba30177621ded937cebc1eeacd46627d23d9/work/performance-20261122-finals-r16)

## 11 月 22 日 ext4 预读细分

两轮诊断均完成。首次观测 renderer 前，两轮分别抽到 103 和 102 次 ext4 预读。`read_at` 累计 148.04 和 198.26 毫秒，占三个 ext4 分项的 77.4% 和 80.6%。缓冲区分配及清零仅占 2.6% 和 2.2%。`read_at` 覆盖挂载锁、extent 查找校验和同步块请求。只读运行盘的 Chromium 主程序使用一个带校验的 4 KiB extent 叶节点。因此优先验证保留完整校验语义的 CRC32C 查表读路径，实际启动收益另行对照。[分核数据和原始快照](evidence/finals-20261122/private-file-fault-ext4/observations.json) · [队友分支补丁与复跑](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/e41fea879114ed4db496a4c9a336ce99c56e67de/work/performance-20261122-finals-r17)

## 11 月 22 日 ext4 CRC32C 查表候选

候选在相同校验语义下改用 1 KiB 编译期表，保留所有元数据校验。AArch64 客体五个相关 crate 的 683 项回归全部通过。使用原 Chromium 参数固定环境交替启动五组，十轮均完成。首页中位数由 57.541 到 56.826 秒，renderer 四组更早，配对差值中位数 −0.390 秒。两版首窗及布局页各自的中位数基本相同。宿主峰值中位数由 1,175.36 到 1,170.43 MiB。区间有重叠，记录保留每组差值。[逐组数据及测试明细](evidence/finals-20261122/ext4-crc32c-comparison.json) · [队友分支源补丁、复跑及功能截图](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/6157a452c330d7bae175a08891b97e90459e1122/work/performance-20261122-finals-r18)

同一候选的独立功能检查通过原生键鼠、双标签切换及 JS、CSS 各 6 项。长稳连续运行 1,805.608 秒，首页与布局页交替加载十次，终点仍可导航返回首页。Chromium 和 Weston 的 PID 保持一致，串口未发现 OOM、panic 或进程丢失。宿主 QEMU 全生命周期峰值为 1,196.89 MiB。[本机长稳汇总](evidence/finals-20261122/ext4-crc32c-soak.json) · [队友分支生产源码与长稳证据](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/90951d4a387644a8eb0fe029ce22c9b933a97bc1/work/performance-20261122-finals-r18)

生产源码提交为 `0645c8575e9251ba5acb6d77df126ac414145d12`。本机默认入口已切至冷启动、功能和长稳所用的同一二进制，旧内核备份在 `data/platform/finals-next/pre-ext4-crc32c-r18-kernel.bin`。比赛现场仍以组委会统一环境和计时脚本为准。

部署后从本机默认村庄入口启动，确认实际加载上述内核。使用 Xvfb 和临时存档复核，地图、角色、资源栏和交互入口正常显示。截图在启动后固定时点采集，用于核对入口。[运行证据](evidence/finals-20261122/ext4-crc32c-deployed-entry.json) · [默认入口画面](evidence/finals-20261122/ext4-crc32c-deployed-entry.png)

## 11 月 22 日 ext4 映射与 VirtIO 等待计时

从已采用的 CRC32C 源码构建诊断版，用原 Chromium 参数和同一 Wayland 盘冷启动两次。renderer 观测前，同步数据读取占 ext4 `read_at` 抽样耗时 84.7% 和 91.3%，映射校验占 3.7% 和 6.4%。整个客体的 IRQ VirtIO 读样本无准入等待。完成结果发布至提交任务观察，在 renderer 前两轮平均约 405 微秒，renderer 至首页两轮平均约 1.08 和 1.32 毫秒。块请求与 ext4 缺页在同一边界独立抽样。优先试验单等待任务的终态唤醒特化，保留原 IRQ 回收和排空流程。[三个边界的原始计数](evidence/finals-20261122/private-file-fault-ext4-block/observations.json) · [队友分支诊断补丁和复跑](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/bec76d677776b44eb4e502a635f80a4853b82415/work/performance-20261122-finals-r19)

诊断批次可用 `--keep-going` 保留观测超时时的画面和原始记录，并完成其他样本。任何样本超时，整批仍返回失败，时延汇总只包含完成观察的样本。
