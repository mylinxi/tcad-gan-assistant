const TEMPLATE_LIBRARY = {
  "GaN HEMT - SDE 骨架": {
    id: "gan-hemt-sde",
    suggestedFileName: "gan_hemt_sde.cmd",
    content: `# GaN HEMT SDE Skeleton (MVP)
# 说明: 该模板用于快速起步，后续请按实际工艺尺寸/掺杂校准。

set Lg    1.0e-6
set Lsg   0.5e-6
set Lgd   6.0e-6
set Tch   0.02e-6
set Tbar  0.01e-6
set Tbuf  2.5e-6

# ==== Geometry ==== 
# TODO: 在此补充具体 region 定义与布尔操作

# ==== Doping ==== 
# AlGaN barrier Mg: ~2e16 cm^-3 (示例)
# S/D GaN Si: ~2e20 cm^-3 (示例)

# ==== Contacts ====
# TODO: Source/Drain/Gate/Thermal/Backside

# ==== Mesh Hints ====
# - 接口附近加密 (AlGaN/GaN)
# - Gate edge / Drain-side high-field region 细化
`,
  },

  "GaN HEMT - SProcess 骨架": {
    id: "gan-hemt-sprocess",
    suggestedFileName: "gan_hemt_sprocess.cmd",
    content: `# GaN HEMT SProcess Skeleton (MVP)

fset Lsg 0.5
fset Lgd 6.0
fset Lg  @lgate@
fset Ls  0.4
fset Ld  0.4
fset Ymin 0
fset Ymax [expr $Ls+$Lsg+$Lg+$Lgd+$Ld]

line x location=0.0 tag=top spacing=0.01<um>
line x location=1.0 tag=bottom spacing=0.1<um>
line y location=$Ymin tag=left spacing=1.0<um>
line y location=$Ymax tag=right spacing=1.0<um>
region Silicon xlo=top xhi=bottom ylo=left yhi=right
init

# ===== Diffusion / Activation =====
foreach dopant {Silicon} {
  SetIIIVDiffParams GaN $dopant
  pdbSetSwitch GaN $dopant DiffModel Constant
  pdbSetSwitch GaN $dopant ActiveModel Solid
  pdbSetDouble GaN $dopant Solubility 1e30
}

foreach dopant {Magnesium} {
  SetIIIVDiffParams GaN $dopant
  pdbSetSwitch GaN $dopant DiffModel Fermi
  pdbSetSwitch GaN $dopant ActiveModel Solid
  pdbSetDouble GaN $dopant Solubility 1e30
}

# ===== Epi Growth =====
diffuse iiiv.epi=GaN time=1<min> temperature=600.0 \
  epi.thickness=[expr (@tbuffer@ + @tchannel@)]<um> \
  epi.doping="Silicon=1e15" epi.model=0 epi.layers=20

deposit AlGaN isotropic thickness=@tbarrier@<um> \
  fields.values={"Magnesium=2e16" "xMoleFraction=0.18"}

# ===== p-Gate =====
photo mask=gate thickness=0.5
etch material="Nitride" thickness=0.5 anisotropic
strip resist
diffuse iiiv.epi=GaN time=@dTime@<min> temperature=@dTemp@ \
  epi.thickness=@tgate@<um> epi.doping="Magnesium=@pGateMg@" \
  epi.model=0 epi.layers=20

# ===== Device Mesh =====
line clear
refinebox clear
refinebox name=interface1 min.normal.size="2e-3" normal.growth.ratio=1.2 \
  interface.materials={GaN AlGaN}
grid remesh
`,
  },

  "GaN HEMT - SDevice 骨架": {
    id: "gan-hemt-sdevice",
    suggestedFileName: "gan_hemt_sdevice.cmd",
    content: `# GaN HEMT SDevice Skeleton (MVP)

File {
  Grid      = "@tdr@"
  Parameter = "sdevice.par"
  Current   = "@plot@"
  Output    = "@log@"
}

Electrode {
  { Name="Source" Voltage=0.0 }
  { Name="Drain"  Voltage=0.0 }
  { Name="Gate"   Voltage=0.0 }
  { Name="thermal" Temperature=300.0 }
}

Physics (Region="channel") {
  Mobility (
    Enormal(IALMob)
    HighFieldSaturation(GradQuasiFermi DensityDependentVsat)
  )
}

Physics {
  AreaFactor=@AreaFactor@
  DefaultParametersFromFile
  Fermi
  EffectiveIntrinsicDensity(Nobandgapnarrowing)
  Mobility (DopingDependence HighFieldSaturation)
  Recombination (SRH Radiative Auger)
  IncompleteIonization(Dopants="MagnesiumConcentration")
  Aniso (Poisson direction(SimulationSystem)=xAxis)
}

Physics (MaterialInterface="AlGaN/GaN") {
  PiezoElectric_Polarization(activation=1.0)
  Thermionic
}

Math {
  Method = ILS(set=25)
  Digits = 5
  ErrRef(Electron)=1e8
  ErrRef(Hole)=1e8
  RefDens_GradQuasiFermi_ElectricField=1e12
  Extrapolate(LowDensityLimit=1e3)
  ExtendedPrecision
}

Solve {
  Coupled { Poisson }
  Coupled { Poisson Electron Hole }
  Quasistationary(
    InitialStep=1e-3 MinStep=1e-6 MaxStep=0.05
    Goal { Name="Gate" Voltage=5.0 }
  ) {
    Coupled { Poisson Electron Hole }
  }
}
`,
  },

  "Windowed p-GaN HEMT - SDE 显式结构 (Thin-Long pGaN)": {
    id: "windowed-pgan-hemt-sde",
    suggestedFileName: "windowed_pgan_hemt_sde.cmd",
    content: `; Windowed p-GaN HEMT SDE (2D) - Explicit Geometry
; 目标: 显式构建 SiN 开窗、薄且长 p-GaN、Source/Drain/Gate 金属，并与 SDevice 接触命名对齐。
; 单位默认 um。

(sde:clear)
(sde:set-process-up-direction "+z")

; ---------- Lateral dimensions ----------
(define Ls   0.50)
(define Lsg  0.80)
(define Lg   0.80)
(define Lgd  4.20)
(define Ld   0.50)
(define Xmax (+ Ls Lsg Lg Lgd Ld))

; ---------- Vertical thickness ----------
(define Tsub   2.00)
(define Tbuf   2.50)
(define Tch    0.30)
(define Tbar   0.02)
(define Tpg    0.015)  ; 薄 p-GaN, 15 nm
(define Tsin   0.06)
(define Tmetal 0.25)

(define ySubTop Tsub)
(define yBufTop (+ ySubTop Tbuf))
(define yChTop  (+ yBufTop Tch))
(define yBarTop (+ yChTop Tbar))
(define yPgTop  (+ yBarTop Tpg))
(define ySinTop (+ yBarTop Tsin))
(define yMetTop (+ ySinTop Tmetal))

; ---------- Thin-long p-GaN window ----------
(define xPgStart (+ Ls 0.20))
(define Lpg      3.40)          ; 长 p-GaN
(define xPgEnd   (+ xPgStart Lpg))

; Gate metal shorter than p-GaN, centered in window
(define xGateStart (+ Ls Lsg))
(define xGateEnd   (+ xGateStart Lg))

; ---------- Regions ----------
(sdegeo:create-rectangle (position 0.0 0.0 0.0) (position Xmax ySubTop 0.0) "Silicon" "R.Substrate")
(sdegeo:create-rectangle (position 0.0 ySubTop 0.0) (position Xmax yBufTop 0.0) "GaN" "R.Buffer")
(sdegeo:create-rectangle (position 0.0 yBufTop 0.0) (position Xmax yChTop 0.0) "GaN" "R.Channel")
(sdegeo:create-rectangle (position 0.0 yChTop 0.0) (position Xmax yBarTop 0.0) "AlGaN" "R.Barrier")

; thin-long p-GaN on barrier
(sdegeo:create-rectangle (position xPgStart yBarTop 0.0) (position xPgEnd yPgTop 0.0) "GaN" "R.pGate")

; SiN passivation with gate window
(sdegeo:create-rectangle (position 0.0 yBarTop 0.0) (position xPgStart ySinTop 0.0) "Nitride" "R.SiN_left")
(sdegeo:create-rectangle (position xPgEnd yBarTop 0.0) (position Xmax ySinTop 0.0) "Nitride" "R.SiN_right")

; source / drain metals
(sdegeo:create-rectangle (position 0.0 yBarTop 0.0) (position Ls yMetTop 0.0) "Aluminum" "R.SourceMetal")
(sdegeo:create-rectangle (position (- Xmax Ld) yBarTop 0.0) (position Xmax yMetTop 0.0) "Aluminum" "R.DrainMetal")

; gate metal in window
(sdegeo:create-rectangle (position xGateStart yPgTop 0.0) (position xGateEnd yMetTop 0.0) "Nickel" "R.GateMetal")

; ---------- Contacts (names aligned to SDevice) ----------
(sdegeo:define-contact-set "Source" 4 (color:rgb 1 0 0) "##")
(sdegeo:define-contact-set "Drain" 4 (color:rgb 0 1 0) "##")
(sdegeo:define-contact-set "Gate" 4 (color:rgb 0 0 1) "##")
(sdegeo:define-contact-set "Backside" 4 (color:rgb 0.6 0.6 0.6) "##")

(sdegeo:set-contact (find-edge-id (position (* 0.5 Ls) yMetTop 0.0)) "Source")
(sdegeo:set-contact (find-edge-id (position (+ (- Xmax Ld) (* 0.5 Ld)) yMetTop 0.0)) "Drain")
(sdegeo:set-contact (find-edge-id (position (+ xGateStart (* 0.5 Lg)) yMetTop 0.0)) "Gate")
(sdegeo:set-contact (find-edge-id (position (* 0.5 Xmax) 0.0 0.0)) "Backside")

; ---------- Example dopings (tune as needed) ----------
; Channel / buffer are placeholders for first-run stability, please calibrate.
(sdedr:define-constant-profile "Prof.Nch" "SiliconActiveConcentration" 1e15)
(sdedr:define-constant-profile-region "Place.Nch" "Prof.Nch" "R.Channel")

(sdedr:define-constant-profile "Prof.SD" "SiliconActiveConcentration" 2e20)
(sdedr:define-constant-profile-region "Place.SDsrc" "Prof.SD" "R.SourceMetal")
(sdedr:define-constant-profile-region "Place.SDdrn" "Prof.SD" "R.DrainMetal")

(sdedr:define-constant-profile "Prof.pGate" "MagnesiumConcentration" 5e19)
(sdedr:define-constant-profile-region "Place.pGate" "Prof.pGate" "R.pGate")

; ---------- Save ----------
(sde:save-model "windowed_pgan_hemt_sde")
`,
  },

  "Windowed p-GaN HEMT - SDevice IdVg (Vd=1V, Vg 0->6, step 0.05)": {
    id: "windowed-pgan-hemt-sdevice-idvg",
    suggestedFileName: "windowed_pgan_hemt_idvg_des.cmd",
    content: `# Windowed p-GaN HEMT SDevice IdVg
# Default bias requested:
#   Vd = 1.0 V
#   Vg: 0 -> 6 V, step ~0.05 V

#define _Eqs_ Poisson Electron Hole

File {
  Grid      = "@tdr@"
  Parameter = "@parameter@"
  Current   = "@plot@"
  Plot      = "@tdrdat@"
  Output    = "@log@"
  Piezo     = "@tdr@"
}

Electrode {
  { Name="Source"   Voltage=0.0 }
  { Name="Drain"    Voltage=0.0 }
  { Name="Gate"     Voltage=0.0 Schottky Workfunction=5.8 }
  { Name="Backside" Voltage=0.0 }
}

Physics {
  Temperature = 300
  AreaFactor  = 1e3
  Fermi
  Thermionic
  DefaultParametersFromFile
  EffectiveIntrinsicDensity(NoBandGapNarrowing)

  Mobility (
    DopingDependence
    HighFieldSaturation
  )

  Recombination (
    SRH
    Radiative
  )

  Aniso (Poisson direction(SimulationSystem)=xAxis)
  IncompleteIonization(Dopants="MagnesiumConcentration")
}

Physics (Region="R.Channel") {
  Mobility (HighFieldSaturation(DensityDependentVsat))
}

# AlGaN/Nitride interface baseline (passivation-related)
Physics (MaterialInterface="AlGaN/Nitride") {
  Traps (
    (Donor Level Conc=3e13 EnergyMid=0.37 eXsection=1e-14 hXsection=1e-14)
  )
  Piezoelectric_Polarization(activation=0.0)
}

# Main polarization interface
Physics (MaterialInterface="AlGaN/GaN") {
  Piezoelectric_Polarization(activation=1.0)
  Thermionic
}

Math {
  Iterations = 80
  Digits = 5
  ErrRef(Electron)=1e8
  ErrRef(Hole)=1e8
  RHSMin=1e-10

  Method=ILS(set=25)
  ILSrc="set(25) {
    iterative (gmres(150), tolrel=1e-10, tolunprec=1e-4, maxit=300);
    preconditioning (ilut(6e-06,-1),left);
    ordering (symmetric=nd, nonsymmetric=mpsilst);
    options(verbose=0, refineresidual=10);
  };"

  RefDens_GradQuasiFermi_ElectricField=1e12
  Extrapolate(LowDensityLimit=1e3)
  ExtendedPrecision(80)
  TensorGridAniso(aniso)
}

Solve {
  Coupled (Iterations=100 LineSearchDamping=1e-4 CheckRhsAfterUpdate) { Poisson }
  Coupled (Iterations=100 LineSearchDamping=1e-3 CheckRhsAfterUpdate) { _Eqs_ }

  # Step-1: ramp drain to 1V (gate stays 0V)
  Quasistationary(
    InitialStep=1e-3 MinStep=1e-6 MaxStep=0.02
    Goal { Name="Drain" Voltage=1.0 }
  ) { Coupled { _Eqs_ } }

  # Step-2: IdVg sweep, approximately fixed 0.05V step
  NewCurrentPrefix="IdVg_"
  Quasistationary(
    InitialStep=0.05 MinStep=1e-4 MaxStep=0.05
    Goal { Name="Gate" Voltage=6.0 }
  ) { Coupled { _Eqs_ } }
}
`,
  },
};

function listTemplateNames() {
  return Object.keys(TEMPLATE_LIBRARY);
}

function getTemplateByName(name) {
  return TEMPLATE_LIBRARY[name] || null;
}

module.exports = {
  listTemplateNames,
  getTemplateByName,
};
