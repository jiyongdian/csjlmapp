import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { aiConfigManager } from '@/storage/database/aiConfigManager';
import { IMAGE_PROVIDERS, VIDEO_PROVIDERS, TTS_PROVIDERS } from '@/storage/database/shared/schema';

const MEDIA_TYPES = ['image', 'video', 'tts'] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

function isMediaType(v: unknown): v is MediaType {
  return typeof v === 'string' && (MEDIA_TYPES as readonly string[]).indexOf(v) >= 0;
}

/** 自己添加的媒体配置（含 apiKey，仅返回给本人） */
function own(c: any) {
  return {
    id: c.id, name: c.name, provider: c.provider, model: c.model, apiUrl: c.apiUrl,
    apiKey: c.apiKey, modelType: c.modelType, isDefault: c.isDefault, isActive: c.isActive,
    extraConfig: c.extraConfig ?? null, createdAt: c.createdAt,
  };
}

/** 系统公用媒体配置（不下发 apiKey） */
function sys(c: any) {
  return {
    id: c.id, name: c.name, provider: c.provider, model: c.model, apiUrl: c.apiUrl,
    modelType: c.modelType, isDefault: c.isDefault, hasKey: !!c.apiKey,
  };
}

/**
 * GET /api/media-configs/mine?type=image|video|tts
 * 返回当前用户自己的图片 / 视频 / 配音配置，以及系统公用配置（参考）
 */
export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('Authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const userId = payload.userId;

    const typeParam = request.nextUrl.searchParams.get('type') || '';
    const types: MediaType[] = isMediaType(typeParam) ? [typeParam] : [...MEDIA_TYPES];

    let mine: any[] = [];
    for (const t of types) {
      const list = await aiConfigManager.getUserConfigsByModelType(userId, t);
      mine = mine.concat(list.map(own));
    }

    const system = (await aiConfigManager.getAllMediaConfigs()).filter((c: any) => c.isActive === 1).map(sys);
    return NextResponse.json({
      success: true,
      data: {
        mine,
        system,
        providers: { image: IMAGE_PROVIDERS, video: VIDEO_PROVIDERS, tts: TTS_PROVIDERS },
      },
    });
  } catch (e: any) {
    console.error('[media-configs/mine] 获取失败:', e);
    return NextResponse.json({ error: e?.message || '获取配置失败' }, { status: 500 });
  }
}

/**
 * POST /api/media-configs/mine
 * 新增一条用户级媒体配置
 */
export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('Authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const body = await request.json();
    const { name, provider, model, apiKey, apiUrl, modelType, isDefault, notes, endpointPath } = body;

    if (!name || !provider || !model || !apiKey) {
      return NextResponse.json({ error: 'name、provider、model、apiKey 为必填项' }, { status: 400 });
    }
    if (!isMediaType(modelType)) {
      return NextResponse.json({ error: 'modelType 必须为 image、video 或 tts' }, { status: 400 });
    }

    const config = await aiConfigManager.createConfig({
      userId: payload.userId,
      name,
      provider,
      model,
      apiKey,
      apiUrl: apiUrl || '',
      modelType,
      scope: 'user',
      isDefault: isDefault ? 1 : 0,
      isActive: 1,
      temperature: 85,
      extraConfig: (notes || endpointPath) ? JSON.stringify({ notes, endpointPath }) : null,
    } as any);

    if (config.isDefault) {
      await aiConfigManager.setUserMediaDefaultConfigById(config.id, payload.userId);
    }
    return NextResponse.json({ success: true, data: own(config) });
  } catch (e: any) {
    console.error('[media-configs/mine] 创建失败:', e);
    return NextResponse.json({ error: e?.message || '创建失败' }, { status: 500 });
  }
}
