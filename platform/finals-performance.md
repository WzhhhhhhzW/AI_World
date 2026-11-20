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
