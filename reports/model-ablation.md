# 三维消融实验（同一冻结 30 案例 test split）

> Three-dimensional ablation on the same frozen 30-case SWE-bench dev test split (manifest digest checked per entry). Pipeline dimension compares diff-based V0.8 archive vs edit-based V0.9.6 under the same model; model dimension compares edit-based runs across models; architecture dimension compares devorbit vs single-agent under the same model and pipeline. All intervals are 95% Wilson. Missing entries are disclosed, not imputed.

Generated: 2026-08-28T06:24:03.781Z

## 维度一：管道（同模型 deepseek-v4-flash-0731，diff-based V0.8 vs edit-based V0.9.6）

| 管道 | 方法 | 闭环率 | 补丁可应用率 | 测试通过率 | RCA Top-3 |
|---|---|---:|---:|---:|---:|
| diff-based (completed) | devorbit | 0.0% (0.0-11.4%, n=30) | 0.0% (0.0-11.4%, n=30) | 0.0% (0.0-11.4%, n=30) | 0.0% (0.0-11.4%, n=30) |
| diff-based (completed) | single-agent | 0.0% (0.0-11.4%, n=30) | 0.0% (0.0-11.4%, n=30) | 0.0% (0.0-11.4%, n=30) | 0.0% (0.0-11.4%, n=30) |
| edit-based (completed) | devorbit | 10.0% (3.5-25.6%, n=30) | 50.0% (33.2-66.8%, n=30) | 10.0% (3.5-25.6%, n=30) | 80.0% (62.7-90.5%, n=30) |

## 维度二：模型（同 edit-based 管道，devorbit 方法）

| 模型 | 状态 | 闭环率 | 补丁可应用率 | 测试通过率 | RCA Top-3 | 平均 tokens |
|---|---|---:|---:|---:|---:|---:|
| deepseek-v4-flash-0731 | completed | 10.0% (3.5-25.6%, n=30) | 50.0% (33.2-66.8%, n=30) | 10.0% (3.5-25.6%, n=30) | 80.0% (62.7-90.5%, n=30) | 39,638 (n=26) |
| glm | completed | 10.0% (3.5-25.6%, n=30) | 46.7% (30.2-63.9%, n=30) | 10.0% (3.5-25.6%, n=30) | 73.3% (55.6-85.8%, n=30) | 37,180 (n=25) |
| qwen3:8b | completed | 0.0% (0.0-39.0%, n=6) | 16.7% (3.0-56.4%, n=6) | 0.0% (0.0-39.0%, n=6) | 83.3% (43.6-97.0%, n=6) | 60,031 (n=5) |

## 维度三：架构（同模型同管道，devorbit vs single-agent）

| 模型 | 方法 | 闭环率 | 补丁可应用率 | 测试通过率 | 平均耗时(ms) | 平均 tokens |
|---|---|---:|---:|---:|---:|---:|
| glm | devorbit | 10.0% (3.5-25.6%, n=30) | 46.7% (30.2-63.9%, n=30) | 10.0% (3.5-25.6%, n=30) | 27,692 (n=25) | 37,180 (n=25) |
| glm | single-agent | 0.0% (0.0-11.4%, n=30) | 6.7% (1.8-21.3%, n=30) | 0.0% (0.0-11.4%, n=30) | 26,494 (n=26) | 19,947 (n=26) |

## 诚实边界

- 各条目均校验与冻结 manifest 的 digest 一致性；`not_run` 条目为尚未完成或缺失的结果文件，不作任何插补。
- V0.8 diff-based 数据来自归档 `evaluation/archive/public-benchmark-results-v0.8-diff-based.json`，是其原始冻结结果，未重跑。
- 本地 qwen3:8b 为离线可复现对照组；其结果不外推为模型有效性结论。
