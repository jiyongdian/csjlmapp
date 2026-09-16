import { NextRequest, NextResponse } from "next/server";
import { userManager, memberLevelManager, novelManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

/**
 * 获取当前用户的会员状态
 * 检查会员是否过期，如果过期则自动降级为免费会员
 */
export async function GET(request: NextRequest) {
	try {
			const authHeader = request.headers.get("authorization");
			const payload = getUserFromToken(authHeader);

			if (!payload) {
				return NextResponse.json(
					{ error: "请先登录" },
					{ status: 401 }
				);
			}

			// 获取会员信息
			const membership = await userManager.checkMembership(payload.userId);
			const user = await userManager.getUserById(payload.userId);

			let levelInfo = null;
			let storageLimit = 10;
			let chapterLimit = 11;
			let features: Record<string, any> = {};
			let isMember = membership.isValid;
			
			// 检查会员是否过期，如果过期则自动降级为免费会员
			if (!membership.isValid && user?.memberLevelId) {
				console.log("会员已过期，自动降级为免费会员:", user.id);
				// 获取免费会员等级
				const freeLevel = await memberLevelManager.getByCode('free');
				if (freeLevel) {
					// 降级为免费会员 - 免费会员不需要设置过期日期（设为 null）
					await userManager.updateMemberInfo(
						user.id,
						freeLevel.id,
						null, // 免费会员没有过期日期
						'active'
					);
					// 重新获取会员状态
					isMember = false;
				}
			}

			if (isMember && membership.levelId) {
				const level = await memberLevelManager.getById(membership.levelId);
				if (level) {
					// 验证并修复日期
					let finalExpiresAt: string | null = membership.expireAt ? new Date(membership.expireAt).toISOString() : null;
					
					try {
						if (membership.expireAt) {
							const expireDate = new Date(membership.expireAt);
							const now = new Date();
							const tenYearsLater = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000);
							
							// 如果日期异常，重新计算正确的日期并更新数据库
							if (expireDate > tenYearsLater || expireDate < now) {
								console.log(`用户 ${payload.userId} 的会员日期异常，正在修复...`);
								
								let duration = 30;
								if (level.code === 'vip') {
									duration = 30;
								} else if (level.code === 'svip') {
									duration = 365;
								}
								
								const newExpireDate = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000);
								finalExpiresAt = newExpireDate.toISOString();
								
								// 更新数据库中的日期
								await userManager.updateMemberInfo(
									payload.userId,
									membership.levelId,
									newExpireDate,
									'active'
								);
								
								console.log(`已修复用户 ${payload.userId} 的会员日期: ${finalExpiresAt}`);
							}
						}
					} catch (e) {
						console.log(`修复用户 ${payload.userId} 会员日期时出错，重新计算...`);
						let duration = 30;
						if (level.code === 'vip') {
							duration = 30;
						} else if (level.code === 'svip') {
							duration = 365;
						}
						const now = new Date();
						const newExpireDate = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000);
						finalExpiresAt = newExpireDate.toISOString();
					}
					
					levelInfo = {
						id: level.id,
						code: level.code,
						name: level.name,
						price: level.price,
						expiresAt: finalExpiresAt,
					};

					if (level.features) {
						features = typeof level.features === 'string'
							? JSON.parse(level.features)
							: level.features;
						storageLimit = features.storageLimit || -1;
					}
					
					// 获取章节上限：用户单独设置 > 会员等级设置 > 默认11
					chapterLimit = user?.chapterLimit ?? level.chapterLimit ?? 11;
				}
			} else {
				// 如果是免费会员，获取免费会员的信息
				const freeLevel = await memberLevelManager.getByCode('free');
				if (freeLevel) {
					if (freeLevel.features) {
						features = typeof freeLevel.features === 'string'
							? JSON.parse(freeLevel.features)
							: freeLevel.features;
						storageLimit = features.storageLimit || 10;
					}
					chapterLimit = user?.chapterLimit ?? freeLevel.chapterLimit ?? 11;
				}
			}

			// 获取当前使用量
			const currentCount = await novelManager.getUserNovelCount(payload.userId);

			return NextResponse.json({
				success: true,
				data: {
					isMember,
					level: levelInfo,
					chapterLimit,
					features: {
						storageLimit,
						...features,
					},
					usage: {
						novelCount: currentCount,
						storageUsed: currentCount,
					},
					user: {
						id: user?.id,
						email: user?.email,
						username: user?.username,
						nickname: user?.nickname,
						createdAt: user?.createdAt,
					},
				},
			});
	} catch (error) {
			console.error("Get member status error:", error);
			return NextResponse.json(
				{ error: "获取会员状态失败" },
				{ status: 500 }
			);
	}
}