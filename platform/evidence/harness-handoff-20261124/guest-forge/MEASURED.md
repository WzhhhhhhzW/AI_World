# R117 guest keyboard and forge acceptance

On 2026-11-24 one AArch64 QEMU TCG guest ran AI_World 680ac16050f9e4963a070ef74b6f73922de6e45b. The R117 kernel and base Wayland disk digests, full command and guest session are in guest/launch.json. Ubuntu passed all 67 Python tests before the guest run. The isolated save contained a built farm and workshop, an empty provider list and two starting skills.

The guest keyboard focused Run (07), then Enter activated it. To hold the pending UI long enough for capture, the host paused the dedicated fixture server for 2.175387 seconds. The disabled Run button and outlined persistent record are visible in 08; the next guest Tab focused the record's work log heading in 09. The service resumed and delivered the original work in 10. Mouse and keyboard actions were delivered via QMP. The screenshots show the rendered Chromium focus.

The guest harvested task 1fc00716dda8, selected the forge action and created skill 1451e6fe5d95 from its first revision. guest/forge-receipt.json checks the saved and live records, exact instructions, materials and buildings inputs, and growth from two to three skills. The village clock remained paused at 480. Provider and spend ledger counts were both zero.

The Download button displayed Chromium's Download started banner (16). The guest download history (18) and Downloads directory were empty. The guest managed policy recorded in dl-policy.log sets DownloadRestrictions to 3 and disallows file selection dialogs. No exported SKILL.md was recovered. The original app and managed policy remained intact throughout this guest session.

The QEMU process (PID 859) and the fixture process (PID 842) both exited. terminal.json records an empty process readback at 09:43:02 Beijing, supervisor and VM exit 0 and clean service exit. This run covers local TCG, with no model provider or remote scoring.
