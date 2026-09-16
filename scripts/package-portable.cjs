#!/usr/bin/env node
/**
 * CSJLM Studio 便携版打包脚本
 * 用法: node scripts/package-portable.cjs
 * 前置: 已执行 pnpm build（next.config output: standalone 已开启）
 *
 * 产出:
 *   dist/csjlm-app/                 便携版组装目录（可直接双击 start.bat 运行）
 *   dist/csjlm-portable-win-x64.zip 压缩包（分发/备份）
 *   dist/installer/installer.nsi    交给 NSIS 编译出安装程序 exe
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const APP = path.join(DIST, 'csjlm-app');
const STANDALONE = path.join(ROOT, '.next', 'standalone');
const STATIC_SRC = path.join(ROOT, '.next', 'static');

const log = (m) => console.log('  ' + m);
const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true });
// robocopy 复制（Windows 原生，处理大目录/数千文件稳定；退出码 0-7 为成功）
const cp = (src, dest) => {
  fs.mkdirSync(dest, { recursive: true });
  const r = spawnSync('robocopy', [src, dest, '/E', '/MT:16', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { stdio: 'ignore' });
  log(`复制 ${path.relative(ROOT, src)} -> ${path.relative(ROOT, dest)}` + (r.status >= 8 ? ' [失败]' : ''));
};

/* ---------- 0. 校验 ---------- */
if (!fs.existsSync(path.join(STANDALONE, 'server.js'))) {
  console.error('[错误] 未找到 .next/standalone。请先执行: pnpm build（output: standalone 已开启）');
  process.exit(1);
}
if (!process.execPath || !fs.existsSync(process.execPath)) {
  console.error('[错误] 无法定位 Node 运行时');
  process.exit(1);
}

console.log('[1/6] 清理并创建组装目录');
rmrf(DIST);
fs.mkdirSync(APP, { recursive: true });
fs.mkdirSync(path.join(DIST, 'installer'), { recursive: true });

