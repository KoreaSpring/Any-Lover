# 角色形象方案：备选与后续路线（记录，不阻塞主线）

> 主线已定：Windows = 方案甲（动漫立绘 → THA 2D 桌宠），Mac = 现有 Live2D。详见 `easyvtuber-integration.md`。
> 本文件记录调研过的其他路线，供后续决策，当前不实施。

## 产品目标回顾

用户上传一张图（动漫/真人）→ 得到可动的桌宠角色。该目标拆为：
- **A. 从图生成可动角色**（真正的难点，随输入/输出维度成熟度差异极大）
- **B. 角色作桌宠陪伴**（Any-Lover 现成能力）

## 各路线成熟度（2026 调研）

| 输入 → 输出 | 成熟度 | 方案 | 关键问题 |
| --- | --- | --- | --- |
| 动漫图 → 2D 可动（THA） | 🟡 可用有约束 | EasyVtuber THA = **方案甲（主线）** | 吃特定画风 512×512 立绘；需 Win+独显 |
| 动漫图 → 3D VRM | 🔴 研究阶段 | CharacterGen / PAniC-3D 等 | 网格质量不稳、自动绑骨/表情不可靠 |
| 真人图 → 2D 说话视频 | 🟢 成熟 | SadTalker / LeapTalk | 输出是视频/逐帧非可自由驱动模型；真人脸=PII |
| 真人图 → 3D avatar | 🔴 研究/闭源 | SOAP 论文 / 3D AI Studio(闭源付费) | 开源不成熟；好用的要联网+收费 |

依据（公开资料，内容已改写以符合引用规范）：
- [talking-head-anime-4](https://github.com/pkhungurn/talking-head-anime-4-demo)
- [SadTalker](https://github.com/mozuck/SadTalker) / [LeapTalk](https://github.com/zhangrongxiang/LeapTalk)
- [CharacterGen 论文](https://arxiv.org/abs/2402.17214) / [SOAP 论文](https://arxiv.org/html/2505.05022v1)
- [3D AI Studio](https://www.3daistudio.com/blog/best-ai-tools-for-vrchat-vtuber-avatars-2026)

## 方案乙：VRoid 捏脸 → VRM 3D 桌宠（Mac 可选后续）

- 思路：不做"图生成"，让用户用免费 [VRoid Studio](https://vroid.com/en/studio) 捏 3D 角色导出 `.vrm`，前端用 [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) 渲染，口型用 [three-vrm-lip-sync](https://github.com/vlapky/three-vrm-lip-sync)（喂 TTS 音频流实时对口型，纯浏览器）。
- 优点：跨平台（Win/Mac/Web）、不挑显卡（普通集显即可）、口型库现成、后端 WebSocket/TTS 不动、打包几乎不增体积、**可在 Mac 上开发验证**。
- 代价：3D 卡通画风（非 2D 手绘）；不是"上传图生成"而是"捏"；VRoid 默认脸辨识度偏高。
- 参考同类：ChatVRM、AITuberKit、Vela 等 AI 陪伴项目走的都是这条线。

## 方案丙：任意图/真人图 → AI 自动生成（预研，风险高）

- 现状：开源方案 2026 仍不成熟。动漫→3D 在论文阶段；真人→可动质量差且涉及肖像权/深度伪造风险。
- "生成"这一步很重：本地要跑扩散/大模型（比 THA 更重），或调云端 API（联网+成本+隐私），与"本地优先、下载即用"定位冲突。
- 建议：真做的话先**技术预研**——THA 自动预处理 + 图生成/抠图流程，在 Windows 小范围测"什么图能成、成功率多少"，通过再产品化。**真人线暂缓**（质量+隐私双重不成熟）。

## 当前结论

- 现在只做**方案甲**（Win）+ **Live2D**（Mac）。
- 方案乙作为 Mac 的可选升级，方案丙作为独立预研项，均**不阻塞主线**。
