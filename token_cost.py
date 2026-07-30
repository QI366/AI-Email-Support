"""
Token 用量与成本统计——按调用步骤（Step 1 打标签 / Step 2 写回复）分开算。

每次 chat/completions 调用返回的原始 JSON 里都带一个 "usage" 字段，里面是
供应商实际计费用的精确 token 数（prompt_tokens / completion_tokens /
total_tokens）——不需要在本地跑分词器去估算，直接读这个字段就是准确值。

这条 pipeline 里有两次独立的模型调用（tags.analyse() 打标签、Step 2 写回复），
两次可能用不同的模型、同一个模型的输入/输出单价也不一样，所以价格是按"调用
步骤"（step）分别配置的，而不是全局一个价格：

    MODEL_PRICE_INPUT_PER_1M_TAGS   / MODEL_PRICE_OUTPUT_PER_1M_TAGS   -> Step 1
    MODEL_PRICE_INPUT_PER_1M_REPLY  / MODEL_PRICE_OUTPUT_PER_1M_REPLY  -> Step 2

某个 step 的价格没配置时，回退到不带后缀的通用价格
（MODEL_PRICE_INPUT_PER_1M / MODEL_PRICE_OUTPUT_PER_1M），这样两步用同一个
模型时只需配置一次；再往下还是没有就按 0 处理——0.00 美元一眼就能看出
"忘记配置了"，比编一个看起来合理但其实是瞎猜的价格更安全。
"""

from __future__ import annotations

import os
from typing import Any


def _env_float(name: str) -> float | None:
    v = os.getenv(name)
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _step_price(direction: str, step: str | None) -> float:
    """解析某个 step 在某个方向（INPUT/OUTPUT）上的单价：优先取该 step 专属的
    环境变量，没有的话回退到通用变量，都没有则为 0。
    """
    if step:
        v = _env_float(f"MODEL_PRICE_{direction}_PER_1M_{step.upper()}")
        if v is not None:
            return v
    return _env_float(f"MODEL_PRICE_{direction}_PER_1M") or 0.0


def extract_usage(response: dict[str, Any]) -> dict[str, int]:
    """从 llm.complete() 返回的原始响应里取出这一次调用实际消耗的 token 数。

    usage 字段缺失或格式不对时返回全 0，而不是抛异常——成本统计是旁路功能，
    不应该因为某个供应商的响应格式有点不一样就把邮件回复流程搞挂了。
    """
    usage = response.get("usage") or {}
    prompt = int(usage.get("prompt_tokens") or 0)
    completion = int(usage.get("completion_tokens") or 0)
    total = int(usage.get("total_tokens") or (prompt + completion))
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total,
    }


def estimate_cost(
    usage: dict[str, int],
    *,
    step: str | None = None,
    input_price_per_1m: float | None = None,
    output_price_per_1m: float | None = None,
) -> dict[str, float]:
    """把 token 用量换算成美元成本。

    显式传入 input_price_per_1m/output_price_per_1m 时优先用它们；否则按
    `step`（如 "tags" / "reply"）去查对应的环境变量，找不到再回退到通用价格，
    详见模块顶部说明。
    """
    in_price = input_price_per_1m if input_price_per_1m is not None else _step_price("INPUT", step)
    out_price = output_price_per_1m if output_price_per_1m is not None else _step_price("OUTPUT", step)

    input_cost = usage["prompt_tokens"] / 1_000_000 * in_price
    output_cost = usage["completion_tokens"] / 1_000_000 * out_price
    return {
        "input_cost_usd": round(input_cost, 6),
        "output_cost_usd": round(output_cost, 6),
        "total_cost_usd": round(input_cost + output_cost, 6),
    }


def usage_and_cost(
    response: dict[str, Any],
    *,
    step: str | None = None,
    input_price_per_1m: float | None = None,
    output_price_per_1m: float | None = None,
) -> dict[str, Any]:
    """便捷入口：直接从 llm.complete() 的原始响应算出 用量 + 成本（按 step 定价）。"""
    usage = extract_usage(response)
    cost = estimate_cost(
        usage, step=step, input_price_per_1m=input_price_per_1m, output_price_per_1m=output_price_per_1m
    )
    return {**usage, **cost}


_EMPTY_BUCKET = {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "total_cost_usd": 0.0}


class CostTracker:
    """按 step 分别累加用量/成本，同时也能拿到跨所有 step 的总和。

    一封邮件的完整流程会调用两次模型（Step 1 分类、Step 2 写回复），各自的
    token 数和单价都可能不一样，所以内部按 step 名称分桶存放；`summary()`
    再把所有桶加总成一个总计，对应"分别统计，然后计算总和"这个需求。
    """

    def __init__(self) -> None:
        self._steps: dict[str, dict[str, float]] = {}

    def _bucket(self, step: str) -> dict[str, float]:
        return self._steps.setdefault(step, dict(_EMPTY_BUCKET))

    def _merge(self, step: str, entry: dict[str, Any]) -> None:
        b = self._bucket(step)
        b["calls"] += 1
        b["prompt_tokens"] += entry["prompt_tokens"]
        b["completion_tokens"] += entry["completion_tokens"]
        b["total_tokens"] += entry["total_tokens"]
        b["total_cost_usd"] += entry["total_cost_usd"]

    def add_response(self, response: dict[str, Any], *, step: str) -> dict[str, Any]:
        """记录一次调用的原始响应（在这里现算 usage+cost），返回这一次单独的结果。"""
        entry = usage_and_cost(response, step=step)
        self._merge(step, entry)
        return entry

    def add_usage(self, entry: dict[str, Any], *, step: str) -> dict[str, Any]:
        """记录一份别处已经算好的 usage+cost（比如 tags.analyse() 自己算过一次，
        这里就不用重复算），同样按 step 累加进去。
        """
        self._merge(step, entry)
        return entry

    def by_step(self) -> dict[str, dict[str, Any]]:
        return {step: {**b, "total_cost_usd": round(b["total_cost_usd"], 6)} for step, b in self._steps.items()}

    def summary(self) -> dict[str, Any]:
        total = dict(_EMPTY_BUCKET)
        for b in self._steps.values():
            for k in total:
                total[k] += b[k]
        total["total_cost_usd"] = round(total["total_cost_usd"], 6)
        return {"by_step": self.by_step(), "total": total}
