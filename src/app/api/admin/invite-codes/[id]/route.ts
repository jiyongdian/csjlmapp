import { NextRequest, NextResponse } from "next/server";
import { inviteCodeManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

/**
 * PUT /api/admin/invite-codes/[id] - 更新邀请码
 */
export async function PUT(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const authHeader = request.headers.get('authorization');
		const payload = getUserFromToken(authHeader);
		if (!payload) {
			return NextResponse.json({ success: false, error: "未授权" }, { status: 401 });
		}

		if (payload.role !== "admin") {
			return NextResponse.json({ success: false, error: "无权限访问" }, { status: 403 });
		}

		const { id } = await params;
		const body = await request.json();

		// 启用/禁用
		if (body.isActive !== undefined) {
			const result = await inviteCodeManager.setActive(id, body.isActive);
			if (!result) {
				return NextResponse.json({ success: false, error: "邀请码不存在" }, { status: 404 });
			}
			return NextResponse.json({ success: true, data: result });
		}

		// 通用更新
		const result = await inviteCodeManager.update(id, body);
		if (!result) {
			return NextResponse.json({ success: false, error: "邀请码不存在" }, { status: 404 });
		}

		return NextResponse.json({ success: true, data: result });
	} catch (error: any) {
		return NextResponse.json({ success: false, error: error.message || "更新邀请码失败" }, { status: 500 });
	}
}

/**
 * DELETE /api/admin/invite-codes/[id] - 删除邀请码
 */
export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const authHeader = request.headers.get('authorization');
		const payload = getUserFromToken(authHeader);
		if (!payload) {
			return NextResponse.json({ success: false, error: "未授权" }, { status: 401 });
		}

		if (payload.role !== "admin") {
			return NextResponse.json({ success: false, error: "无权限访问" }, { status: 403 });
		}

		const { id } = await params;
		const deleted = await inviteCodeManager.delete(id);
		if (!deleted) {
			return NextResponse.json({ success: false, error: "邀请码不存在" }, { status: 404 });
		}

		return NextResponse.json({ success: true, message: "删除成功" });
	} catch (error: any) {
		return NextResponse.json({ success: false, error: error.message || "删除邀请码失败" }, { status: 500 });
	}
}
