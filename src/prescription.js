function hasPattern(patterns, name) {
  return Array.isArray(patterns) && patterns.includes(name);
}

function buildConvergencePlan({ symptom = "", patterns = [] } = {}) {
  const rounds = [];

  rounds.push({
    round: 1,
    title: "初始解路径（仅改 Solve 顺序）",
    objective: "先保证 Poisson 初值稳定，再耦合载流子方程。",
    actions: [
      "先执行 Coupled { Poisson }，再执行 Coupled { Poisson Electron Hole }。",
      "保持其他 Math 参数不变，用于隔离变量影响。",
    ],
    successSignal: "初始步不再立即发散，RHS 峰值显著下降。",
    rollback: "若无改善，回滚到原 Solve 块，进入下一轮仅调整步长。",
  });

  rounds.push({
    round: 2,
    title: "偏置步长（仅改 Quasistationary Step）",
    objective: "降低偏置跃迁导致的非线性冲击。",
    actions: [
      "减小 InitialStep（例如 1e-3 -> 1e-4）。",
      "设置更小 MinStep 并限制 MaxStep。",
      "只改 Step 参数，不同时改精度和求解器。",
    ],
    successSignal: "迭代轮数下降或可走完更多偏置点。",
    rollback: "若速度过慢且无稳定性收益，恢复 Step 参数。",
  });

  const precisionActions = [
    "启用 ExtendedPrecision。",
    "设置 RefDens_GradQuasiFermi_ElectricField=1e12。",
    "保留 Extrapolate(LowDensityLimit=1e3) 提升低密度区域稳定性。",
  ];

  if (hasPattern(patterns, "nan_error")) {
    precisionActions.unshift("优先处理 NAN：先启用高精度后再测一次基线。 ");
  }

  rounds.push({
    round: 3,
    title: "数值精度（仅改 Math 精度项）",
    objective: "修复低密度区域与高场区域的数值不稳定。",
    actions: precisionActions,
    successSignal: "NAN 消失，残差曲线更平滑。",
    rollback: "若收敛无改善且耗时显著增加，保留必要项并回退次要精度项。",
  });

  const solverActions = [
    "调整 ILS/GMRES 参数（如 maxit、tolrel、tolunprec）。",
    "仅在前三轮仍失败时再考虑网格局部加密。",
    "对 BV/Avalanche 场景启用 RobustBoxMethod / ElementVolumeAvalanche。",
  ];

  if (hasPattern(patterns, "linear_solver_issue")) {
    solverActions.unshift("优先检查线性求解器设置与预条件器匹配。 ");
  }

  rounds.push({
    round: 4,
    title: "求解器与网格（最后手段）",
    objective: "在不破坏可追踪性的前提下做最终稳定化。",
    actions: solverActions,
    successSignal: "目标偏置窗口内稳定完成求解。",
    rollback: "若结果偏离基线或速度不可接受，撤销本轮改动并回到前一稳定轮。",
  });

  return {
    symptom,
    patterns,
    strategy: "分轮单变量改动 + 每轮可回滚",
    rounds,
  };
}

function formatConvergencePlanMarkdown(plan) {
  const p = plan || {};
  const lines = [];
  lines.push("## 分轮实验计划（P2）");
  lines.push("");
  lines.push(`- 症状输入: ${p.symptom || "(无)"}`);
  lines.push(`- 命中模式: ${(p.patterns || []).join(", ") || "(未命中)"}`);
  lines.push(`- 策略: ${p.strategy || "分轮改动"}`);
  lines.push("");

  for (const r of p.rounds || []) {
    lines.push(`### Round ${r.round}: ${r.title}`);
    lines.push(`- 目标: ${r.objective}`);
    lines.push("- 改动:");
    for (const a of r.actions || []) {
      lines.push(`  - ${a}`);
    }
    lines.push(`- 观察信号: ${r.successSignal}`);
    lines.push(`- 最小回滚: ${r.rollback}`);
    lines.push("");
  }

  return lines.join("\n");
}

module.exports = {
  buildConvergencePlan,
  formatConvergencePlanMarkdown,
};

