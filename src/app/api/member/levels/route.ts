import { NextResponse } from "next/server";
import { memberLevelManager } from "@/storage/database";

export async function GET() {
	try {
		console.log("获取前台会员等级列表...");
		const levels = await memberLevelManager.getAllEnabled();

		return NextResponse.json({
			success: true,
			data: levels
				.sort((a, b) => a.sortOrder - b.sortOrder)
				.map((level) => {
					console.log("处理会员等级:", level.code, level.features);
					
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
						isActive: level.isActive,
					};
					
					console.log("处理结果:", result.code, result.features);
					return result;
				}),
		});
	} catch (error) {
		console.error("Get member levels error:", error);
		return NextResponse.json(
			{ error: "获取会员等级失败" },
			{ status: 500 }
		);
	}
}