/* ---------- 1. standalone 服务器 + 精简依赖 ---------- */
console.log('[2/6] 复制 standalone 服务端（含剪枝依赖）');
// 先剔除源 standalone 内嵌的 public/media（构建产物可重建，避免 507MB 冗余拷贝进包）
rmrf(path.join(STANDALONE, 'public', 'media'));
// robocopy 全量复制但跳过内嵌 public/media（运行时媒体，无需进安装包）
fs.mkdirSync(APP, { recursive: true });
const r2 = spawnSync('robocopy', [STANDALONE, APP, '/E', '/MT:16', '/XD', path.join(APP, 'public', 'media'),
  '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { stdio: 'ignore' });
log(`复制 standalone -> csjlm-app` + (r2.status >= 8 ? ' [失败]' : ''));
rmrf(path.join(APP, '.next', 'cache'));

/* ---------- 2. 静态资源 ---------- */
/* ---------- 2.5 清理敏感/冗余 ---------- */
// Next standalone 会把整个项目根目录带入（含本地真实数据与密钥），分发包必须剔除
console.log('[2.5/6] 清理敏感与冗余文件');
const BLACKLIST = ['2026-09-15', 'AGENTS.md', 'check.bat', 'dev.bat', 'Dockerfile', 'deploy',
  'eslint.config.mjs', 'install-local.bat', 'install-local.sh', 'next.config.ts', 'next-env.d.ts',
  'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package-lock.json', 'src', 'start-prod.bat', 'stop.bat'];
const rmGlob = (base, pred) => {
  if (!fs.existsSync(base)) return;
  for (const ent of fs.readdirSync(base, { withFileTypes: true })) { if (pred(ent.name)) rmrf(path.join(base, ent.name)); }
};
rmGlob(APP, (n) => n.startsWith('.env'));            // 密钥文件
for (const b of BLACKLIST) rmrf(path.join(APP, b));
rmrf(path.join(APP, 'novel.db'));                    // 本地真实数据库
rmrf(path.join(APP, 'novel.db-shm'));
rmrf(path.join(APP, 'novel.db-wal'));
rmrf(path.join(APP, 'storage', 'database.sqlite'));
rmrf(path.join(APP, 'storage', 'system-settings.json'));
rmrf(path.join(APP, 'storage', 'ComfyUIAI', 'workflows'));
rmGlob(path.join(APP, 'storage', 'ComfyUIAI'), (n) => /^workflows/.test(n));
console.log('  ✓ 已剔除 .env / novel.db / 本地 settings / 源码与调试文件');

console.log('[3/6] 复制静态资源与 public');
const destStatic = path.join(APP, '.next', 'static');
rmrf(destStatic);
cp(STATIC_SRC, destStatic);
const destPublic = path.join(APP, 'public');
// public 已随 standalone 由 Next trace 带入，此处仅确保运行时媒体目录为空
rmrf(path.join(destPublic, 'media'));
fs.mkdirSync(path.join(destPublic, 'media'), { recursive: true });

/* ---------- 3. 内置 Node 运行时 ---------- */
console.log('[4/6] 内置 Node 运行时');
const runtimeDir = path.join(APP, 'runtime');
fs.mkdirSync(runtimeDir, { recursive: true });
fs.copyFileSync(process.execPath, path.join(runtimeDir, 'node.exe'));
log(`内置 node.exe (${process.version}) -> runtime/node.exe`);

/* ---------- 4. 运行时数据目录 ---------- */
const rt = path.join(APP, '_runtime');
fs.mkdirSync(path.join(rt, 'media'), { recursive: true });
fs.writeFileSync(path.join(rt, 'novel.db'), ''); // 占位，首次启动自动建表
log('创建 _runtime/（novel.db 与媒体数据持久化位置）');

/* ---------- 5. 启动脚本 ---------- */
console.log('[5/6] 生成启动脚本');
const startBat = [
  '@echo off',
  'chcp 65001 >nul',
  'title 创世纪联盟智能写作 - CSJLM Studio',
  'cd /d "%~dp0"',
  '',
  ':: 首次运行自动生成并保存 JWT_SECRET（_runtime\\.env）',
  'if not exist "_runtime\\.env" (',
  '  for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "[guid]::NewGuid().ToString(\"N\")"`) do (echo JWT_SECRET=%%s^> "_runtime\\.env")',
  ')',
  'setlocal',
  'for /f "usebackq delims=" %%a in ("_runtime\\.env") do set "%%a"',
  'set "JWT_SECRET=%JWT_SECRET%"',
  'endlocal & set "JWT_SECRET=%JWT_SECRET%"',
  '',
  'set "PORT=5000"',
  'set "HOSTNAME=127.0.0.1"',
  'set "NODE_ENV=production"',
  'set "DB_PATH=%~dp0_runtime\\novel.db"',
  '',
  'echo ============================================================',
  'echo   创世纪联盟智能写作 已启动',
  'echo   请用浏览器访问:  http://localhost:5000',
  'echo   关闭本窗口即停止服务',
  'echo ============================================================',
  'echo.',
  'start "" http://localhost:5000',
  '"%~dp0runtime\\node.exe" ".next\\standalone\\server.js"',
  'pause',
  '',
].join('\r\n');
fs.writeFileSync(path.join(APP, 'start.bat'), startBat, 'utf8');
log('生成 start.bat（双击即运行）');

const readmeTxt = [
  '创世纪联盟智能写作 · 便携版 / 安装版说明',
  '========================================',
  '',
  '1. 双击 start.bat 启动，浏览器自动打开 http://localhost:5000',
  '2. 关闭黑色窗口即停止服务',
  '3. 数据保存在 _runtime/ 目录（novel.db 与媒体文件），升级/重装前请备份该目录',
  '',
  '首次使用：',
  ' 1) 打开 /register 注册账号',
  ' 2) 管理员初始化：在项目目录执行 pnpm dlx tsx scripts/init-admin.ts',
  ' 3) 登录后访问 /api/admin/init-db 播种默认模板与提示词',
  ' 4) 在「AI 设置」配置文字/图片/视频模型 API',
  '',
  '端口默认 5000，如需修改请编辑 start.bat 中的 PORT 变量。',
  '',
].join('\r\n');
fs.writeFileSync(path.join(APP, '使用说明.txt'), readmeTxt, 'utf8');
log('生成 使用说明.txt');

/* ---------- 6. NSIS 安装脚本 ---------- */
console.log('[6/6] 生成 NSIS 安装脚本');
const nsi = [
  'Unicode true',
  'Name "创世纪联盟智能写作"',
  'OutFile "CSJLM-Studio-Setup.exe"',
  'InstallDir "$LOCALAPPDATA\\CSJLM Studio"',
  'InstallDirRegKey HKCU "Software\\CSJLM Studio" ""',
  'RequestExecutionLevel user',
  'SetCompressor /SOLID lzma',
  '',
  '!include "MUI2.nsh"',
  '!insertmacro MUI_PAGE_WELCOME',
  '!insertmacro MUI_PAGE_DIRECTORY',
  '!insertmacro MUI_PAGE_INSTFILES',
  '!insertmacro MUI_PAGE_FINISH',
  '!insertmacro MUI_UNPAGE_CONFIRM',
  '!insertmacro MUI_UNPAGE_INSTFILES',
  '!insertmacro MUI_LANGUAGE "SimpChinese"',
  '',
  'Section "安装" SecMain',
  '  SetOutPath "$INSTDIR"',
  '  File /r "..\\csjlm-app\\*.*"',
  '',
  '  WriteRegStr HKCU "Software\\CSJLM Studio" "" $INSTDIR',
  '  WriteUninstaller "$INSTDIR\\uninstall.exe"',
  '',
  '  CreateDirectory "$SMPROGRAMS\\创世纪联盟智能写作"',
  '  CreateShortcut "$SMPROGRAMS\\创世纪联盟智能写作\\启动系统.lnk" "$INSTDIR\\start.bat" "" "$INSTDIR\\start.bat" 0 SW_SHOWNORMAL "" "启动创世纪联盟智能写作"',
  '  CreateShortcut "$SMPROGRAMS\\创世纪联盟智能写作\\卸载.lnk" "$INSTDIR\\uninstall.exe"',
  'SectionEnd',
  '',
  'Section "Uninstall"',
  '  Delete "$SMPROGRAMS\\创世纪联盟智能写作\\启动系统.lnk"',
  '  Delete "$SMPROGRAMS\\创世纪联盟智能写作\\卸载.lnk"',
  '  RMDir "$SMPROGRAMS\\创世纪联盟智能写作"',
  '  Delete "$INSTDIR\\uninstall.exe"',
  '  DeleteRegKey HKCU "Software\\CSJLM Studio"',
  '  RMDir /r "$INSTDIR"',
  'SectionEnd',
  '',
].join('\r\n');
fs.writeFileSync(path.join(DIST, 'installer', 'installer.nsi'), nsi, 'utf8');
log('生成 installer/installer.nsi（NSIS 编译: makensis -CODEPAGE=CP936 installer.nsi）');

/* ---------- 打包 zip ---------- */
console.log('打包 zip ...');
try {
  execSync(`cd "${DIST}" && tar -a -c -f csjlm-portable-win-x64.zip csjlm-app`, { stdio: 'inherit', shell: true });
  log('生成 csjlm-portable-win-x64.zip');
} catch (e) {
  console.log('  (zip 压缩失败，可手动压缩 dist/csjlm-app 目录)');
}

console.log('\n完成！产物:');
console.log('  ' + APP);
console.log('  ' + path.join(DIST, 'csjlm-portable-win-x64.zip'));
console.log('  ' + path.join(DIST, 'installer', 'installer.nsi'));