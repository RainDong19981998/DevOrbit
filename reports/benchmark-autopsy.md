# 公开基准失败案例深度剖析

> **诚实声明**：公开基准评测仅记录 pass/fail（status/compilePassed/testsPassed/closedLoop），不记录失败根因。根因分类基于 results.json 的 error 字段和 devorbit.json 的 evaluation.detail 人工推断。results.json 不含 attempts/patchAttempts 字段，返工次数从 devorbit.json 的 attempts 字段读取（仅 completed 案例有该文件）。

Generated: 2026-08-28T06:23:49.296Z

## 1. 运行失败案例根因分类（status 非 completed，n=5）

| Case ID | Status | Category | Reason | Duration(ms) | Attempts |
|---|---|---|---|---:|---:|
| PUB-PYDICOM__PYDICOM-1069 | skipped | environment-mismatch | baseline FAIL_TO_PASS already green on base commit; case excluded as environment | 10176 | n/a |
| PUB-PYLINT-DEV__ASTROID-1262 | error | environment-mismatch | dependency install failed: in1/miniconda3/lib/python3.13/inspect.py). Did you me | 5434 | n/a |
| PUB-PYLINT-DEV__ASTROID-1962 | error | environment-mismatch | dependency install failed: as no attribute 'ImpImporter'. Did you mean: 'zipimpo | 2880 | n/a |
| PUB-PYLINT-DEV__ASTROID-1959 | error | environment-mismatch | dependency install failed: as no attribute 'ImpImporter'. Did you mean: 'zipimpo | 2795 | n/a |
| PUB-MARSHMALLOW-CODE__MARSHMALLOW-1343 | error | unclassified | model HTTP 502: {"error":{"message":"Unable to connect to the Zhanlu model servi | 3960 | 2 |

### 根因分类统计

- environment-mismatch: 4 例
- unclassified: 1 例

## 2. 补丁未通过案例（completed but closedLoop=false，n=22）

所有 22 个 completed 案例均未闭环（testsPassed=false）。devorbit.json 显示 patch 已生成但未通过测试，多数为 git apply --check 失败。

| Case ID | Attempts | RCA Files | Gold Files | Eval Detail |
|---|---:|---|---|---|
| PUB-PYDICOM__PYDICOM-903 | 3 |  | pydicom/filewriter.py | edit apply failed: pydicom/filewriter.py: search block not f |
| PUB-PYDICOM__PYDICOM-1076 | 3 |  | pydicom/filewriter.py, pydicom/values.py | edit apply failed: pydicom/filewriter.py: search block not f |
| PUB-PYDICOM__PYDICOM-1031 | 3 |  | pydicom/dataelem.py | F2P red; P2P green  |
| PUB-PYDICOM__PYDICOM-955 | 3 |  | pydicom/dataelem.py, pydicom/pixel_data_handlers/util.py | F2P red; P2P green  |
| PUB-PYDICOM__PYDICOM-1694 | 3 |  | pydicom/dataset.py | edit apply failed: pydicom/dataset.py: search block not foun |
| PUB-PYDICOM__PYDICOM-1428 | 3 |  | pydicom/fileset.py | edit apply failed: pydicom/fileset.py: search block not foun |
| PUB-PYDICOM__PYDICOM-839 | 3 |  | pydicom/filewriter.py | F2P red; P2P green  |
| PUB-PYDICOM__PYDICOM-1256 | 3 |  | pydicom/jsonrep.py | F2P red; P2P green  |
| PUB-SQLFLUFF__SQLFLUFF-4151 | 3 |  | src/sqlfluff/cli/commands.py | F2P red; P2P green  |
| PUB-SQLFLUFF__SQLFLUFF-2573 | 3 |  | src/sqlfluff/core/config.py, src/sqlfluff/core/linter/linter.py | edit apply failed: src/sqlfluff/core/linter/linter.py: searc |
| PUB-SQLFLUFF__SQLFLUFF-884 | 3 |  | src/sqlfluff/core/dialects/dialect_ansi.py, src/sqlfluff/core/parser/lexer.py | F2P red; P2P green  |
| PUB-SQLFLUFF__SQLFLUFF-2998 | 3 |  | src/sqlfluff/rules/L027.py | F2P red; P2P green  |
| PUB-SQLFLUFF__SQLFLUFF-4778 | 3 |  | src/sqlfluff/core/linter/linter.py, src/sqlfluff/core/templaters/slicers/tracer.py | edit apply failed: src/sqlfluff/core/templaters/slicers/trac |
| PUB-SQLFLUFF__SQLFLUFF-3220 | 3 |  | src/sqlfluff/cli/commands.py | edit apply failed: src/sqlfluff/cli/commands.py: search bloc |
| PUB-SQLFLUFF__SQLFLUFF-1577 | 3 |  | src/sqlfluff/core/templaters/base.py | edit apply failed: src/sqlfluff/__init__.py: search block no |
| PUB-SQLFLUFF__SQLFLUFF-1625 | 3 |  | src/sqlfluff/rules/L031.py | edit apply failed: src/sqlfluff/__init__.py: search block no |
| PUB-PYLINT-DEV__ASTROID-1196 | 3 |  | astroid/nodes/node_classes.py | edit apply failed: astroid/nodes/node_classes.py: search blo |
| PUB-PYLINT-DEV__ASTROID-941 | 3 |  | astroid/brain/brain_namedtuple_enum.py, astroid/scoped_nodes.py | edit apply failed: astroid/scoped_nodes.py: search block not |
| PUB-PYLINT-DEV__ASTROID-2023 | 3 |  | astroid/nodes/node_classes.py | F2P red; P2P green  |
| PUB-MARSHMALLOW-CODE__MARSHMALLOW-1359 | 3 |  | src/marshmallow/fields.py | F2P red; P2P green  |
| PUB-MARSHMALLOW-CODE__MARSHMALLOW-1810 | 3 |  | src/marshmallow/base.py, src/marshmallow/fields.py | F2P red; P2P green  |
| PUB-MARSHMALLOW-CODE__MARSHMALLOW-1252 | 3 |  | src/marshmallow/utils.py | F2P red; P2P green  |

## 3. 自愈救回统计

- 经历返工（attempts≥2）的案例数：23
- 返工后闭环成功的案例数（首版失败→返工后成功）：0
- 全部 30 个 devorbit 案例的 closedLoop 均为 false：false

> 由于所有案例 closedLoop 均为 false，自愈救回数为 0。这反映当前模型能力尚不足以在公开 SWE-bench 案例上实现闭环修复，而非自愈机制本身无效（见 reports/ablation.md 的机制级消融）。

### attempts 分布

- attempts=1: 3 例
- attempts=2: 1 例
- attempts=3: 22 例

## 4. 诚实边界声明

1. 公开基准评测仅记录 pass/fail（status/compilePassed/testsPassed/closedLoop），不记录失败根因。
2. 根因分类基于 results.json 的 error 字段和 devorbit.json 的 evaluation.detail 人工推断，非自动化根因分析。
3. results.json 不含 attempts/patchAttempts 字段，返工次数从 devorbit.json 的 attempts 字段读取。
4. 5 个运行失败案例中，4 个为环境不匹配，0 个为超时。
5. 22 个 completed 案例均因补丁未通过测试而失败（patch-incomplete）。
6. 自愈救回数为 0（所有 closedLoop=false），但 golden-cases 层消融实验证明自愈机制可将首版失败补丁通过返工修复（见 reports/ablation.md）。

---

Generated: 2026-08-28T06:23:49.296Z
