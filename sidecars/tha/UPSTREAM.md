# tha：上游基线与本地改动登记

## 上游基线

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/zpeng11/ezvtuber-rt |
| 上游 commit | `ea51225dd83113414c86bcb618d4d9af37365baa`（main，2026-03-26，"Merge pull request #1 from yuyuyzl/main"） |
| 上游代码范围 | `runtime/ezvtb_rt/`（15 个文件） |
| 导入提交 | `5539447`（2026-09-27，当时路径 `tha-runtime/`）；之后移到 `integrations/easyvtuber/runtime/`，P1 移到 `sidecars/tha/runtime/` |
| 模型来源 | 上游 release `0.0.1/20241220.zip`，由 `scripts/fetch-models.js` 下载，不入库 |

核对方法（2026-10-01）：把 `5539447:tha-runtime/ezvtb_rt` 的 15 个文件与上游各分支最近的提交逐一比对 blob。`ea51225` 全部一致，导入后也没有再改过。

## 自有部分

`runtime/` 下除 `ezvtb_rt/` 外都是 any-lover 自己写的：

- `tha_server.py`：WebSocket 服务入口（端口 12395），协议见 `packages/protocol/src/ws-tha.ts`
- `preprocess_image.py`、`src/`：立绘预处理
- `requirements.txt`：首启安装的运行依赖
- `data/images/`：示例立绘

`tha_server.py` 以同级包的方式 `import ezvtb_rt`，所以暂时不把上游代码单独拆到 `upstream/`。

## 同步上游

1. 在上游仓库找到新的目标 commit，用它的 `ezvtb_rt/` 覆盖 `runtime/ezvtb_rt/`。
2. 跑一次 THA 渲染（Windows），确认 `tha_server.py` 用到的接口没有变。
3. 更新本文件"上游基线"一节的 commit 和日期。
