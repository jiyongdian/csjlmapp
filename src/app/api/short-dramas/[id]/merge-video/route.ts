import { NextRequest, NextResponse } from 'next/server';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getUserFromToken } from '@/lib/auth';
import { getSystemSettings, buildMediaWebBase } from '@/lib/system-settings';
import { dramaWorkflowManager, shortDramaManager } from '@/storage/database';

type MergeScope = 'episode' | 'full' | 'custom';
type MergeClipInput = {
  shotId?: string;
  id?: string;
  enabled?: boolean;
  trimStart?: number;
  trimEnd?: number;
  volume?: number;
  muted?: boolean;
  subtitleEnabled?: boolean;
  subtitleText?: string;
  subtitleStyle?: SubtitleStyle;
  dubbingEnabled?: boolean;
  audioUrl?: string;
  audioVolume?: number;
  dubbingAudios?: Array<string | { audioUrl?: string; text?: string; character?: string }>;
};
type SubtitleStyle = {
  fontSize?: number;
  primaryColor?: string;
  outlineColor?: string;
  marginV?: number;
};
type PreparedClip = {
  shot: Awaited<ReturnType<typeof dramaWorkflowManager.getShotsByDramaId>>[number];
  inputPath: string;
  trimStart: number;
  duration: number;
  volume: number;
  muted: boolean;
  subtitleEnabled: boolean;
  subtitleText: string;
  subtitleStyle: SubtitleStyle;
  dubbingEnabled: boolean;
  audioPaths: string[];
  audioVolume: number;
};

function sanitizeFilePart(value: string) {
  return (value || 'video').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || 'video';
}

async function getDramaWorkDirs(dramaId: string) {
  const drama = await shortDramaManager.getById(dramaId);
  const settings = await getSystemSettings();
  const baseSavePath = settings.mediaSavePath || 'public';
  const mediaWebPath = settings.mediaWebPath || '/media';
  const websiteUrl = settings.websiteUrl ? settings.websiteUrl.replace(/\/$/, '') : '';
  const rootPhysicalPath = path.isAbsolute(baseSavePath)
    ? baseSavePath
    : path.join(process.cwd(), baseSavePath);
  const folderName = `${sanitizeFilePart(drama?.title || 'untitled')}_${dramaId}`;
  const baseDir = path.join(rootPhysicalPath, 'media', settings.dramaSavePath || 'works', folderName);
  const videosDir = path.join(baseDir, 'videos');
  fs.mkdirSync(videosDir, { recursive: true });
  return {
    videosDir,
    webPrefix: `${buildMediaWebBase(settings)}/${settings.dramaSavePath || 'works'}/${folderName}/videos`,
    rootPhysicalPath,
    mediaWebPath,
    websiteUrl,
  };
}

function resolveLocalMediaPath(url: string, rootPhysicalPath: string, mediaWebPath: string, websiteUrl: string) {
  const raw = String(url || '').trim();
  if (!raw || raw.startsWith('http') && (!websiteUrl || !raw.startsWith(websiteUrl))) return '';

  let cleanUrl = raw;
  if (websiteUrl && cleanUrl.startsWith(websiteUrl)) cleanUrl = cleanUrl.slice(websiteUrl.length);
  if (!cleanUrl.startsWith('/')) return '';

  const normalizedMediaWebPath = /^https?:\/\//i.test(mediaWebPath)
    ? (() => { try { return new URL(mediaWebPath).pathname.replace(/\/+$/, '') || '/media'; } catch { return '/media'; } })()
    : `/${mediaWebPath.replace(/^\/+|\/+$/g, '') || 'media'}`;

  let publicPath = decodeURIComponent(cleanUrl.split('?')[0] || '');
  if (publicPath.startsWith(`${normalizedMediaWebPath}/`)) {
    publicPath = `/media${publicPath.slice(normalizedMediaWebPath.length)}`;
  }
  if (!publicPath.startsWith('/media/')) return '';

  const resolved = path.resolve(rootPhysicalPath, publicPath.replace(/^\/+/, ''));
  const allowedRoot = path.resolve(rootPhysicalPath).toLowerCase();
  const normalized = resolved.toLowerCase();
  if (normalized !== allowedRoot && !normalized.startsWith(`${allowedRoot}${path.sep}`)) return '';
  return fs.existsSync(resolved) ? resolved : '';
}

