import { NextResponse } from "next/server";
import { getDb } from "@/storage/database/sqlite";
import { users, memberLevels } from "@/storage/database/shared/schema";
import { eq } from "drizzle-orm";
import { getUserFromToken } from "@/lib/auth";

export async function POST(request: Request) {
	try {
		const authHeader = request.headers.get('authorization');
		const payload = getUserFromToken(authHeader);
		if (!payload || payload.role !== "admin") {
			return NextResponse.json({ error: "未授权" }, { status: 401 });
		}

		console.log("开始检查和修复用户会员数据...");

		const db = await getDb();

		// 获取所有会员等级
		const allLevels = await db.select().from(memberLevels);
		console.log("当前会员等级:", allLevels);

		// 获取所有用户
		const allUsers = await db.select().from(users);
		console.log("所有用户:", allUsers.map(u => ({ id: u.id, email: u.email, memberLevelId: u.memberLevelId, memberExpireAt: u.memberExpireAt })));

		const fixes: any[] = [];

		for (const user of allUsers) {
			// 如果用户有付费会员等级，但过期日期是 2099-12-31 或者其他不合理的日期
			if (user.memberLevelId && user.memberStatus === "active") {
				const level = allLevels.find(l => l.id === user.memberLevelId);
				if (level && level.code !== "free") {
					const expireDate = user.memberExpireAt ? new Date(user.memberExpireAt) : null;
					const currentYear = new Date().getFullYear();
					
					// 检查是否是异常日期（比如 2099 年或其他不合理的年份）
					if (expireDate && (expireDate.getFullYear() > currentYear + 10 || expireDate.getFullYear() < currentYear - 1)) {
						console.log(`发现异常用户 ${user.email}，会员等级 ${level.code}，过期日期 ${user.memberExpireAt}`);
						
						// 重新计算合理的过期日期（从今天开始）
						const today = new Date();
						const newExpireDate = new Date(today);
						newExpireDate.setDate(today.getDate() + (level.duration || 30));
						
						console.log(`修复用户 ${user.email} 的过期日期为:`, newExpireDate.toISOString());
						
						const result = await db
							.update(users)
							.set({ 
								memberExpireAt: newExpireDate.toISOString(),
								updatedAt: new Date().toISOString()
							})
							.where(eq(users.id, user.id))
							.returning();
						
						fixes.push({
							userId: user.id,
							email: user.email,
							oldExpireAt: user.memberExpireAt,
							newExpireAt: newExpireDate.toISOString(),
							level: level.code
						});
					}
				}
			}
		}

		return NextResponse.json({
			success: true,
			message: `检查完成，修复了 ${fixes.length} 个用户的会员数据`,
			data: {
				fixedUsers: fixes,
				allUsers: allUsers.map(u => ({ id: u.id, email: u.email, memberLevelId: u.memberLevelId, memberExpireAt: u.memberExpireAt })),
				levels: allLevels
			},
		});
	} catch (error) {
		console.error("修复用户会员数据失败:", error);
		return NextResponse.json({
			error: "修复失败",
			details: error instanceof Error ? error.message : String(error)
		}, { status: 500 });
	}
}
