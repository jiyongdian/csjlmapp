import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "@/lib/auth";
import { aiConfigManager } from "@/storage/database/aiConfigManager";

/** PUT /api/admin/media-configs/[id]  — 更新系统媒体API配置 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("Authorization") || "");
    if (!payload || payload.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });
    const { id } = await params;
    const body = await request.json();
    const { name, provider, model, apiKey, apiUrl, modelType, isDefault, isActive, notes, endpointPath } = body;
    const updated = await aiConfigManager.updateSystemConfigAdmin(id, {
      ...(name !== undefined && { name }),
      ...(provider !== undefined && { provider }),
      ...(model !== undefined && { model }),
      ...(apiKey !== undefined && { apiKey }),
      ...(apiUrl !== undefined && { apiUrl }),
      ...(modelType !== undefined && { modelType }),
      ...(isDefault !== undefined && { isDefault: isDefault ? 1 : 0 }),
      ...(isActive !== undefined && { isActive: isActive ? 1 : 0 }),
      ...((notes !== undefined || endpointPath !== undefined) && { extraConfig: JSON.stringify({ notes, endpointPath }) }),
    });
    if (!updated) return NextResponse.json({ error: "配置不存在或更新失败" }, { status: 404 });
    if (body.isDefault && updated.modelType) {
      await aiConfigManager.setMediaDefaultConfig(id, updated.modelType);
    }
    return NextResponse.json({ success: true, data: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** DELETE /api/admin/media-configs/[id]  — 删除系统媒体API配置 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("Authorization") || "");
    if (!payload || payload.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });
    const { id } = await params;
    const deleted = await aiConfigManager.deleteSystemConfig(id);
    return NextResponse.json({ success: deleted, message: deleted ? "删除成功" : "删除失败" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