function findFfmpegExecutable(): string {
  // 优先级：系统设置 ffmpeg.path > 环境变量 FFMPEG_PATH > 常见系统安装目录 >
  //        工程 node_modules 包 > 跨项目工具目录 > PATH 实际探测
  // 注意：所有候选都做 fs.existsSync() / spawnSync 真实探测，避免返回无效路径
  const candidates: string[] = [];

  // (1) 系统设置中的自定义路径（最高优先级，数据库中配置）
  try {
    const settings = getSystemSettings() as { ffmpeg?: { path?: string } };
    if (settings?.ffmpeg?.path) candidates.push(settings.ffmpeg.path);
  } catch { /* ignore DB errors during lookup */ }

  // (2) 环境变量 FFMPEG_PATH（支持在 .env / .env.local / 系统环境变量中配置）
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);

  // (3) 常见系统级 / 手动安装位置
  candidates.push(
    'C:\\ffmpeg\\bin\\ffmpeg.exe',                        // 本项目约定安装目录
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',          // 标准 Program Files
    'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(process.env.LOCALAPPDATA || '', 'ffmpeg', 'bin', 'ffmpeg.exe'), // 用户级
    path.join(process.env.PROGRAMDATA || '', 'chocolatey', 'bin', 'ffmpeg.exe'), // Chocolatey
  );

  // (4) winget 安装路径（Gyan.FFmpeg 通常装到 %LOCALAPPDATA%\Microsoft\WinGet\...）
  try {
    const wingetPackages = path.join(
      process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages'
    );
    if (fs.existsSync(wingetPackages)) {
      const entries = fs.readdirSync(wingetPackages, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && e.name.toLowerCase().includes('gyan.ffmpeg')) {
          const p = path.join(wingetPackages, e.name, 'bin', 'ffmpeg.exe');
          candidates.push(p);
        }
      }
    }
  } catch { /* ignore */ }

  // (5) 工程内 / 跨项目的 node_modules 兜底
  candidates.push(
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
    path.join(process.cwd(), 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe'),
    path.resolve(process.cwd(), '..', 'huohuo', 'workbench-server', 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe'),
    path.resolve(process.cwd(), '..', 'LocalMiniDrama-main', 'backend-node', 'tools', 'ffmpeg', 'ffmpeg.exe'),
    path.resolve(process.cwd(), '..', 'MagicalCanvas-main', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
  );

  // 第一轮：fs.existsSync() 命中即返回
  for (const c of candidates) {
    if (!c) continue;
    try { if (fs.existsSync(c)) return c; } catch {}
  }

  // 第二轮：真实 PATH 探测（通过 spawnSync 执行，避免 where.exe 结果不一致 / shell 环境问题）
  try {
    const probe = spawnSync('ffmpeg', ['-version'], {
      windowsHide: true, timeout: 5000,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    if (probe.status === 0) return 'ffmpeg';
  } catch {}

  // 最终兜底：依旧返回 'ffmpeg' 字符串，让上层 spawn 调用自然报 ENOENT
  // runFfmpeg 中会捕获 error.code === 'ENOENT' 并输出中文友好提示
  return 'ffmpeg';
}

function runFfmpeg(args: string[]) {
  const executable = findFfmpegExecutable();
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new Error('未找到 ffmpeg，无法合拼视频。请先安装 ffmpeg，或在环境变量 FFMPEG_PATH 中配置 ffmpeg.exe 路径。'));
        return;
      }
      reject(error);
    });
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `ffmpeg 执行失败，退出码 ${code}`));
    });
  });
}

