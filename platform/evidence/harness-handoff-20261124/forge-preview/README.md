# 铁匠铺 Markdown 预览与实际下载

Windows Chrome 157 的两次独立实测均通过。两轮都从真实收获的委托进入铁匠铺，核对预填的标题、说明、正文和材料，确认保存后打开「查看 SKILL.md」。每轮实际下载 710 字节，内容与该轮界面预览及按同一成果推导的 Markdown 逐字节一致。两轮使用独立的本地实习夹具，模型账本均为空。[预览画面](forged-skill-preview.png)

- [第一次回执](trial-1/evidence.json) · [第一次下载的 SKILL.md](trial-1/downloads/SKILL.md) · [第一次页面预览文本](trial-1/visible-preview.md)
- [第二次回执](trial-2/evidence.json) · [第二次下载的 SKILL.md](trial-2/downloads/SKILL.md) · [第二次页面预览文本](trial-2/visible-preview.md)

实测使用 `40a0513b35eb85c0179b5adf620975626e54517b` 工作区及后来提交于 `6d31c8aa442fc9b79a0ca72abaff66fb3055c272` 的预览改动。源码行尾统一为 LF 后与该提交的 Git 对象一致。技能来源由原委托、表单预填和实际保存请求共同确认。

从仓库根目录用 Node 22+、Python、Chrome 或 Edge 复验。新测试存档和浏览器配置位于独立临时目录。

```powershell
node .\platform\evidence\harness-handoff-20261124\forge-preview\forge-smoke.mjs (Get-Location).Path "$env:TEMP\ai-world-forge-preview"
```
