# 恢复村庄存档

备份包含保存时的村庄状态、会议和私聊记录，以及居民已绑定的模型密钥。恢复口令由备份持有人在本机保管。备份可以在另一台电脑上恢复，Windows 会用恢复者的账户重新加密居民密钥。

在刚下载的游戏目录中，先恢复，再启动游戏。用 Python 3.10 或更高版本执行以下命令，把文件名替换为本目录中的实际备份文件名。

```powershell
python -m pip install cryptography
python backups/restore.py backups/文件名.fernet
```

按提示输入恢复口令，也可通过 `--key-file` 指定本机口令文件。恢复完成后双击根目录的 **启动游戏.cmd**。

已有村庄时，请先在游戏设置中保存退出。通过 `--to data-restored` 可以恢复至独立目录。随后执行 `python server.py --data data-restored/village.json` 即可打开该村庄。恢复工具要求目标目录尚未存在。
