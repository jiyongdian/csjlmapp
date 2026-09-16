import "dotenv/config";
import { getDb } from "coze-coding-dev-sdk";
import { users } from "../src/storage/database/shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../src/lib/auth";

async function updateAdmin() {
	try {
		const newEmail = "jiyongdian@gmail.com";
		const newPassword = "8683686";
		
		const db = await getDb();
		
		// 查找管理员
		const adminResult = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
		if (adminResult.length === 0) {
			console.log("未找到管理员账号");
			return;
		}

		const admin = adminResult[0];
		const passwordHash = await hashPassword(newPassword);
		
		// 直接更新数据库
		await db
			.update(users)
			.set({
				email: newEmail,
				passwordHash,
				updatedAt: new Date(),
			})
			.where(eq(users.id, admin.id));

		console.log("管理员账号更新成功!");
		console.log("新邮箱:", newEmail);
		console.log("新密码:", newPassword);
	} catch (error) {
		console.error("更新管理员失败:", error);
	}
}

updateAdmin();
