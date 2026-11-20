# x-kernel 缺页处理对照实验

候选补丁为 `borrow-fault-vma.patch`。A 使用队友仓库提交 `0b6c59600a8782762a6112eb02cfd96347e496e6` 下的 `work/performance-20261117-r1/source`。B 在相同源码上仅应用此补丁。两者的稀疏 `mprotect` 优化均已启用。原始源码树对象为 `ccb0ba43a6b31701a4b53ce532d2f357b18e1270`。[队友源码](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/tree/0b6c59600a8782762a6112eb02cfd96347e496e6/work/performance-20261117-r1/source)

## 改动与语义审计

一次通过权限检查的普通缺页原先会完整克隆 `VmArea` 三次。`MmSpace::handle_fault_input` 首先取得独立快照，`VmArea::handle_fault` 分派时克隆，`fault_vma_runtime` 在交给后端时再次克隆。有文件路径的映射每次克隆还复制 `Option<String>` 中的非空路径，文件映射后端还涉及引用计数。B 在后两处借用入口快照，将完整克隆数降到一次。对克隆多次造成的短时分配有明确预期，整机峰值与启动收益需实测。[缺页入口与后端](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/blob/0b6c59600a8782762a6112eb02cfd96347e496e6/work/performance-20261117-r1/source/mm/memspace/src/aspace.rs#L1468) · [路径元数据与分派](https://github.com/WzhhhhhhzW/KernelBridge-Chromium-Support-for-x-kernel/blob/0b6c59600a8782762a6112eb02cfd96347e496e6/work/performance-20261117-r1/source/mm/memspace/src/vma.rs#L556)

- 入口仍先处理排队的失效操作，再校验地址范围、映射存在性和权限。借用指向入口已拥有的独立快照，允许完成回调继续修改 `MmSpace`。
- 文件页偏移、页大小、实际访问标志和五类后端的选择均来自同一快照。后端类型与 VMA 的一致性校验仍由 `runtime_for_vma` 执行，返回的运行时引用持有到调用结束。
- 页表更新、TLB 操作、COW 冲突重试、文件错误到总线错误的转换及完成回调沿用原来的实现。没有新增锁或 `unsafe` 操作。匿名映射视图注册通过 `Arc` 持有，入口快照在整次分派期间保持有效。

## 应用与回退

在独立的 B 源码副本根目录执行以下命令，`$PATCH` 指向本目录补丁的绝对路径。回退时执行 `git apply --reverse "$PATCH"`。

```sh
git apply --check "$PATCH"
git apply "$PATCH"
```

补丁 SHA-256 为 `30487a5313aa7276a22236c0b76b16bb80b7eac69e600eb0dac37a973451b4ce`。已在临时目录读入提交的两个原始文件，正向应用、逆向校验、回退后均逐字节复核。候选内核已编译，SHA-256 为 `1ece67996f63420f8470c4f2a1934c9a5fea3321fb4b0f53c801d5c0d13afdb0`。本机候选位于 `data/platform/kernel-experiments/vma-fault/build.8YYsoEjJ/kernel.bin`。常规村庄及决赛页面矩阵均沿用队友重建的 A 内核。

## 本机独立构建

在 Windows PowerShell 中运行下面这条命令，会在 WSL Ubuntu 的独立目录里构建 B 版。脚本使用这台机器已有的 Rust 1.95.0、LLVM 工具、AArch64 target 和 Cargo 离线依赖。上次原版构建的 `build.log` 记录 Rust release 编译阶段用时 64 秒，B 的实际耗时以新日志为准。

```powershell
wsl -d Ubuntu -- sh /mnt/e/qilin/platform/kernel-experiments/vma-fault/build_candidate.sh
```

源码归档 `.git/candidate-source.tar` 已与指定 Git 树逐项比对，共 2255 个文件或符号链接，内容及可执行属性一致。脚本校验归档、补丁和展开后的配置摘要，在 `~/.cache/qilin-kernelbridge/vma-fault.XXXXXXXX/` 保留独立源码、`target` 和日志。成功后会打印 Windows 可访问的 `data/platform/kernel-experiments/vma-fault/build.XXXXXXXX/kernel.bin` 路径，并写出配套配置与校验和。已检查脚本 shell 语法、上次日志中 320 个外部 crate 的本机缓存，以及 `xconfig`、`xkmake` 和 AArch64 `entry` 三个离线 release 构建计划。当前尚未执行候选内核编译。

## 探针

`fault_touch.c` 只读打开指定普通文件并预热文件数据，随后每轮新建一个私有映射。在计时区间内逐个 4 KiB 页读取首尾字节，区间结束后与预读参考逐页比对。最多使用前 8 MiB，共七轮。另建一个可写私有映射，验证写入后原文件内容仍然一致。输入应来自同一磁盘镜像，并在两侧使用相同绝对路径。

```sh
aarch64-linux-gnu-gcc -std=c11 -O2 -Wall -Wextra -Werror -static -o fault-touch fault_touch.c
./fault-touch /usr/lib/chromium/chromium
```

先确认镜像内 Chromium 二进制实际路径；必要时把命令最后一个参数换成同镜像中的另一个已知常规库文件。记录文件、探针和内核 SHA-256，以及所有 `FAULT_TOUCH` 行和最终退出码。Linux x86-64 的 2048 页、七轮数据及私有写烟测已通过，静态 AArch64 ELF 已交叉生成。当前工作区中该 ELF 位于 `data/platform/kernel-experiments/vma-fault/fault-touch.aarch64`，SHA-256 为 `da9c7717d2748a32ee6e2715c07fc2a484858b92bfcf961654765380aa2d519f`。

探针的单位是同一客体内文件数据已预热时的一次私有映射遍历纳秒数。页面复制、缺页处理、循环本身均计入。对浏览器冷启的另一次 A/B 应使用独立启动的客体，每侧至少五次，交替先后，复用相同的 Chromium、启动参数、原始三页、QEMU 配置及观测器。探针与正式页指标分别采集，避免预热文件影响冷启。保留重复样本、中位数、范围、失败经过，以及完整进程生命周期的 QEMU 峰值与客体内存字段。比赛中首可用版对照另需核实 `ict-first-browser-20260923` 的实际工件与哈希。

## AArch64 TCG 实测

按 A、B、B、A 顺序独立启动 4 次。每轮使用相同只读盘，采 Chromium 可执行文件前 2,048 页的 7 次新私有映射，四轮都通过了数据校验和写时复制隔离检查。两次 A 客体的轮内中位数为 189.04、140.13 ms，两次 B 为 128.34、163.77 ms。轮间波动区间重叠，候选仍单独保留，浏览器整体耗时和长期稳定性待复验。[全部样本和输入哈希](../../evidence/finals-20261120/file-page-fault-probe.json)
