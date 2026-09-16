import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { memberLevelManager } from '@/storage/database';

// 处理会员等级数据格式统一处理函数
function processLevel(level: any) {
	console.log('processLevel 输入:', level);
	
	// 先解析 features 字段
	let featuresData: any = null;
	if (level.features) {
		if (typeof level.features === 'string') {
			try {
				featuresData = JSON.parse(level.features);
			} catch (e) {
				featuresData = level.features;
			}
		} else {
			featuresData = level.features;
		}
	}
	console.log('processLevel featuresData:', featuresData);

	let rawFeatures: string[] = [];
	let rawStorageLimit = 10;
	
	if (featuresData) {
		if (Array.isArray(featuresData)) {
			rawFeatures = featuresData;
		} else if (typeof featuresData === 'object') {
			if (Array.isArray(featuresData.features)) {
				rawFeatures = featuresData.features;
			}
			if (typeof featuresData.storageLimit === 'number') {
				rawStorageLimit = featuresData.storageLimit;
			}
		}
	}

	const result = {
		id: level.id,
		code: level.code,
		name: level.name,
		description: level.description,
		price: level.price,
		duration: level.duration,
		features: rawFeatures,
		chapterLimit: level.chapterLimit || 10,
		storageLimit: rawStorageLimit,
		sortOrder: level.sortOrder,
		isActive: level.isActive === 1 || level.isActive === true,
	};
	console.log('processLevel 输出:', result);
	return result;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    console.log('更新会员等级请求:', { id, body });

    const level = await memberLevelManager.getById(id);
    if (!level) {
      return NextResponse.json({ error: '会员等级不存在' }, { status: 404 });
    }

    console.log('现有会员等级:', level);

    const updateData: Record<string, unknown> = {};

    if (body.name !== undefined && body.name !== null) updateData.name = body.name;
    if (body.description !== undefined && body.description !== null) updateData.description = body.description;
    if (body.price !== undefined && body.price !== null) updateData.price = Number(body.price);
    if (body.duration !== undefined && body.duration !== null) updateData.duration = Number(body.duration);
    
    // 处理 features 字段
    let existingStorageLimit = 10;
    let existingFeatureList: string[] = [];
    
    // 解析现有的 features
    if (level.features) {
      try {
        const parsed = typeof level.features === 'string' 
          ? JSON.parse(level.features)
          : level.features;
          
        console.log('解析现有 features:', parsed);
          
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const parsedObj = parsed as Record<string, unknown>;
          if (typeof parsedObj.storageLimit === 'number') {
            existingStorageLimit = parsedObj.storageLimit;
          }
          if (Array.isArray(parsedObj.features)) {
            existingFeatureList = parsedObj.features;
          }
        } else if (Array.isArray(parsed)) {
          existingFeatureList = parsed;
        }
      } catch (e) {
        console.log('解析现有 features 失败:', e);
      }
    }
    
    // 构建新的 features 对象
    const newStorageLimit = body.storageLimit !== undefined && body.storageLimit !== null 
      ? Number(body.storageLimit) 
      : existingStorageLimit;
    const newFeatures = body.features !== undefined && body.features !== null && Array.isArray(body.features) 
      ? body.features 
      : existingFeatureList;
      
    const newFeaturesObj: Record<string, unknown> = {
      storageLimit: newStorageLimit,
      features: newFeatures
    };
    updateData.features = JSON.stringify(newFeaturesObj);
    
    console.log('新的 features 对象:', newFeaturesObj);
    
    // 更新其他字段
    if (body.sortOrder !== undefined && body.sortOrder !== null) updateData.sortOrder = Number(body.sortOrder);
    if (body.isActive !== undefined && body.isActive !== null) {
      updateData.isActive = body.isActive ? 1 : 0;
    }
    if (body.chapterLimit !== undefined && body.chapterLimit !== null) updateData.chapterLimit = Number(body.chapterLimit);

    console.log('最终更新数据:', updateData);

    const updated = await memberLevelManager.update(id, updateData as any);
    
    console.log('更新后的等级:', updated);

    return NextResponse.json({
      success: true,
      message: '会员等级更新成功',
      data: processLevel(updated),
    });
  } catch (error) {
    console.error('Update member level error:', error);
    return NextResponse.json({ 
      error: '更新会员等级失败', 
      details: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { id } = await params;
    
    // 检查是否是免费用户等级，不允许删除
    const level = await memberLevelManager.getById(id);
    if (!level) {
      return NextResponse.json({ error: '会员等级不存在' }, { status: 404 });
    }
    if (level.code === 'free') {
      return NextResponse.json({ error: '免费会员等级不能删除' }, { status: 400 });
    }

    await memberLevelManager.delete(id);

    return NextResponse.json({
      success: true,
      message: '会员等级删除成功',
    });
  } catch (error) {
    console.error('Delete member level error:', error);
    return NextResponse.json({ error: '删除会员等级失败' }, { status: 500 });
  }
}