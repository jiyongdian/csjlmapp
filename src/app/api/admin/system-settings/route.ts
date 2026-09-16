import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "@/lib/auth";
import {
  getSystemSettings,
  saveSystemSettings,
  SystemSettingsValidationError,
} from "@/lib/system-settings";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    const payload = getUserFromToken(authHeader || "");
    if (!payload || payload.role !== "admin") {
      return NextResponse.json({ success: false, error: "无权限" }, { status: 403 });
    }

    const settings = await getSystemSettings();
    return NextResponse.json({
      success: true,
      data: settings,
    });
  } catch (error: unknown) {
    console.error("获取系统设置异常:", error);
    const message = error instanceof Error ? error.message : "获取系统设置失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    const payload = getUserFromToken(authHeader || "");
    if (!payload || payload.role !== "admin") {
      return NextResponse.json({ success: false, error: "无权限" }, { status: 403 });
    }

    const body = await request.json();
    const updated = await saveSystemSettings(body);

    // 前端可在 body 里带上 __section，用于记录该分区的最后保存时间
    const section = body && typeof body.__section === "string" ? body.__section : "";
    const withSavedAt = section
      ? await saveSystemSettings({
          sectionSavedAt: { ...updated.sectionSavedAt, [section]: new Date().toISOString() },
        })
      : updated;

    return NextResponse.json({
      success: true,
      data: withSavedAt,
    });
  } catch (error: unknown) {
    console.error("更新系统设置异常:", error);
    const status = error instanceof SystemSettingsValidationError ? 400 : 500;
    const message = error instanceof Error ? error.message : "更新系统设置失败";
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
