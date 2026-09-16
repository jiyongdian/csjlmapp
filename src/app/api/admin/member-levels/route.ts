import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { memberLevelManager } from '@/storage/database';

// 处理会员等级数据格式统一处理函数
function processLevel(level: any) {
	console.log('member-levels processLevel 输入:', level);
	
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
	console.log('member-levels processLevel featuresData:', featuresData);

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
	console.log('member-levels processLevel 输出:', result);
	return result;
}

export async function GET() {
	try {
		const levels = await memberLevelManager.getAll();
		return NextResponse.json({
			success: true,
			data: levels
				.sort((a, b) => a.sortOrder - b.sortOrder)
				.map(processLevel)
		});
	} catch (error) {
		console.error('获取会员等级列表失败:', error);
		return NextResponse.json({ error: '获取会员等级列表失败' }, { status: 500 });
	}
}

export async function POST(request: NextRequest) {
	try {
		const authHeader = request.headers.get('authorization');
		const payload = getUserFromToken(authHeader);
		if (!payload || payload.role !== 'admin') {
			return NextResponse.json({ error: '未授权' }, { status: 401 });
		}

		const body = await request.json();
		console.log('创建会员等级请求:', body);
		
		const { code, name, description, price, duration, features, sortOrder, chapterLimit, storageLimit } = body;

		if (!code || !name) {
			return NextResponse.json({ error: '等级代码和名称不能为空' }, { status: 400 });
		}

		const featuresArray = Array.isArray(features)
			? features
			: [];
		const featuresObj: Record<string, unknown> = {
			storageLimit: typeof storageLimit === 'number' ? storageLimit : 10,
			features: featuresArray,
		};

		const createData: any = {
			code,
			name,
			description: description || '',
			price: Number(price) || 0,
			duration: Number(duration) || 30,
			sortOrder: Number(sortOrder) || 0,
			isActive: body.isActive === false || body.isActive === 0 ? 0 : 1,
			chapterLimit: typeof chapterLimit === 'number' ? chapterLimit : 10,
			features: JSON.stringify(featuresObj),
		};

		console.log('创建数据:', createData);

		const newLevel = await memberLevelManager.create(createData);
		
		console.log('创建后的等级:', newLevel);

		return NextResponse.json({ success: true, data: processLevel(newLevel) });
	} catch (error) {
		console.error('创建会员等级失败:', error);
		const rawMessage = error instanceof Error ? error.message : String(error);
		const isDuplicate = /UNIQUE|unique constraint|already exists/i.test(rawMessage);
		return NextResponse.json(
			{
				error: isDuplicate ? '等级代码已存在，请更换后重试' : '创建会员等级失败',
				details: rawMessage,
			},
			{ status: isDuplicate ? 400 : 500 }
		);
	}
}
