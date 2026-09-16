import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { userManager, memberLevelManager, inviteCodeManager } from "@/storage/database";
import {
	generateTokenPair,
	hashPassword,
	JWTPayload,
} from "@/lib/auth";

const registerSchema = z.object({
	username: z.string().min(3).max(50),
	email: z.string().email(),
	password: z.string().min(6).max(100),
	nickname: z.string().max(100).optional(),
	inviteCode: z.string().optional(),
});

export async function POST(request: NextRequest) {
	try {
		console.log("=== 注册请求开始 ===");
		const body = await request.json();
		console.log("请求数据:", body);
		
		const validated = registerSchema.parse(body);
		console.log("验证通过:", validated);

		// 检查用户名是否存在
		console.log("检查用户名:", validated.username);
		const existingUsername = await userManager.getUserByUsername(validated.username);
		if (existingUsername) {
			console.log("用户名已存在");
			return NextResponse.json(
				{ error: "用户名已被使用" },
				{ status: 400 }
			);
		}

		// 检查邮箱是否存在
		console.log("检查邮箱:", validated.email);
		const existingEmail = await userManager.getUserByEmail(validated.email);
		if (existingEmail) {
			console.log("邮箱已存在");
			return NextResponse.json(
				{ error: "邮箱已被注册" },
				{ status: 400 }
			);
		}

		// 初始化会员等级信息
		let selectedMemberLevel = null;
		let memberExpireAt = new Date("2099-12-31");
		let memberStatus = "active";

		// 如果有邀请码，先验证邀请码
		if (validated.inviteCode) {
			console.log("验证邀请码:", validated.inviteCode);
			const validationResult = await inviteCodeManager.validateCode(validated.inviteCode);
			if (validationResult.success && validationResult.inviteCode) {
				const invite = validationResult.inviteCode;
				
				// 根据邀请码获取对应会员等级
				if (invite.memberLevelId) {
					selectedMemberLevel = await memberLevelManager.getById(invite.memberLevelId);
				} else if (invite.levelType) {
					selectedMemberLevel = await memberLevelManager.getByCode(invite.levelType);
				}

				// 如果有设置过期时间
				if (invite.expiresAt) {
					memberExpireAt = new Date(invite.expiresAt);
				}

				// 使用邀请码（增加使用次数）
				await inviteCodeManager.useCode(invite.id);
			} else if (!validationResult.success) {
				console.warn(`Invite code validation failed: ${validationResult.message}`);
			}
		}

		// 如果没有有效的邀请码或未找到对应会员等级，使用免费会员
		if (!selectedMemberLevel) {
			console.log("获取免费会员等级");
			selectedMemberLevel = await memberLevelManager.getByCode("free");
			console.log("免费会员等级:", selectedMemberLevel);
		}

		// 哈希密码
		console.log("哈希密码...");
		const passwordHash = await hashPassword(validated.password);

		// 创建用户
		console.log("创建用户...");
		const user = await userManager.createUser({
			username: validated.username,
			email: validated.email,
			passwordHash,
			nickname: validated.nickname || null,
		} as any);
		console.log("用户创建成功:", user.id);

		// 设置会员等级
		if (selectedMemberLevel) {
			console.log("设置会员等级:", selectedMemberLevel.id);
			await userManager.updateMemberStatus(
				user.id,
				selectedMemberLevel.id,
				memberExpireAt,
				memberStatus
			);
			console.log("会员等级设置成功");
		}

		// 生成Token
		console.log("生成Token...");
		const payload: JWTPayload = {
			userId: user.id,
			email: user.email,
			username: user.username,
			role: user.role,
		};
		const tokens = generateTokenPair(payload);
		console.log("Token生成成功");

		console.log("=== 注册完成 ===");
		return NextResponse.json({
			success: true,
			message: validated.inviteCode ? "注册成功，邀请码已激活" : "注册成功",
			data: {
				user: {
					id: user.id,
					username: user.username,
					email: user.email,
					nickname: user.nickname,
					memberStatus,
					memberLevel: selectedMemberLevel?.name || "免费用户",
				},
				...tokens,
			},
		});
	} catch (error) {
		console.error("Register error:", error);
		if (error instanceof z.ZodError) {
			return NextResponse.json(
				{ error: "参数错误", details: error.issues },
				{ status: 400 }
			);
		}
		return NextResponse.json(
			{ error: "注册失败", details: error instanceof Error ? error.message : String(error) },
			{ status: 500 }
		);
	}
}