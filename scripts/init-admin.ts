import "dotenv/config";
import { userManager, memberLevelManager } from "../src/storage/database";
import { hashPassword } from "../src/lib/auth";

async function initAdmin() {
	try {
		const adminEmail = "admin@example.com";
		const adminPassword = "Admin@123456";
		const adminUsername = "admin";

		const existing = await userManager.getUserByEmail(adminEmail);
		if (existing) {
			console.log("管理员用户已存在:", existing.email, "角色:", existing.role);
			return;
		}

		const passwordHash = await hashPassword(adminPassword);
		
		const admin = await userManager.createUser({
			username: adminUsername,
			email: adminEmail,
			passwordHash,
			nickname: "系统管理员",
		});

		const freeLevel = await memberLevelManager.getByCode("free");
		if (freeLevel) {
			await userManager.updateMemberStatus(
				admin.id,
				freeLevel.id,
				new Date("2099-12-31"),
				"active"
			);
		}

		await userManager.updateUser(admin.id, { role: "admin" });

		console.log("管理员用户创建成功!");
		console.log("邮箱:", adminEmail);
		console.log("密码:", adminPassword);
	} catch (error) {
		console.error("初始化管理员失败:", error);
	}
}

initAdmin();
