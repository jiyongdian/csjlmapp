import { NextRequest, NextResponse } from "next/server";
import { inviteCodeManager, memberLevelManager } from "@/storage/database";
import { insertInviteCodeSchema } from "@/storage/database/shared/schema";
import { getUserFromToken } from "@/lib/auth";

/**
 * GET /api/admin/invite-codes - 获取邀请码列表
 * 支持 ?levelType=vip 或 ?levelType=svip 筛选
 */
export async function GET(request: NextRequest) {
	try {
		const authHeader = request.headers.get('authorization');
		const payload = getUserFromToken(authHeader);
		if (!payload) {
			return NextResponse.json({ success: false, error: "未授权" }, { status: 401 });
		}

		if (payload.role !== "admin") {
			return NextResponse.json({ success: false, error: "无权限访问" }, { status: 403 });
		}

		const { searchParams } = new URL(request.url);
		const page = parseInt(searchParams.get("page") || "1");
		const pageSize = parseInt(searchParams.get("pageSize") || "50");
		const levelType = searchParams.get("levelType") || undefined;

		const result = await inviteCodeManager.list({ page, pageSize, levelType });

		// 获取会员等级信息
		const levels = await memberLevelManager.getAll();
		const levelMap = new Map(levels.map(l => [l.id, l]));

		const codesWithLevel = result.codes.map(code => ({
			...code,
			memberLevel: code.memberLevelId ? levelMap.get(code.memberLevelId) || null : null,
			// 状态计算：综合判断（isActive 和 isUsedUp 在 SQLite 中是 integer 类型）
			status: code.isUsedUp === 1
				? "used_up"
				: code.isActive === 0
					? "disabled"
					: code.expiresAt && new Date(code.expiresAt) < new Date()
						? "expired"
						: "active",
			// 确保布尔值属性正确转换
			isActive: code.isActive === 1,
			isUsedUp: code.isUsedUp === 1,
		}));

		return NextResponse.json({
			success: true,
			data: { codes: codesWithLevel, total: result.total },
		});
	} catch (error: any) {
		return NextResponse.json({ success: false, error: error.message || "获取邀请码列表失败" }, { status: 500 });
	}
}

/**
 * POST /api/admin/invite-codes - 创建邀请码
 * 支持指定 levelType (vip/svip) 和 memberLevelId
 */
export async function POST(request: NextRequest) {
	try {
		const authHeader = request.headers.get('authorization');
		const payload = getUserFromToken(authHeader);
		if (!payload) {
			return NextResponse.json({ success: false, error: "未授权" }, { status: 401 });
		}

		if (payload.role !== "admin") {
			return NextResponse.json({ success: false, error: "无权限访问" }, { status: 403 });
		}

		const body = await request.json();

		// 如果指定了 levelType，自动关联对应的 memberLevelId
		let memberLevelId = body.memberLevelId || null;
		let levelType = body.levelType || null;
		if (levelType && !memberLevelId) {
			const levels = await memberLevelManager.getAll();
			const matchedLevel = levels.find(l => l.code === levelType);
			if (matchedLevel) {
				memberLevelId = matchedLevel.id;
			}
		}

		// 自动生成邀请码（如果未提供）
		const code = body.code || `INV${Date.now().toString(36)}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

		const inviteCode = await inviteCodeManager.create({
			code,
			description: body.description || null,
			memberLevelId,
			levelType,
			maxUses: body.maxUses || 1,
			expiresAt: body.expiresAt || null,
			createdBy: payload.userId || "admin",
		} as any);

		return NextResponse.json({ success: true, data: inviteCode }, { status: 201 });
	} catch (error: any) {
		console.error('创建邀请码失败:', error);
		return NextResponse.json({ success: false, error: error.message || "创建邀请码失败" }, { status: 500 });
	}
}