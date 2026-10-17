@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem ===========================================================================
rem  dsh-startup-kit 安装脚本（Windows）
rem
rem  为什么需要它：dsh 命令默认不在 PATH 里，但桌面端自带了一个启动器：
rem    <安装目录>\resources\runtime\cli\bin\dsh.cmd
rem  这里直接用全路径调用它，不依赖 PATH。
rem
rem  如果你把 DeepSeek Harness 装到了别处，改下面这一行。
rem ===========================================================================
set "DSH_BIN=D:\workspace\Deepseek\harness_gui\resources\runtime\cli\bin\dsh.cmd"

set "PLUGIN=%~dp0"
set "PLUGIN=%PLUGIN:~0,-1%"
set "PLUGIN_URI=%PLUGIN:\=/%"

echo.
echo  ============================================================
echo   安装 dsh-startup-kit 到 DeepSeek Harness 桌面端
echo  ============================================================
echo   插件目录：%PLUGIN%
echo   启动器  ：%DSH_BIN%
echo.

if not exist "%DSH_BIN%" (
  echo  [x] 找不到 dsh 启动器：%DSH_BIN%
  echo      请把脚本顶部 DSH_BIN 改成你实际的安装位置，或直接
  echo      用 npm i -g @deepseek-ai/dsh 装一份全局 CLI。
  echo.
  pause
  exit /b 1
)

rem 桌面端运行时会锁住 profiles\desktop 的清单，必须先完全退出
tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" 2>nul | find /I "DeepSeek Harness.exe" >nul
if not errorlevel 1 (
  echo  [x] 检测到 DeepSeek Harness 正在运行。
  echo.
  echo      请先【完全退出】桌面端（包括右下角托盘图标里右键退出），
  echo      再重新运行本脚本。
  echo.
  echo      原因：桌面端运行期间锁着 profiles\desktop 的 package.json，
  echo      此时写入会被它覆盖，或者直接报错。
  echo.
  pause
  exit /b 1
)

echo  [1/2] 安装到 desktop profile ...
call "%DSH_BIN%" plugin --profile desktop add "link:%PLUGIN_URI%"
if errorlevel 1 (
  echo.
  echo  [x] 安装失败。把上面的完整报错发给我。
  echo.
  pause
  exit /b 1
)

echo.
echo  [2/2] 完成。重新打开 DeepSeek Harness 就能看到启动动画。
echo.
echo   换动画：往 %PLUGIN%\lib\animations 里丢 .js，刷新页面即可
echo   换配置：%USERPROFILE%\.dsh\startup-kit.json
echo   先预览：node "%PLUGIN%\tools\preview.mjs"  ^(不用装也能看^)
echo.
pause
