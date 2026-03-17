function detectPatterns(logText) {
  const text = (logText || "").toLowerCase();
  const hits = [];

  if (/rhs\|?\s*increased by more than factor|1\.0000e10/.test(text)) {
    hits.push("rhs_explosion");
  }
  if (/nan|not a number/.test(text)) {
    hits.push("nan_error");
  }
  if (/did not converge|no convergence|failed to converge/.test(text)) {
    hits.push("not_converged");
  }
  if (/gradquasifermi/.test(text)) {
    hits.push("grad_quasi_fermi_issue");
  }
  if (/avalanche|breakdown/.test(text)) {
    hits.push("avalanche_case");
  }
  if (/matrix|linear solver|gmres|ils/.test(text)) {
    hits.push("linear_solver_issue");
  }

  return Array.from(new Set(hits));
}

function suggestionForPattern(pattern) {
  switch (pattern) {
    case "rhs_explosion":
      return {
        title: "初始耦合过重导致 RHS 爆炸",
        actions: [
          "先用 Poisson 单方程寻找初始解，再切回 Poisson+Electron+Hole",
          "减小 InitialStep，提高 Iterations (例如 30~50)",
          "检查偏置跃迁是否过大，使用更平滑的 Quasistationary ramp",
        ],
        patch: `Solve {
  Coupled { Poisson }
  Coupled { Poisson Electron Hole }
  Quasistationary(InitialStep=1e-4 MinStep=1e-7 MaxStep=0.02) {
    Coupled { Poisson Electron Hole }
  }
}`,
      };

    case "nan_error":
      return {
        title: "出现 NAN，通常与数值精度不足或极小网格元素有关",
        actions: [
          "启用 ExtendedPrecision（必要时 BM_ExtendedPrecision）",
          "提高 Digits，并检查极端小网格元素",
          "对低密度区域启用 Extrapolate(LowDensityLimit)",
        ],
        patch: `Math {
  Digits=5
  ExtendedPrecision
  BM_ExtendedPrecision
  Extrapolate(LowDensityLimit=1e3)
}`,
      };

    case "grad_quasi_fermi_issue":
      return {
        title: "GradQuasiFermi 在低载流子密度区域不稳定",
        actions: [
          "设置 RefDens_GradQuasiFermi_ElectricField=1e12",
          "保持 Extrapolate(LowDensityLimit=1e3) 以提升鲁棒性",
        ],
        patch: `Math {
  RefDens_GradQuasiFermi_ElectricField=1e12
  Extrapolate(LowDensityLimit=1e3)
}`,
      };

    case "avalanche_case":
      return {
        title: "BV/Avalanche 场景建议专用数值设置",
        actions: [
          "尝试 RobustBoxMethod, ElementVolumeAvalanche",
          "可配合 AvalFlatElementExclusion=1.0 减少坏单元影响",
          "使用更细致的高场区域网格并控制步长",
        ],
        patch: `Math {
  RobustBoxMethod
  BM_ExtendedPrecision
  ElementVolumeAvalanche
  AvalFlatElementExclusion=1.0
}`,
      };

    case "linear_solver_issue":
      return {
        title: "线性求解器收敛困难",
        actions: [
          "采用 ILS(set=25) + GMRES + ILUT 预条件",
          "提升 maxit 并适当调整 tolrel/tolunprec",
        ],
        patch: `Math {
  Method=ILS(set=25)
  ILSrc="set(25){ iterative(gmres(150), tolrel=1e-10, tolunprec=1e-4, maxit=300); preconditioning(ilut(6e-06,-1),left); }"
}`,
      };

    case "not_converged":
    default:
      return {
        title: "通用不收敛处置",
        actions: [
          "先获得稳健初始解（Poisson → Coupled）",
          "减小偏置步长并增加迭代次数",
          "提高数值精度并检查网格与边界条件",
        ],
        patch: `Math {
  Digits=5
  ErrRef(Electron)=1e8
  ErrRef(Hole)=1e8
  ExtendedPrecision
}`,
      };
  }
}

function buildPatternEvidenceQuery(patterns) {
  const base = ["GaN", "HEMT", "SDevice", "convergence", "RHS", "NAN"];
  const map = {
    rhs_explosion: ["RHS increased by more than factor", "InitialStep", "Quasistationary"],
    nan_error: ["NAN", "ExtendedPrecision", "LowDensityLimit"],
    not_converged: ["did not converge", "Iterations", "step"],
    grad_quasi_fermi_issue: [
      "GradQuasiFermi",
      "RefDens_GradQuasiFermi_ElectricField",
      "Extrapolate",
    ],
    avalanche_case: ["Avalanche", "Breakdown", "RobustBoxMethod", "ElementVolumeAvalanche"],
    linear_solver_issue: ["ILS", "GMRES", "ILUT", "linear solver"],
  };

  const words = [];
  for (const p of patterns || []) {
    words.push(...(map[p] || []));
  }
  return Array.from(new Set([...base, ...words])).join(" ");
}

function diagnoseLog(logText) {
  const patterns = detectPatterns(logText);
  const suggestions = patterns.map(suggestionForPattern);

  if (suggestions.length === 0) {
    suggestions.push(
      suggestionForPattern("not_converged"),
      suggestionForPattern("grad_quasi_fermi_issue")
    );
  }

  return {
    patterns,
    suggestions,
  };
}

function formatDiagnosisReport(report) {
  const lines = [];
  lines.push("# TCAD 日志诊断报告");
  lines.push("");
  if (report.patterns.length > 0) {
    lines.push(`识别模式: ${report.patterns.join(", ")}`);
  } else {
    lines.push("识别模式: 未命中明确模式（给出通用稳健策略）");
  }
  lines.push("");

  report.suggestions.forEach((s, idx) => {
    lines.push(`## ${idx + 1}. ${s.title}`);
    lines.push("- 建议:");
    for (const a of s.actions) {
      lines.push(`  - ${a}`);
    }
    lines.push("- 可直接试用片段:");
    lines.push("```tcad");
    lines.push(s.patch);
    lines.push("```");
    lines.push("");
  });

  lines.push("证据来源建议：优先回查官方 greadme、sdevice_ug、solvers_ug 与你的收敛性节选。\n");
  return lines.join("\n");
}

module.exports = {
  diagnoseLog,
  formatDiagnosisReport,
  buildPatternEvidenceQuery,
};
