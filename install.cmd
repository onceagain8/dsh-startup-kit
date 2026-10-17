@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

rem ===========================================================================
rem  dsh-startup-kit 安装脚本（Windows / 桌面端）
rem
rem  它做三件事：
rem    1. 找到 dsh 启动器（桌面端自带，但通常不在 PATH 里）
rem    2. 提醒桌面端先退出（运行期间 profile 被锁，写入会被覆盖）
rem    3. 把本目录作为一个插件装进 desktop profile
rem
rem  找不到启动器时，可以自己指定：
rem    set DSH_BIN_OVERRIDE=C:\path\to\dsh.cmd  然后双击本脚本
rem ===========================================================================

echo.
echo  ============================================================
echo   安装 dsh-startup-kit 到 DeepSeek Harness 桌面端
echo  ============================================================
echo.

set "PLUGIN=%~dp0"
set "PLUGIN=%PLUGIN:~0,-1%"
set "PLUGIN_URI=%PLUGIN:\=/%"
set "LOG=%TEMP%\dsh-startup-kit-install.log"

echo  插件目录：%PLUGIN%
echo.

rem ---------------------------------------------------------------------------
rem  找 dsh.cmd
rem ---------------------------------------------------------------------------
set "DSH_BIN="

if defined DSH_BIN_OVERRIDE if exist "%DSH_BIN_OVERRIDE%" set "DSH_BIN=%DSH_BIN_OVERRIDE%"

rem 1) 桌面端装过命令行工具的话，注册表里记着目录
if not defined DSH_BIN call :from_registry

rem 2) 常见安装位置
if not defined DSH_BIN call :try_dir "%LOCALAPPDATA%\Programs\DeepSeek Harness"
if not defined DSH_BIN call :try_dir "%ProgramFiles%\DeepSeek Harness"
set "PF86=%ProgramFiles(x86)%"
if not defined DSH_BIN call :try_dir "%PF86%\DeepSeek Harness"

rem 3) PATH 里就更好
if not defined DSH_BIN for /f "delims=" %%A in ('where dsh.cmd 2^>nul') do if not defined DSH_BIN set "DSH_BIN=%%A"

rem 4) 还是找不到，问人
if not defined DSH_BIN (
  echo  [!] 没能自动找到 dsh.cmd。它通常在这里：
  echo        ^<安装目录^>\resources\runtime\cli\bin\dsh.cmd
  echo.
  echo      也可以只填安装目录，脚本会自己补全。
  echo.
  set /p "DSH_BIN=  路径（直接回车放弃）: "
)

if defined DSH_BIN set DSH_BIN=%DSH_BIN:"=%
if defined DSH_BIN if exist "%DSH_BIN%\" set "DSH_BIN=%DSH_BIN%\resources\runtime\cli\bin\dsh.cmd"
if defined DSH_BIN if not exist "%DSH_BIN%" set "DSH_BIN="

if not defined DSH_BIN (
  echo.
  echo  [x] 找不到 dsh 启动器，安装中止。
  echo.
  echo      如果你是用 npm 全局装的 CLI，可以这样指定：
  echo        set DSH_BIN_OVERRIDE=C:\path\to\dsh.cmd
  echo        然后再运行本脚本。
  echo.
  pause
  exit /b 1
)

echo  [1/3] 启动器：%DSH_BIN%

rem ---------------------------------------------------------------------------
rem  提前提醒：桌面端开着的话，写入会被锁挡住
rem  这里只是"提醒"，不硬性拦截 —— 因为进程枚举在某些环境下取不到，
rem  真正的判据是下面安装失败时的报错。
rem ---------------------------------------------------------------------------
tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" 2>nul | find /I "DeepSeek Harness.exe" >nul
if not errorlevel 1 (
  echo  [!] 检测到 DeepSeek Harness 正在运行。
  echo.
  echo      请先【完全退出】桌面端（包括右下角托盘图标里右键退出），再重新运行本脚本。
  echo      原因：桌面端运行期间锁着 profiles\desktop 的 package.json，写入会被覆盖。
  echo.
  pause
  exit /b 1
)

if exist "%USERPROFILE%\.dsh\profiles\desktop\package.json.lock" (
  echo  [!] profile 里有锁文件，桌面端可能仍在运行（若已退出可忽略这条）。
)
echo  [2/3] 环境检查通过

rem ---------------------------------------------------------------------------
rem  安装
rem ---------------------------------------------------------------------------
echo  [3/3] 写入 desktop profile ...
echo.
call "%DSH_BIN%" plugin --profile desktop add "link:%PLUGIN_URI%" > "%LOG%" 2>&1
if errorlevel 1 goto :install_failed

type "%LOG%"
echo.
echo  完成。重新打开 DeepSeek Harness 就能看到启动动画。
echo.
echo    换动画：往 %PLUGIN%\lib\animations 里丢 .js 文件
echo    改配置：%USERPROFILE%\.dsh\startup-kit.json ^(或在左下角 ◆ 面板里改^)
echo    出问题：node "%PLUGIN%\tools\diagnose.mjs"
echo.
if exist "%LOG%" del "%LOG%" >nul 2>&1
pause
exit /b 0

rem ---------------------------------------------------------------------------
rem  失败处理：先看日志里是不是"锁"
rem ---------------------------------------------------------------------------
:install_failed
echo.
type "%LOG%"
echo.
findstr /i /c:"EPERM" /c:"lock" /c:"被占用" "%LOG%" >nul 2>&1
if not errorlevel 1 goto :locked
echo  [x] 安装失败。把上面的完整报错发到仓库的 Issues 里。
echo.
pause
exit /b 1

:locked
echo  [x] 写入 profile 时被锁挡住了 —— 桌面端多半还在运行。
echo.
echo      请【完全退出】DeepSeek Harness（托盘图标右键退出，只关窗口不算），
echo      然后重新运行本脚本。
echo.
pause
exit /b 1

rem ---------------------------------------------------------------------------
rem  子过程
rem ---------------------------------------------------------------------------

:from_registry
for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\DeepSeekHarness\Command" /v Directory 2^>nul ^| findstr /i "Directory"') do (
  if exist "%%B\dsh.cmd" set "DSH_BIN=%%B\dsh.cmd"
)
exit /b 0

:try_dir
if defined DSH_BIN exit /b 0
if exist "%~1\resources\runtime\cli\bin\dsh.cmd" set "DSH_BIN=%~1\resources\runtime\cli\bin\dsh.cmd"
exit /b 0
