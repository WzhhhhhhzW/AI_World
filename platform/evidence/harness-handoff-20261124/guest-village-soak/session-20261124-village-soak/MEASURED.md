# R117 guest interactive village acceptance · 24 November 2026

At AI_World commit `a68c9eec38f34cdcea7b4a512310d9d567e056b6`, the village stayed active for **1800.004243047 monotonic seconds** between the initial running snapshot and the final running checkpoint. One AArch64 R117 TCG guest ran Chromium against its dedicated offline village service. At 0, 15 and 30 minutes a guest pointer click opened the empty task board and a guest Escape returned to the map. All three pairs of original 1280 × 800 screenshots were inspected.

| Checkpoint, Beijing time | Simulation clock from API | Disk clock | Wood | Stone | Crops |
|---|---:|---:|---:|---:|---:|
| Running, 10:53:47.470 | 490 | 480 | 60 | 40 | 0 |
| Midpoint, 11:08:47.478 | 4082 | 4080 | 168 | 116 | 3 |
| 30 minutes, 11:23:47.477 | 7674 | 7660 | 280 | 192 | 7 |
| Final pause, confirmed at 11:24:18.996 | 7784 | 7784 | 284 | 196 | 7 |

The renderer was visibly interactive on game days 1, 3 and 6. Each task-board image shows its title, available actions and zero orders. Each return image shows the village and HUD. Thirty local state and health samples tracked progress between the full recorded checkpoints. The village simulation ran in the host-side Python service, with the guest rendering and sending the interactions. The clock continues between state snapshots and UI captures. Disk snapshots follow the application's periodic save; after the final pause the persisted and live state matched and the clock stayed fixed on a separate read.

The fresh save started paused, with a farm and workshop, three default residents, two stock skills, no tasks, no configured providers and zero ledger entries. Those counts, disabled autonomy and zero resident model usage and reservations were checked throughout. This is local village application acceptance. The contest browser workload and native KVM scoring require separate tests.

The runtime kernel was `9db7df1ef1558226c2b6478dbb56aa9a717aad2f9f14241f85b7105c865c0682`. The base Wayland image digest and actual QEMU command are recorded in `guest/launch.json`. An initial Linux Git comparison misread the checkout's Windows line endings and returned before starting the VM or the service. The launch script used Windows-compatible Git normalization, verified the pinned source, and started a single guest. Independent Windows checks verified a clean tracked checkout and 16 runtime source files against the commit. QEMU PID 710 and fixture PID 696 both exited cleanly. The actual terminal readback at 11:24:38 Beijing found neither process. The observer, VM, service and launcher all returned zero.

To replay this archive, run `python -B audit.py` from this directory. The audit checks the publication manifest when present, source identity, snapshots, clocks, inventories, absence of model usage, UI input receipts, reviewed screenshot digests and exit receipts. Use `visual-review.json` to locate the six original screenshots. Full pre-action screenshots remain in the original local run. To repeat the workload separately, copy the scripts into a clean run directory, retain its parent helper layout, and update the explicit launch-time cutoff for a newly authorized slot.
