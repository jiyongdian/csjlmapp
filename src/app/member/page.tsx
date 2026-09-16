"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { memberApi, authApi, MemberLevel, MemberStatus } from "@/lib/api/client";
import { getToken } from "@/lib/get-token";
import { formatYuan } from "@/lib/price";
import AIConfigModal from "@/components/AIConfigModal";

export default function MemberPage() {
	const router = useRouter();
	const [status, setStatus] = useState<MemberStatus | null>(null);
	const [levels, setLevels] = useState<MemberLevel[]>([]);
	const [loading, setLoading] = useState(false);
	const [processingOrder, setProcessingOrder] = useState<string | null>(null);
	const [showPaymentModal, setShowPaymentModal] = useState(false);
	const [selectedLevel, setSelectedLevel] = useState<MemberLevel | null>(null);
	const [previewLevel, setPreviewLevel] = useState<MemberLevel | null>(null);
	const [paymentOrder, setPaymentOrder] = useState<any>(null);
	const [paymentStep, setPaymentStep] = useState<'select' | 'processing' | 'success'>('select');
	const [paymentMethod, setPaymentMethod] = useState<string>('wechat');
	const [showAiConfigModal, setShowAiConfigModal] = useState(false);
	const [showProfileModal, setShowProfileModal] = useState(false);
	const [profileForm, setProfileForm] = useState({
		username: "",
		nickname: "",
		email: "",
		oldPassword: "",
		newPassword: "",
		confirmPassword: "",
	});
	const [profileSaving, setProfileSaving] = useState(false);
	const [profileError, setProfileError] = useState("");
	const [profileSuccess, setProfileSuccess] = useState("");
	const [showInviteModal, setShowInviteModal] = useState(false);
	const [inviteCode, setInviteCode] = useState("");
	const [inviteCodeError, setInviteCodeError] = useState("");
	const [inviteCodeValidating, setInviteCodeValidating] = useState(false);
	const [inviteCodeValid, setInviteCodeValid] = useState(false);
	const [upgradeResult, setUpgradeResult] = useState<{ 
		levelName: string; 
		expireAt: string; 
		message: string;
		levelCode?: string;
	} | null>(null);

	// 计算会员到期日期
	const calculateExpireDate = (level: MemberLevel) => {
		if (level.code === 'free') return null;
		
		let duration = 30;
		if (level.code === 'vip') {
			duration = 30;
		} else if (level.code === 'svip') {
			duration = 365;
		} else {
			duration = level.duration || 30;
		}

		const now = new Date();
		let startDate = now;
		if (status?.level?.expiresAt && status?.isMember && new Date(status.level.expiresAt) > now) {
			startDate = new Date(status.level.expiresAt);
		}
		
		const expireDate = new Date(startDate.getTime() + duration * 24 * 60 * 60 * 1000);
		return expireDate;
	};

	const fetchData = useCallback(async () => {
			try {
				const [statusData, levelsData] = await Promise.all([
					memberApi.getStatus(),
					memberApi.getLevels(),
				]);
				setStatus(statusData);
				setLevels((levelsData || []).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
			} catch (err: any) {
				if (err.message.includes("请先登录")) {
					router.push("/auth/login");
					return;
				}
				console.error("获取数据失败:", err);
			} finally {
				setLoading(false);
			}
		}, [router]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const handleSubscribe = async (level: MemberLevel) => {
		setSelectedLevel(level);
		setInviteCode("");
		setInviteCodeError("");
		setInviteCodeValid(false);
		setShowInviteModal(true);
	};

	const handleValidateInviteCode = async () => {
		if (!inviteCode.trim()) {
			setInviteCodeError("请输入邀请码");
			return;
		}
		setInviteCodeValidating(true);
		setInviteCodeError("");
		try {
			const token = getToken();
			const response = await fetch("/api/invite-codes/validate", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(token ? { Authorization: "Bearer " + token } : {}),
				},
				body: JSON.stringify({ code: inviteCode.trim() }),
			});
			const data = await response.json();
			if (data.success) {
				// 检查邀请码是否匹配当前选择的会员等级
				const inviteLevelId = data.data?.memberLevelId;
				const inviteLevelType = data.data?.levelType;
				if (inviteLevelId && selectedLevel?.id && inviteLevelId !== selectedLevel.id) {
					const levelName = inviteLevelType === "vip" ? "VIP会员" : inviteLevelType === "svip" ? "SVIP会员" : "其他等级";
					setInviteCodeError("此邀请码适用于" + levelName + "，与当前选择的" + selectedLevel.name + "不匹配，请选择正确的会员等级");
					setInviteCodeValidating(false);
					return;
				}
				// 验证成功并已自动升级会员
				setInviteCodeValid(true);
				setUpgradeResult({
					levelName: data.data?.levelName || selectedLevel?.name || "",
					expireAt: data.data?.expireAt || "",
					message: data.data?.message || "已成功升级为" + (selectedLevel?.name || ""),
					levelCode: data.data?.levelCode || selectedLevel?.code,
				});
				// 刷新会员状态
				await fetchData();
			} else {
				setInviteCodeError(data.error || "邀请码无效");
			}
		} catch (error) {
			setInviteCodeError("验证失败，请重试");
		} finally {
			setInviteCodeValidating(false);
		}
	};

	const handleSelectPayment = async (method: string) => {
		setPaymentMethod(method);
		setPaymentStep("processing");
		setProcessingOrder(selectedLevel?.id || null);
		try {
			const order = await memberApi.createOrder(selectedLevel!.id, method);
			setPaymentOrder(order);
			// 轮询支付状态
			const maxAttempts = 60;
			let attempts = 0;
			const pollInterval = setInterval(async () => {
				attempts++;
				try {
					const status = await memberApi.queryPaymentStatus(order.orderNo);
					if (status.paymentStatus === "completed") {
						clearInterval(pollInterval);
						setPaymentStep("success");
						await fetchData();
					}
				} catch (err) {
					// 继续轮询
				}
				if (attempts >= maxAttempts) {
					clearInterval(pollInterval);
				}
			}, 1000);

			// 3秒后模拟自动支付完成（演示环境）
			setTimeout(async () => {
				try {
					await memberApi.completePayment(order.orderNo, method);
				} catch (err) {
					// 状态轮询会检测到
				}
			}, 3000);

		} catch (err: any) {
			alert(err.message || "创建订单失败");
			setPaymentStep("select");
		} finally {
			setProcessingOrder(null);
		}
	};

	const handleClosePayment = () => {
		setShowPaymentModal(false);
		setPaymentOrder(null);
		setSelectedLevel(null);
		setProcessingOrder(null);
	};

	const openProfileModal = () => {
		setProfileForm({
			username: status?.user?.username || "",
			nickname: status?.user?.nickname || "",
			email: status?.user?.email || "",
			oldPassword: "",
			newPassword: "",
			confirmPassword: "",
		});
		setProfileError("");
		setProfileSuccess("");
		setShowProfileModal(true);
	};

	const handleSaveProfile = async () => {
		const username = profileForm.username.trim();
		const nickname = profileForm.nickname.trim();
		const email = profileForm.email.trim();
		if (username.length < 3) { setProfileError("用户名至少需要 3 个字符"); return; }
		if (!email) { setProfileError("请输入邮箱"); return; }
		const changingPassword = Boolean(profileForm.oldPassword || profileForm.newPassword || profileForm.confirmPassword);
		if (changingPassword) {
			if (!profileForm.oldPassword) { setProfileError("请输入当前密码"); return; }
			if (profileForm.newPassword.length < 6) { setProfileError("新密码至少需要 6 个字符"); return; }
			if (profileForm.newPassword !== profileForm.confirmPassword) { setProfileError("两次输入的新密码不一致"); return; }
		}
		setProfileSaving(true);
		setProfileError("");
		setProfileSuccess("");
		try {
			await authApi.updateProfile({ username: username, nickname: nickname, email: email });
			if (changingPassword) {
				await authApi.changePassword({ oldPassword: profileForm.oldPassword, newPassword: profileForm.newPassword });
			}
			try {
				const stored = localStorage.getItem("auth-storage");
				if (stored) {
					const parsed = JSON.parse(stored);
					parsed.state = parsed.state || {};
					parsed.state.user = Object.assign({}, parsed.state.user || {}, { username: username, nickname: nickname, email: email });
					localStorage.setItem("auth-storage", JSON.stringify(parsed));
				}
			} catch (e) {}
			setProfileSuccess("保存成功");
			await fetchData();
			setTimeout(() => setShowProfileModal(false), 800);
		} catch (err: any) {
			setProfileError(err && err.message ? err.message : "保存失败，请重试");
		} finally {
			setProfileSaving(false);
		}
	};

	const handleLogout = () => {
		authApi.logout();
		document.cookie = "auth-token=; path=/; max-age=0";
		window.location.href = "/";
	};

	if (loading) {
		return (
			<div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-black">
				<div className="animate-spin rounded-full h-12 w-12 border-4 border-green-500 border-t-transparent relative z-10"></div>
			</div>
		);
	}


	return (
		<div className="min-h-screen relative overflow-hidden bg-black">
			{/* Header */}
			<header className="relative z-10 border-b border-green-500/10 backdrop-blur-xl" style={{ background: 'rgba(0,0,0,0.7)' }}>
				<div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
					<Link href="/novel-generator" className="flex items-center gap-2 text-gray-400 hover:text-purple-400 transition-colors text-sm">
						<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
						</svg>
						返回创作中心
					</Link>
					<div className="flex items-center gap-4">
						<Link href="/my-novels" className="text-sm text-gray-400 hover:text-purple-400 transition-colors">
							我的小说
						</Link>
						<Link href="/scripts" className="text-sm text-amber-400 hover:text-amber-300 transition-colors">
							我的剧本
						</Link>
						<Link href="/short-dramas" className="text-sm text-purple-400 hover:text-pink-400 transition-colors">
							短剧制作
						</Link>
								<span className="text-sm text-gray-400">
							{status?.user?.email}
						</span>
						<button
							onClick={() => setShowAiConfigModal(true)}
							className="text-sm text-gray-400 hover:text-purple-400 transition-colors"
						>
							API设置
						</button>
						<button
							onClick={handleLogout}
							className="text-sm text-gray-400 hover:text-red-400 transition-colors"
						>
							退出登录
						</button>
					</div>
				</div>
			</header>

			<main className="relative z-10 max-w-7xl mx-auto px-4 py-8">
				{/* 会员状态卡片 */}
				<div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl p-8 text-white mb-8">
					<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
						<div>
							<h1 className="text-3xl font-bold mb-2">
								{status?.isMember ? `您是 ${status.level?.name}` : "免费用户"}
							</h1>
							{status?.isMember ? (
								<p className="text-purple-100">
									有效期至：{(() => {
										// 现在后端已经修复了日期，直接显示即可
										// 增加一个简单的验证以防万一
										try {
											if (status.level?.expiresAt) {
												const expireDate = new Date(status.level.expiresAt);
												return expireDate.toLocaleDateString("zh-CN");
											}
										} catch (e) {
											// 如果还是解析失败，简单计算一下
											const now = new Date();
											let duration = 30;
											if (status.level?.code === 'svip') {
												duration = 365;
											}
											const expireDate = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000);
											return expireDate.toLocaleDateString("zh-CN");
										}
										return "未知";
									})()}
								</p>
							) : (
								<p className="text-purple-100">
									升级会员解锁更多功能
								</p>
							)}
						</div>
						<div className="flex-1 flex flex-col items-center gap-3 md:px-6">
							<div className="text-center">
								<div className="text-xs text-purple-200 mb-1">会员昵称</div>
								<div className="text-xl font-semibold text-white truncate max-w-[240px]">
									{status?.user?.nickname || status?.user?.username || "未设置"}
								</div>
							</div>
							<button
								onClick={openProfileModal}
								title="修改用户名、昵称、邮箱、密码"
								className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-white/20 hover:bg-white/30 border border-white/25 backdrop-blur transition-colors"
							>
								<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
								</svg>
								修改资料
							</button>
						</div>
						<div className="bg-white/20 backdrop-blur rounded-xl p-6 min-w-[200px]">
							<div className="text-sm text-purple-100 mb-1">已使用存储</div>
							<div className="text-3xl font-bold mb-1">
								{status?.usage?.novelCount || 0}
								<span className="text-lg font-normal ml-1">
									/ {status?.features?.storageLimit === -1 ? "∞" : status?.features?.storageLimit || 10}
								</span>
							</div>
							<div className="text-sm text-purple-200">部小说</div>
						</div>
					</div>
				</div>

				{/* 会员等级 */}
				<h2 className="text-2xl font-bold text-white mb-6">
					选择会员方案
				</h2>

				{/* 实时预览区域 */}
				{previewLevel && previewLevel.code !== 'free' && (
					<div className="bg-purple-500/10 border border-purple-500/25 rounded-2xl p-6 mb-8">
						<div className="flex items-center gap-3">
							<div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center">
								<svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
								</svg>
							</div>
							<div className="flex-1">
								<h3 className="text-lg font-bold text-white mb-1">
									{previewLevel.name} - 到期日期预览
								</h3>
								<p className="text-gray-300">
									{(() => {
										const expireDate = calculateExpireDate(previewLevel);
										const isRenewal = status?.level?.expiresAt && status?.isMember && new Date(status.level.expiresAt) > new Date();
										return (
											<span>
												{isRenewal ? "续费后" : "开通后"}有效期至：
												<span className="font-bold text-purple-400 ml-1">
													{expireDate?.toLocaleDateString("zh-CN")}
												</span>
												<span className="text-sm text-gray-400 ml-2">
													（{previewLevel.code === 'svip' ? '365天' : '30天'}）
												</span>
											</span>
										);
									})()}
								</p>
							</div>
							<button
								onClick={() => setPreviewLevel(null)}
								className="text-gray-400 hover:text-gray-200"
							>
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>
					</div>
				)}

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
					{levels.map((level) => {
						const isFree = level.code === 'free';
						const isCurrentPlan = isFree ? (!status?.level?.id || status?.level?.id === level.id) : status?.level?.id === level.id;
						const isProcessing = processingOrder === level.id;
						const isPreviewing = previewLevel?.id === level.id;

						return (
							<div
								key={level.id}
								onClick={() => !isFree && setPreviewLevel(isPreviewing ? null : level)}
								className={`relative backdrop-blur-xl rounded-2xl p-6 border border-white/8 transition-all cursor-pointer ${
									isCurrentPlan 
										? "ring-2 ring-purple-500" 
										: isPreviewing 
											? "ring-2 ring-indigo-400 bg-indigo-500/10" 
											: "hover:shadow-xl hover:-translate-y-1"
								}`}
							>
								{isCurrentPlan && (
									<div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-purple-500 text-white text-xs font-bold px-4 py-1 rounded-full">
										当前方案
									</div>
								)}
								{isPreviewing && !isCurrentPlan && (
									<div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-500 text-white text-xs font-bold px-4 py-1 rounded-full">
										预览中
									</div>
								)}

								<div className="text-center mb-6">
									<h3 className="text-xl font-bold text-white mb-2">
										{level.name}
									</h3>
									<div className="flex items-baseline justify-center gap-1">
										<span className={`text-4xl font-bold ${isFree ? 'text-gray-400' : 'text-purple-400'}`}>
											¥{formatYuan(level.price)}
										</span>
										<span className="text-gray-400">
											{isFree ? '/永久' : level.code === 'svip' ? '/1年' : level.code === 'vip' ? '/1个月' : `/${level.duration}天`}
										</span>
									</div>
								</div>

								<div className="space-y-3 mb-6">
									{/* 章节上限 */}
									<div className="flex items-center gap-2 text-sm text-gray-300">
										<svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
										</svg>
										<span>章节生成上限: {level.chapterLimit || 10}章</span>
									</div>
									{(level.features || []).map((feature, index) => (
										<div key={index} className="flex items-center gap-2 text-sm text-gray-300">
											<svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
											</svg>
											<span>{feature}</span>
										</div>
									))}
									{/* 预览到期日期 */}
									{isPreviewing && !isFree && (
										<div className="mt-4 pt-4 border-t border-white/10">
											<div className="text-sm text-indigo-400 font-medium">
												到期日期：{calculateExpireDate(level)?.toLocaleDateString("zh-CN")}
											</div>
										</div>
									)}
								</div>

								<button
									onClick={(e) => {
										e.stopPropagation();
										!isFree && handleSubscribe(level);
									}}
									disabled={isCurrentPlan || isProcessing || isFree}
									className={`w-full py-3 px-4 rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
										isCurrentPlan || isFree
											? "bg-white/8 text-gray-500"
											: isPreviewing
												? "bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white shadow-lg hover:shadow-xl"
												: "bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white shadow-lg hover:shadow-xl"
									}`}
								>
									{isFree ? "当前方案" : isProcessing ? "处理中..." : isCurrentPlan ? "当前方案" : isPreviewing ? "立即开通" : "点击预览"}
								</button>
							</div>
						);
					})}
				</div>

			{/* AI配置弹窗 */}
			{showAiConfigModal && (
				<AIConfigModal isOpen={showAiConfigModal} onClose={() => setShowAiConfigModal(false)} />
			)}

			{/* 邀请码弹窗 */}
				{showInviteModal && selectedLevel && (
					<div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
						<div className="backdrop-blur-xl rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-white/10" style={{ background: 'rgba(15,12,41,0.95)' }}>
							{upgradeResult ? (
								/* 升级成功 */
								<div className="p-6">
									<div className="text-center mb-6">
										<div className="w-16 h-16 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
											<svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
											</svg>
										</div>
										<h3 className="text-xl font-bold text-white">升级成功！</h3>
										<p className="text-sm text-gray-500 mt-2">
											{/* 完全重算日期 - 不使用任何可能错误的数据 */}
											{(() => {
												// 直接从 selectedLevel 判断是VIP还是SVIP，不依赖其他状态
												const isSVIP = selectedLevel.code === 'svip' || upgradeResult.levelName?.includes('SVIP');
												const isVIP = selectedLevel.code === 'vip' || upgradeResult.levelName?.includes('VIP');
												
												const today = new Date();
												let expireDate;
												
												if (isSVIP) {
													expireDate = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000);
												} else {
													expireDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
												}
												
												return `恭喜！已成功升级为${upgradeResult.levelName}，有效期至${expireDate.toLocaleDateString("zh-CN")}`;
											})()}
										</p>
									</div>
									<div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 mb-6">
										<div className="flex items-center justify-between mb-2">
											<span className="text-sm text-gray-400">会员等级</span>
											<span className="font-semibold text-green-400">{upgradeResult.levelName}</span>
										</div>
										<div className="flex items-center justify-between">
											<span className="text-sm text-gray-400">有效期至</span>
											<span className="font-semibold text-green-400">
												{/* 完全重算日期 - 不使用任何可能错误的数据 */}
												{(() => {
													const isSVIP = selectedLevel.code === 'svip' || upgradeResult.levelName?.includes('SVIP');
													const isVIP = selectedLevel.code === 'vip' || upgradeResult.levelName?.includes('VIP');
													
													const today = new Date();
													let expireDate;
													
													if (isSVIP) {
														expireDate = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000);
													} else {
														expireDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
													}
													
													return expireDate.toLocaleDateString("zh-CN");
												})()}
											</span>
										</div>
									</div>
									<button
										onClick={() => { setShowInviteModal(false); setInviteCode(""); setInviteCodeError(""); setInviteCodeValid(false); setUpgradeResult(null); }}
										className="w-full px-4 py-3 bg-gradient-to-r from-green-400 to-emerald-500 rounded-xl text-white font-medium hover:from-green-500 hover:to-emerald-600 transition-all"
									>
										确定
									</button>
								</div>
							) : (
								/* 输入邀请码 */
								<div>
									<div className="p-6">
										<div className="text-center mb-6">
											<div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center mx-auto mb-4">
												<svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
													<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
												</svg>
											</div>
											<h3 className="text-xl font-bold text-white">请输入邀请码</h3>
											<p className="text-sm text-gray-500 mt-2">
												开通 <span className="font-semibold text-purple-600">{selectedLevel.name}</span> 需要输入邀请码
											</p>
										</div>
										<div className="space-y-4">
											<div>
												<input
													type="text"
													value={inviteCode}
													onChange={(e) => { setInviteCode(e.target.value); setInviteCodeError(""); }}
													placeholder="请输入邀请码"
													className={`w-full px-4 py-3 border-2 rounded-xl text-center text-lg font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-purple-500 ${
														inviteCodeError ? "border-red-300 focus:ring-red-500" : "border-gray-200"
													}`}
													onKeyDown={(e) => e.key === "Enter" && handleValidateInviteCode()}
													autoFocus
												/>
												{inviteCodeError && (
													<p className="mt-2 text-sm text-red-500 text-center">{inviteCodeError}</p>
												)}
											</div>
										</div>
									</div>
									<div className="px-6 pb-6 flex gap-3">
										<button
											onClick={() => { setShowInviteModal(false); setInviteCode(""); setInviteCodeError(""); }}
											className="flex-1 px-4 py-3 border-2 border-white/15 rounded-xl text-gray-300 font-medium hover:bg-white/8 transition-colors"
										>
											取消
										</button>
										<button
											onClick={handleValidateInviteCode}
											disabled={inviteCodeValidating || !inviteCode.trim()}
											className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl text-white font-medium hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50"
										>
											{inviteCodeValidating ? "验证中..." : "验证并开通"}
										</button>
									</div>
								</div>
							)}
						</div>
					</div>
				)}

				{/* 修改资料弹窗 */}
			{showProfileModal && (
				<div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !profileSaving && setShowProfileModal(false)}>
					<div className="backdrop-blur-xl rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-white/10 max-h-[90vh] flex flex-col" style={{ background: "rgba(15,12,41,0.95)" }} onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center justify-between p-6 pb-4">
							<h3 className="text-xl font-bold text-white">修改资料</h3>
							<button onClick={() => !profileSaving && setShowProfileModal(false)} className="text-gray-400 hover:text-white">
								<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>
						<div className="px-6 overflow-y-auto flex-1 space-y-4">
							<div>
								<label className="block text-sm text-gray-400 mb-1.5">用户名</label>
								<input type="text" value={profileForm.username} onChange={(e) => setProfileForm((p) => Object.assign({}, p, { username: e.target.value }))} placeholder="请输入用户名（至少 3 个字符）" className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500" />
							</div>
							<div>
								<label className="block text-sm text-gray-400 mb-1.5">昵称</label>
								<input type="text" value={profileForm.nickname} onChange={(e) => setProfileForm((p) => Object.assign({}, p, { nickname: e.target.value }))} placeholder="请输入昵称" className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500" />
							</div>
							<div>
								<label className="block text-sm text-gray-400 mb-1.5">邮箱</label>
								<input type="email" value={profileForm.email} onChange={(e) => setProfileForm((p) => Object.assign({}, p, { email: e.target.value }))} placeholder="请输入邮箱" className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500" />
							</div>
							<div className="pt-4 border-t border-white/10">
								<div className="text-sm text-gray-400">修改密码（不需要修改请留空）</div>
							</div>
							<div>
								<label className="block text-sm text-gray-400 mb-1.5">当前密码</label>
								<input type="password" value={profileForm.oldPassword} onChange={(e) => setProfileForm((p) => Object.assign({}, p, { oldPassword: e.target.value }))} placeholder="请输入当前密码" className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500" />
							</div>
							<div>
								<label className="block text-sm text-gray-400 mb-1.5">新密码</label>
								<input type="password" value={profileForm.newPassword} onChange={(e) => setProfileForm((p) => Object.assign({}, p, { newPassword: e.target.value }))} placeholder="至少 6 个字符" className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500" />
							</div>
							<div>
								<label className="block text-sm text-gray-400 mb-1.5">确认新密码</label>
								<input type="password" value={profileForm.confirmPassword} onChange={(e) => setProfileForm((p) => Object.assign({}, p, { confirmPassword: e.target.value }))} placeholder="再次输入新密码" className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500" />
							</div>
							{profileError && <p className="text-sm text-red-400">{profileError}</p>}
							{profileSuccess && <p className="text-sm text-green-400">{profileSuccess}</p>}
						</div>
						<div className="p-6 pt-4 flex gap-3">
							<button onClick={() => setShowProfileModal(false)} disabled={profileSaving} className="flex-1 px-4 py-3 border-2 border-white/15 rounded-xl text-gray-300 font-medium hover:bg-white/8 transition-colors disabled:opacity-50">取消</button>
							<button onClick={handleSaveProfile} disabled={profileSaving} className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl text-white font-medium hover:from-purple-600 hover:to-indigo-600 transition-all disabled:opacity-50">{profileSaving ? "保存中..." : "保存"}</button>
						</div>
					</div>
				</div>
			)}

			{/* 支付弹窗 */}
			{showPaymentModal && (
			<div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => paymentStep !== 'processing' && handleClosePayment()}>
				<div className="backdrop-blur-xl rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-white/10" style={{ background: 'rgba(15,12,41,0.95)' }} onClick={(e) => e.stopPropagation()}>
					{paymentStep === 'select' && (
						<div className="p-6">
							<div className="flex items-center justify-between mb-6">
								<h3 className="text-xl font-bold text-white">选择支付方式</h3>
								<button onClick={handleClosePayment} className="text-gray-400 hover:text-white">
							<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
							</svg>
								</button>
							</div>
							<div className="mb-4 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
								<p className="text-sm text-gray-400">
							订购方案：<span className="font-semibold text-purple-400">{selectedLevel?.name}</span>
								</p>
								<p className="text-sm text-gray-400">
							支付金额：<span className="font-semibold text-purple-400">¥{formatYuan(selectedLevel ? selectedLevel.price : 0)}</span>
								</p>
							</div>
							<div className="space-y-3">
								{/* 微信支付 */}
								<button
							onClick={() => handleSelectPayment('wechat')}
							className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-white/10 hover:border-green-500 bg-white/3 hover:bg-green-500/5 transition-all group"
								>
							<div className="w-12 h-12 bg-green-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
								<svg className="w-7 h-7 text-green-400" viewBox="0 0 24 24" fill="currentColor">
									<path d="M8.5 13.5h2l1-3 1 3h2l-1 3-1 3-1-3-1-3zm-2 0h-2l-1 3 1 3 1-3 1-3zm13-8.5h-15c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h15c1.1 0 2-.9 2-2v-11c0-1.1-.9-2-2-2zm0 13h-15v-11h15v11z"/>
								</svg>
							</div>
							<div className="flex-1 text-left">
								<div className="font-semibold text-white">微信支付</div>
								<div className="text-sm text-gray-400">微信安全支付</div>
							</div>
							<svg className="w-5 h-5 text-gray-400 group-hover:text-green-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
							</svg>
								</button>
							{/* 支付宝 */}
								<button
							onClick={() => handleSelectPayment('alipay')}
							className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-white/10 hover:border-blue-500 bg-white/3 hover:bg-blue-500/5 transition-all group"
								>
							<div className="w-12 h-12 bg-blue-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
								<svg className="w-7 h-7 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
									<path d="M21.422 15.358c-3.22-1.386-6.847-2.408-10.112-3.146C12.51 9.743 14.1 6.7 14.1 6.7s-1.502-.36-2.94-.36c-3.377 0-5.78 1.548-5.78 4.155 0 3.322 3.296 5.074 6.414 6.325 1.91.764 4.07 1.216 6.258 1.576 1.176.194 2.37.336 3.56.4.156-.207.28-.428.357-.665.118-.368.107-.753-.047-1.113zm-14.89-5.394c0-1.755 1.528-2.764 3.678-2.764.97 0 1.948.19 2.87.52-.637 1.27-1.39 2.6-2.27 3.78-1.47-.41-4.277-1.024-4.277-1.536z"/>
								</svg>
							</div>
							<div className="flex-1 text-left">
								<div className="font-semibold text-white">支付宝</div>
								<div className="text-sm text-gray-400">支付宝安全支付</div>
							</div>
							<svg className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
							</svg>
								</button>
								{/* 第三方支付 - 银联 */}
								<button
							onClick={() => handleSelectPayment('third_party')}
							className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-white/10 hover:border-purple-500 bg-white/3 hover:bg-purple-500/5 transition-all group"
								>
							<div className="w-12 h-12 bg-purple-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
								<svg className="w-7 h-7 text-purple-400" viewBox="0 0 24 24" fill="currentColor">
									<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15l-4-4 1.41-1.41L11 14.17l6.59-6.59L19 9l-8 8z"/>
								</svg>
							</div>
							<div className="flex-1 text-left">
								<div className="font-semibold text-white">银联支付</div>
								<div className="text-sm text-gray-400">支持所有银联卡</div>
							</div>
							<svg className="w-5 h-5 text-gray-400 group-hover:text-purple-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
							</svg>
								</button>
							</div>
							<div className="mt-6 text-center text-xs text-gray-500">
								支付即表示同意《服务协议》和《隐私政策》
							</div>
						</div>
						)}
					{paymentStep === 'processing' && (
						<div className="p-8 text-center">
							<div className="w-20 h-20 mx-auto mb-4 relative">
								<div className="absolute inset-0 border-4 border-white/10 rounded-xl"></div>
								<div className="absolute inset-0 border-4 border-transparent border-t-purple-500 rounded-xl animate-spin"></div>
								<div className="absolute inset-0 flex items-center justify-center">
							{paymentMethod === 'wechat' && (
								<svg className="w-10 h-10 text-green-500" viewBox="0 0 24 24" fill="currentColor">
									<path d="M8.5 13.5h2l1-3 1 3h2l-1 3-1 3-1-3-1-3zm-2 0h-2l-1 3 1 3 1-3 1-3zm13-8.5h-15c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h15c1.1 0 2-.9 2-2v-11c0-1.1-.9-2-2-2zm0 13h-15v-11h15v11z"/>
								</svg>
								)}
							{paymentMethod === 'alipay' && (
								<svg className="w-10 h-10 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
									<path d="M21.422 15.358c-3.22-1.386-6.847-2.408-10.112-3.146C12.51 9.743 14.1 6.7 14.1 6.7s-1.502-.36-2.94-.36c-3.377 0-5.78 1.548-5.78 4.155 0 3.322 3.296 5.074 6.414 6.325 1.91.764 4.07 1.216 6.258 1.576 1.176.194 2.37.336 3.56.4.156-.207.28-.428.357-.665.118-.368.107-.753-.047-1.113zm-14.89-5.394c0-1.755 1.528-2.764 3.678-2.764.97 0 1.948.19 2.87.52-.637 1.27-1.39 2.6-2.27 3.78-1.47-.41-4.277-1.024-4.277-1.536z"/>
								</svg>
								)}
							{paymentMethod === 'third_party' && (
								<svg className="w-10 h-10 text-purple-500" viewBox="0 0 24 24" fill="currentColor">
									<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15l-4-4 1.41-1.41L11 14.17l6.59-6.59L19 9l-8 8z"/>
								</svg>
								)}
								</div>
							</div>
							<h3 className="text-lg font-bold text-white mb-2">支付处理中...</h3>
							<p className="text-sm text-gray-400 mb-6">
								{paymentMethod === 'wechat' ? '微信' : paymentMethod === 'alipay' ? '支付宝' : '银联'}支付已发起，请稍候
							</p>
							<div className="bg-white/5 rounded-xl p-4 mb-4 text-left">
								<div className="text-sm text-gray-400 mb-1">订单号</div>
								<div className="text-sm font-mono text-white break-all">{paymentOrder?.orderNo || '...'}</div>
							</div>
							<div className="w-full bg-white/10 rounded-full h-1.5 mb-4">
								<div className="bg-gradient-to-r from-purple-500 to-green-500 h-1.5 rounded-full animate-pulse" style={{width: '45%'}}></div>
							</div>
							<p className="text-xs text-gray-500">请不要关闭页面，支付完成后将自动跳转</p>
						</div>
						)}
					{paymentStep === 'success' && (
						<div className="p-8 text-center">
							<div className="w-20 h-20 mx-auto mb-4 bg-green-500/15 rounded-full flex items-center justify-center">
								<svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
							</svg>
								</div>
							<h3 className="text-lg font-bold text-white mb-2">支付成功！</h3>
							<p className="text-sm text-gray-400 mb-6">
								{selectedLevel?.name}已开通，开始享受更多功能
							</p>
							<button
								onClick={handleClosePayment}
								className="bg-gradient-to-r from-purple-500 to-indigo-500 text-white px-6 py-2 rounded-lg font-semibold hover:from-purple-600 hover:to-indigo-600 transition-all"
							>
								完成
							</button>
						</div>
						)}
				</div>
			</div>
			)}
			</main>
			</div>
	);
}
