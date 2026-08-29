# Contributing to DevOrbit

感谢你对 DevOrbit 的关注。DevOrbit 是一套自动处理线上缺陷的多 Agent 研发闭环平台：输入 Issue、日志与代码仓，输出根因、补丁、测试报告、发布决策和可审计证据链。

## 快速开始（无第三方依赖）

环境要求：Node.js 20+。无需安装任何 npm 依赖。

```bash
npm test        # 单元测试
npm start       # 启动演示驾驶舱 → http://localhost:4173
npm run validate  # 全量校验
```

## 如何贡献

### 报告问题
通过 GitHub Issues 提交。请包含：期望行为、实际行为、复现步骤、`npm test` 输出。安全相关问题请不要公开提交 Issue，见下方"安全披露"。

### 提交改动
1. Fork 仓库并创建分支。
2. 保持零第三方 npm 依赖（仅用 Node.js 标准库）。
3. 新增行为必须带测试：`npm test` 与 `npm run validate` 全绿才能合入。
4. 遵循现有代码风格（ESM、无框架、显式错误处理）。
5. 提交信息使用 `feat: / fix: / docs: / chore:` 前缀。

### Skill / Worker 扩展
- 新 Skill 放在 `skills/<id>/SKILL.md`，frontmatter 需声明 `name` + `version`（SemVer），并同步 `src/skills.js`。
- 每个 Skill 改动需更新 `npm run write-skills-registry` 生成注册表。
- 新 Worker 参考 `src/agents/` 现有边界：单职能、最小权限、只经 Manager 委派。

## 验证约定（诚实边界）

- 所有指标可复现：报告数字必须能由仓库内命令独立重放。
- 仿真与真实严格区分：仿真数据必须标注口径，不得外推为生产收益。
- 失败按负例披露，不掩盖、不挑选。

## 安全披露

发现安全问题请通过私密渠道联系维护者，不要公开 Issue。我们会确认影响范围后再修复并公开。

## 许可证

Apache-2.0，见 [LICENSE](LICENSE)。贡献即代表同意按此协议授权。
