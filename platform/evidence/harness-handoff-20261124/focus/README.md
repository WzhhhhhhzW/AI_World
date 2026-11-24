# 委托手记键盘焦点复验

Windows Chrome 157 上的两次独立运行均通过。通过 Tab 或 Shift+Tab 定位按钮，按 Enter 开工、邀请顾问和交回建议。验证脚本短暂等待本机请求发出，检查按钮禁用时的焦点，再原样放行请求并检查真实界面刷新。用户在第二次咨询过程中主动将焦点移到村庄暂停按钮，顾问回复刷新后焦点仍在暂停按钮。两次还完成了草稿转委托、两位顾问、选一条、收获、刷新和存档核对。

两份原始记录采集时当前提交为 `771f653ee3a347668917e0bf1c8b93cc7a3bf618`，待验证的焦点改动已在工作区。`ui_sha256` 记录 Windows 工作区的原始字节。将行尾统一为 LF 后，字节与后来提交 `e7ae01c5a57eeeb7ca33af0d8266debfd4b84e15` 的 `web/harness-ui.js` 一致。[第一次实测](evidence/run-1.json) · [第二次实测](evidence/run-2.json)

从仓库根目录用 Node 22+、Python 及已安装的 Chrome 或 Edge 复验。服务和浏览器均使用临时独立存档及空模型配置。

```powershell
node .\platform\evidence\harness-handoff-20261124\focus\browser-smoke.mjs (Get-Location).Path "$env:TEMP\ai-world-focus-proof"
```
