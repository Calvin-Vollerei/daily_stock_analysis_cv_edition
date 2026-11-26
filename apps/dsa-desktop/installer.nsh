; Daily Stock Analysis — CV Edition / NSIS 定制（精简版）
;
; 只保留一个必须的改动，其余全部沿用 electron-builder 24.13.3 默认行为。
;
; customInstallMode：强制「仅为我安装」（per-user）。
; 后端 exe 与 Electron 资源必须落在当前用户可写目录，不能走 per-machine
; 写 Program Files（本项目没有代码签名证书，也不启用提权）。
;
; 已删除的历史定制 —— 这两个是「写盘前就退出 / 静默安装永挂」的元凶：
;
; 1) .onVerifyInstDir：
;      前缀命中 $PROGRAMFILES/$PROGRAMFILES64/$PROGRAMFILES32/$WINDIR 就 Abort。
;      在「自定义安装目录 + per-user」场景下把正常目录判为非法，
;      安装器在进入安装段之前就被终止，磁盘上一个文件都不会写。
;
; 2) _dsaRetryQuotedOldUninstall：
;      老版本卸载器重试宏，内部 MessageBox + SetErrorLevel 2 + Quit。
;      静默安装 (/S) 下 MessageBox 依然会弹出并永久阻塞，
;      表现为「装了很久什么都没装」。

!macro customInstallMode
  StrCpy $isForceCurrentInstall 1
!macroend
