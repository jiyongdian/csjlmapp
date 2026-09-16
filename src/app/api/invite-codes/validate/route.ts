import { NextRequest, NextResponse } from "next/server";
import { inviteCodeManager, memberLevelManager, userManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

/**
 * POST /api/invite-codes/validate - 验证邀请码并自动升级会员
 * 需要登录，验证通过后：
 * 1. 消耗邀请码（一次性使用）
 * 2. 自动将用户升级为邀请码对应的会员等级
 * 3. 会员时长根据等级的 duration 字段计算
 */
export async function POST(request: NextRequest) {
	try {
		// 1. 验证用户登录
		const authHeader = request.headers.get("Authorization");
		const payload = getUserFromToken(authHeader);
		if (!payload) {
			return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
		}
		const userId = payload.userId;
		if (!userId) {
			return NextResponse.json({ success: false, error: "用户信息异常" }, { status: 401 });
		}

		// 2. 解析请求
		const body = await request.json();
		const { code } = body;

		if (!code || typeof code !== "string") {
			return NextResponse.json({ success: false, error: "请提供邀请码" }, { status: 400 });
		}

		// 3. 验证邀请码有效性
		const result = await inviteCodeManager.validateCode(code.trim());

		if (!result.valid) {
			return NextResponse.json({ success: false, error: result.message });
		}

		// 4. 获取邀请码对应的会员等级信息
		const memberLevelId = result.inviteCode?.memberLevelId;
		if (!memberLevelId) {
			return NextResponse.json({ success: false, error: "邀请码未关联会员等级" }, { status: 500 });
		}

		const levelInfo = await memberLevelManager.getById(memberLevelId);
		if (!levelInfo) {
			return NextResponse.json({ success: false, error: "会员等级不存在" }, { status: 500 });
		}

		console.log("邀请码验证 - 会员等级信息:", {
			id: levelInfo.id,
			code: levelInfo.code,
			name: levelInfo.name
		});

		// 5. 根据 code 直接确定正确的 duration，100% 不使用数据库中的值
		let duration = 30;
		if (levelInfo.code === 'free') {
			duration = 0;
		} else if (levelInfo.code === 'vip') {
			duration = 30;
		} else if (levelInfo.code === 'svip') {
			duration = 365;
		}

		console.log(`会员等级=${levelInfo.code}, 使用 duration=${duration}天`);

		// 6. 计算正确的到期时间 - 不叠加，每次从今天开始计算
		const now = new Date();
		
		// 直接从今天开始计算，不叠加现有会员时长
		const expireAt = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000);
		console.log(`计算到期时间（不叠加）: ${expireAt.toISOString()}`);

		// 7. 升级用户会员等级，保存正确的日期
		const updatedUser = await userManager.updateMemberInfo(
			userId,
			memberLevelId,
			expireAt,
			"active"
		);

		if (!updatedUser) {
			return NextResponse.json({ success: false, error: "会员升级失败" }, { status: 500 });
		}

		// 8. 消耗邀请码（一次性使用）
		if (result.inviteCode?.id) {
			await inviteCodeManager.useCode(result.inviteCode.id);
		}

		// 9. 返回升级结果
		return NextResponse.json({
			success: true,
			data: {
				memberLevelId,
				levelType: result.inviteCode?.levelType || null,
				levelCode: levelInfo.code,
				levelName: levelInfo.name,
				expireAt: expireAt.toISOString(),
				message: `恭喜！已成功升级为${levelInfo.name}，有效期至${expireAt.toLocaleDateString("zh-CN")}`,
			},
		});
	} catch (error: any) {
		console.error("邀请码验证升级失败:", error);
		return NextResponse.json({ success: false, error: error.message || "验证失败" }, { status: 500 });
	}
}