function ffmpegConcatPath(filePath: string) {
  return path.resolve(filePath).replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function ffmpegFilterPath(filePath: string) {
  return path.resolve(filePath).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function normalizeMediaRecords(value: unknown): Array<{ audioUrl: string; text?: string; character?: string }> {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === 'string') return { audioUrl: item };
        if (item && typeof item === 'object') {
          const record = item as { audioUrl?: unknown; text?: unknown; character?: unknown };
          return {
            audioUrl: String(record.audioUrl || ''),
            text: record.text ? String(record.text) : undefined,
            character: record.character ? String(record.character) : undefined,
          };
        }
        return null;
      })
      .filter((item): item is { audioUrl: string; text?: string; character?: string } => !!item?.audioUrl);
  }
  if (typeof value !== 'string') return [];
  const raw = value.trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      return normalizeMediaRecords(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [{ audioUrl: raw }];
}

function getDefaultSubtitleText(shot: PreparedClip['shot']) {
  return String(shot.subtitle || shot.ttsText || shot.voiceover || shot.dialogue || '').trim();
}

function resolveAudioPaths(
  clip: MergeClipInput,
  shot: PreparedClip['shot'],
  rootPhysicalPath: string,
  mediaWebPath: string,
  websiteUrl: string
) {
  const records = [
    ...normalizeMediaRecords(clip.dubbingAudios),
    ...normalizeMediaRecords(clip.audioUrl),
  ];
  const sourceRecords = records.length > 0 ? records : normalizeMediaRecords(shot.audioUrl);
  const paths = sourceRecords
    .map(record => {
      const localPath = resolveLocalMediaPath(record.audioUrl, rootPhysicalPath, mediaWebPath, websiteUrl);
      if (localPath) return localPath;
      const raw = String(record.audioUrl || '').trim();
      return /^https?:\/\//i.test(raw) ? raw : '';
    })
    .filter(Boolean);
  return Array.from(new Set(paths));
}

