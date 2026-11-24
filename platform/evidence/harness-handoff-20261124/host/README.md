# Windows 浏览器复验 · 从聊天草稿到多顾问委托

在 AI_World 仓库根目录打开 PowerShell。需要 Node.js 22 及以上版本、可执行本项目的 Python 3，以及本机安装的 Chrome 或 Edge。脚本通过 Node 自带的 WebSocket 连接 Chromium 调试接口，无需安装 npm 包。

```powershell
node .\platform\evidence\harness-handoff-20261124\host\browser-smoke.mjs (Get-Location).Path "$env:TEMP\ai-world-validation"
```

第一个参数是含 `server.py` 的仓库目录，第二个参数是证据输出目录。省略参数时分别使用当前目录和系统临时目录下的 `ai-world-browser-smoke`。可通过 `HARNESS_BROWSER_PATH` 指定 Chromium 的可执行文件，通过 `HARNESS_PYTHON_PATH` 指定 Python 的可执行文件。

## 操作和通过条件

脚本创建独立的临时村庄，保持初始三名居民、建成菜园并暂停村庄时钟。模型配置为空，村庄服务只监听本机回环地址。它启动一个独立的临时浏览器配置，点击地图上的居民，把未发送的消息转入委托，让主理人先交稿，再依次邀请两名不同顾问。脚本勾选第二位顾问的一条提示，点击交回、验收并刷新，然后重新打开委托。

退出码为 0 时，浏览器已实际提交一次播种和五次任务操作，刷新后的详情与磁盘存档一致，两份顾问记录各自留有相应的选择，第二版主理人输入只包含选中的提示，聊天记录和模型账本为空。每次成功运行在输出目录生成一份带时间戳的记录和两张截图。执行失败时记录阶段、错误和可获得的截图。任务数据与浏览器临时配置在收尾时删除。

## 已有证据

`evidence/evidence.json` 和两张 PNG 是 2026 年 11 月 24 日北京时间 08:27 的原始 Windows 验证输出，来源目录为 `runs/2026-11-24T00-27-35-683Z`。使用 Chrome 157.0.8103.81，验证程序及村庄服务均以 0 退出。原始记录包含测试生成的居民 ID、委托 ID 和本地工作树路径，全部村务内容来自初始夹具与固定测试文案。

首次运行针对当时已集成的工作树；原始 JSON 未采集 Git 提交哈希。整理此包时核对的 AI_World 交付提交为 `ff2278f233ba2bcfa2dbe0db3a6eaf2045e6bb16`。本包脚本将执行文件与目录改为可配置，并在新记录中写入运行时的 checkout HEAD。发布前对这个可移植脚本做了静态语法检查。现有浏览器截图及 JSON 来自最初的真实运行。x-kernel 客体运行结果需查看独立的客体证据。

三份原始文件的 SHA-256 均可用 `Get-FileHash -Algorithm SHA256` 与 `SHA256SUMS` 核对。最初运行采用的宿主脚本 SHA-256 为 `4511994bfc78f58ed6b9a18ea38ab375c41043e24b6d8bd77f091bd618b12252`。