function hexToAssColor(color: unknown, fallback: string) {
  const raw = String(color || '').trim().replace(/^#/, '');
  const hex = raw.length === 3
    ? raw.split('').map(ch => `${ch}${ch}`).join('')
    : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  const rr = hex.slice(0, 2).toUpperCase();
  const gg = hex.slice(2, 4).toUpperCase();
  const bb = hex.slice(4, 6).toUpperCase();
  return `&H00${bb}${gg}${rr}`;
}

function formatAssTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const cs = Math.floor((safe - Math.floor(safe)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function wrapSubtitleText(text: string, maxChars = 24, maxLines = 3) {
  const clean = text
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[{}]/g, '')
    .trim();
  if (!clean) return '';
  const lines: string[] = [];
  for (const paragraph of clean.split(/\n+/)) {
    const chars = Array.from(paragraph.trim());
    for (let i = 0; i < chars.length; i += maxChars) {
      lines.push(chars.slice(i, i + maxChars).join(''));
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) break;
  }
  return lines.join('\\N').replace(/,/g, '，');
}

function writeAssSubtitleFile(filePath: string, text: string, duration: number, style: SubtitleStyle = {}) {
  const fontSize = clampNumber(style.fontSize, 18, 96, 42);
  const marginV = Math.round(clampNumber(style.marginV, 30, 420, 130));
  const primary = hexToAssColor(style.primaryColor, '&H00FFFFFF');
  const outline = hexToAssColor(style.outlineColor, '&H00000000');
  const subtitle = wrapSubtitleText(text);
  const content = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'PlayResX: 1080',
    'PlayResY: 1920',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Microsoft YaHei,${fontSize},${primary},&H00FFFFFF,${outline},&H66000000,1,0,0,0,100,100,0,0,1,3,0,2,70,70,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,${formatAssTime(0)},${formatAssTime(duration)},Default,,0,0,0,,${subtitle}`,
  ].join('\n');
  fs.writeFileSync(filePath, content, 'utf-8');
}

async function prepareEditedSegment(clip: PreparedClip, segmentPath: string) {
  const args = ['-y'];
  if (clip.trimStart > 0) args.push('-ss', String(clip.trimStart));
  if (clip.duration > 0) args.push('-t', String(clip.duration));
  args.push('-i', clip.inputPath);

  const tempFiles: string[] = [];
  const videoFilters = ['scale=trunc(iw/2)*2:trunc(ih/2)*2', 'setsar=1'];
  if (clip.subtitleEnabled && clip.subtitleText.trim()) {
    const assPath = path.join(os.tmpdir(), `merge_sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.ass`);
    writeAssSubtitleFile(assPath, clip.subtitleText, clip.duration, clip.subtitleStyle);
    tempFiles.push(assPath);
    videoFilters.push(`ass='${ffmpegFilterPath(assPath)}'`);
  }

  const hasDubbingAudio = clip.dubbingEnabled && clip.audioPaths.length > 0;
  if (hasDubbingAudio) {
    for (const audioPath of clip.audioPaths) args.push('-i', audioPath);
    const filterParts = [`[0:v]${videoFilters.join(',')}[v]`];
    const audioRefs = clip.audioPaths.map((_, index) => `[${index + 1}:a]`).join('');
    const concat = clip.audioPaths.length > 1
      ? `${audioRefs}concat=n=${clip.audioPaths.length}:v=0:a=1,`
      : `[1:a]`;
    filterParts.push(`${concat}atrim=0:${clip.duration},asetpts=PTS-STARTPTS,apad,atrim=0:${clip.duration},volume=${clip.audioVolume}[a]`);
    args.push('-filter_complex', filterParts.join(';'), '-map', '[v]', '-map', '[a]');
  } else {
    args.push('-map', '0:v:0');
    if (clip.muted || clip.volume <= 0) {
      args.push('-an');
    } else {
      args.push('-map', '0:a?');
    }
    args.push('-vf', videoFilters.join(','));
    if (!clip.muted && clip.volume > 0) {
      args.push('-af', `volume=${clip.volume}`);
    }
  }
  args.push(
    '-r', '30',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p'
  );
  if (hasDubbingAudio || (!clip.muted && clip.volume > 0)) {
    args.push('-c:a', 'aac', '-b:a', '160k');
  }
  args.push('-t', String(clip.duration), '-movflags', '+faststart', segmentPath);
  try {
    await runFfmpeg(args);
  } finally {
    for (const tempFile of tempFiles) {
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }
}

async function mergeVideos(inputPaths: string[], outputPath: string) {
  const listPath = path.join(path.dirname(outputPath), `${path.basename(outputPath, '.mp4')}.txt`);
  fs.writeFileSync(
    listPath,
    inputPaths.map(filePath => `file '${ffmpegConcatPath(filePath)}'`).join('\n'),
    'utf-8'
  );

  try {
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', outputPath]);
  } catch (copyError) {
    await runFfmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outputPath,
    ]);
  } finally {
    try { fs.unlinkSync(listPath); } catch {}
  }
}

async function mergeEditedClips(clips: PreparedClip[], outputPath: string) {
  const tempDir = path.join(path.dirname(outputPath), `.merge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const segmentPaths: string[] = [];
  try {
    for (let i = 0; i < clips.length; i++) {
      const segmentPath = path.join(tempDir, `segment_${String(i + 1).padStart(3, '0')}.mp4`);
      await prepareEditedSegment(clips[i], segmentPath);
      segmentPaths.push(segmentPath);
    }
    await mergeVideos(segmentPaths, outputPath);
  } finally {
    for (const segmentPath of segmentPaths) {
      try { fs.unlinkSync(segmentPath); } catch {}
    }
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id: dramaId } = await params;
    const drama = await shortDramaManager.getById(dramaId);
    if (!drama || (drama.userId !== payload.userId && payload.role !== 'admin')) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }
    const assets = await dramaWorkflowManager.getAssetsByDramaId(dramaId, 'merged-video');
    return NextResponse.json({ success: true, data: assets });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '获取合拼记录失败' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id: dramaId } = await params;
    const drama = await shortDramaManager.getById(dramaId);
    if (!drama || (drama.userId !== payload.userId && payload.role !== 'admin')) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const scope: MergeScope = ['episode', 'full', 'custom'].includes(body.scope) ? body.scope : 'episode';
    const episodeId = String(body.episodeId || '');
    const selectedShotIds: string[] = Array.isArray(body.shotIds) ? body.shotIds.map(String) : [];
    const clipInputs: MergeClipInput[] = Array.isArray(body.clips) ? body.clips : [];
    const hasEditedTimeline = clipInputs.length > 0;
    const includeSubtitles = body.includeSubtitles !== false;
    const includeDubbing = body.includeDubbing !== false;
    const globalSubtitleStyle: SubtitleStyle = body.subtitleStyle && typeof body.subtitleStyle === 'object' ? body.subtitleStyle : {};
    const outputName = sanitizeFilePart(body.outputName || `${drama.title || '短剧'}_${scope === 'full' ? '整部合拼' : '分集合拼'}`);

    let shots = await dramaWorkflowManager.getShotsByDramaId(dramaId);
    if (hasEditedTimeline) {
      const shotMap = new Map(shots.map(shot => [shot.id, shot]));
      shots = clipInputs
        .filter(clip => clip.enabled !== false)
        .map(clip => shotMap.get(String(clip.shotId || clip.id || '')))
        .filter(Boolean) as typeof shots;
    } else if (scope === 'episode') {
      if (!episodeId) return NextResponse.json({ error: '请选择要合拼的分集' }, { status: 400 });
      shots = shots.filter(shot => shot.episodeId === episodeId);
    } else if (scope === 'custom') {
      if (selectedShotIds.length === 0) return NextResponse.json({ error: '请至少选择一个要合拼的镜头' }, { status: 400 });
      const order = new Map(selectedShotIds.map((id, index) => [id, index]));
      shots = shots.filter(shot => order.has(shot.id)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }

    const videoShots = shots.filter(shot => !!shot.videoUrl);
    if (videoShots.length < 2) {
      return NextResponse.json({ error: '至少需要 2 个已生成视频的分镜才能合拼' }, { status: 400 });
    }

    const { videosDir, webPrefix, rootPhysicalPath, mediaWebPath, websiteUrl } = await getDramaWorkDirs(dramaId);
    const shotPathMap = new Map(videoShots.map(shot => [shot.id, resolveLocalMediaPath(shot.videoUrl || '', rootPhysicalPath, mediaWebPath, websiteUrl)]));
    const inputPaths = videoShots.map(shot => shotPathMap.get(shot.id) || '');
    const missingIndex = inputPaths.findIndex(filePath => !filePath);
    if (missingIndex >= 0) {
      return NextResponse.json({ error: `镜头 #${videoShots[missingIndex].shotNumber} 的视频不是本地可读取文件，请先刷新或重新生成该镜头视频` }, { status: 400 });
    }

    const filename = `${outputName}_${Date.now()}.mp4`;
    const outputPath = path.join(videosDir, filename);
    let editedClips: PreparedClip[] = [];
    const buildPreparedClip = (shot: (typeof videoShots)[number], clip: MergeClipInput = {}): PreparedClip => {
      const trimStart = Math.max(0, Number(clip.trimStart) || 0);
      const defaultDuration = Math.max(0.2, Number(shot.duration) || 3);
      const rawTrimEnd = Number(clip.trimEnd);
      const trimEnd = Number.isFinite(rawTrimEnd) && rawTrimEnd > 0 ? rawTrimEnd : defaultDuration;
      const duration = Math.max(0.2, trimEnd - trimStart);
      const rawVolume = Number(clip.volume);
      const subtitleText = typeof clip.subtitleText === 'string' ? clip.subtitleText : getDefaultSubtitleText(shot);
      const subtitleEnabled = includeSubtitles && clip.subtitleEnabled !== false && !!subtitleText.trim();
      const dubbingEnabled = includeDubbing && clip.dubbingEnabled !== false;
      const audioPaths = dubbingEnabled ? resolveAudioPaths(clip, shot, rootPhysicalPath, mediaWebPath, websiteUrl) : [];
      const requestedAudioRecords = [
        ...normalizeMediaRecords(clip.dubbingAudios),
        ...normalizeMediaRecords(clip.audioUrl),
        ...normalizeMediaRecords(shot.audioUrl),
      ];
      if (dubbingEnabled && requestedAudioRecords.length > 0 && audioPaths.length === 0) {
        throw new Error(`镜头 #${shot.shotNumber} 的配音音频不是本地可读取文件，请先重新保存或刷新配音记录`);
      }
      return {
        shot,
        inputPath: shotPathMap.get(shot.id) || '',
        trimStart,
        duration,
        volume: Number.isFinite(rawVolume) ? Math.max(0, Math.min(3, rawVolume)) : 1,
        muted: !!clip.muted,
        subtitleEnabled,
        subtitleText,
        subtitleStyle: { ...globalSubtitleStyle, ...(clip.subtitleStyle || {}) },
        dubbingEnabled,
        audioPaths,
        audioVolume: clampNumber(clip.audioVolume, 0, 3, 1),
      };
    };

    if (hasEditedTimeline) {
      const shotMap = new Map(videoShots.map(shot => [shot.id, shot]));
      editedClips = clipInputs
        .filter(clip => clip.enabled !== false)
        .map(clip => {
          const shotId = String(clip.shotId || clip.id || '');
          const shot = shotMap.get(shotId);
          if (!shot) return null;
          return buildPreparedClip(shot, clip);
        })
        .filter(Boolean) as PreparedClip[];
    } else if (includeSubtitles || includeDubbing) {
      editedClips = videoShots.map(shot => buildPreparedClip(shot));
    }
    if (editedClips.length > 0) await mergeEditedClips(editedClips, outputPath);
    else await mergeVideos(inputPaths, outputPath);
    const stat = fs.statSync(outputPath);
    const videoUrl = `${webPrefix}/${filename}`.replace(/\\/g, '/');
    const metadata = {
      scope,
      episodeId: scope === 'episode' ? episodeId : null,
      shotIds: videoShots.map(shot => shot.id),
      shotNumbers: videoShots.map(shot => shot.shotNumber),
      clips: editedClips.length > 0 ? editedClips.map(clip => ({
        shotId: clip.shot.id,
        shotNumber: clip.shot.shotNumber,
        trimStart: clip.trimStart,
        duration: clip.duration,
        volume: clip.volume,
        muted: clip.muted,
        subtitleEnabled: clip.subtitleEnabled,
        subtitleText: clip.subtitleText,
        dubbingEnabled: clip.dubbingEnabled,
        dubbingAudioCount: clip.audioPaths.length,
        audioVolume: clip.audioVolume,
      })) : null,
      includeSubtitles,
      includeDubbing,
      createdBy: payload.userId,
    };
    const asset = await dramaWorkflowManager.createAsset({
      dramaId,
      userId: drama.userId,
      type: 'merged-video',
      name: outputName,
      url: videoUrl,
      localPath: outputPath,
      mimeType: 'video/mp4',
      fileSize: stat.size,
      duration: editedClips.length > 0
        ? Math.round(editedClips.reduce((sum, clip) => sum + clip.duration, 0))
        : videoShots.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0),
      metadata: JSON.stringify(metadata),
      relatedShotId: null,
      relatedEpisodeId: scope === 'episode' ? episodeId : null,
    });

    return NextResponse.json({
      success: true,
      data: {
        asset,
        videoUrl,
        fileSize: stat.size,
        mergedCount: videoShots.length,
      },
    });
  } catch (error: any) {
    console.error('[merge-video]', error);
    return NextResponse.json({ error: error.message || '合拼视频失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id: dramaId } = await params;
    const drama = await shortDramaManager.getById(dramaId);
    if (!drama || (drama.userId !== payload.userId && payload.role !== 'admin')) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const recordId = searchParams.get('recordId');
    if (!recordId) {
      return NextResponse.json({ error: '缺少记录ID参数' }, { status: 400 });
    }

    // 获取记录信息以删除本地文件
    const assets = await dramaWorkflowManager.getAssetsByDramaId(dramaId, 'merged-video');
    const record = assets.find(a => a.id === recordId);
    
    if (!record) {
      return NextResponse.json({ error: '记录不存在' }, { status: 404 });
    }

    // 尝试删除本地文件
    if (record.localPath) {
      try {
        if (fs.existsSync(record.localPath)) {
          fs.unlinkSync(record.localPath);
        }
      } catch (e) {
        console.warn('[merge-video] 删除本地文件失败:', e);
      }
    }

    // 删除数据库记录
    await dramaWorkflowManager.deleteAsset(recordId);

    return NextResponse.json({ success: true, message: '删除成功' });
  } catch (error: any) {
    console.error('[merge-video DELETE]', error);
    return NextResponse.json({ error: error.message || '删除记录失败' }, { status: 500 });
  }
}
