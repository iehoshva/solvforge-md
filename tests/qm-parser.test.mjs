import assert from "node:assert/strict"
import test from "node:test"
import { parseGeometryFile, parseQmOutput } from "../lib/workbench/qm-parser.ts"

const orcaMultiScheme = `
                                 *****************
                                 * O   R   C   A *
                                 *****************
|  1> ! wB97X-D3 def2-TZVPP TightSCF CHELPG HIRSHFELD
|  2> * xyz 0 1

CARTESIAN COORDINATES (ANGSTROEM)
---------------------------------
  O      0.000000    0.000000    0.117300
  H      0.000000    0.757200   -0.469200
  H      0.000000   -0.757200   -0.469200

MULLIKEN ATOMIC CHARGES
-----------------------
   0 O :   -0.520000
   1 H :    0.260000
   2 H :    0.260000
Sum of atomic charges:    0.000000

LOEWDIN ATOMIC CHARGES
----------------------
   0 O :   -0.410000
   1 H :    0.205000
   2 H :    0.205000

HIRSHFELD ANALYSIS
------------------
   0 O   -0.310000    0.000000
   1 H    0.155000    0.000000
   2 H    0.155000    0.000000

CHELPG Charges
--------------------------------
   0   O   :  -0.740000
   1   H   :   0.370000
   2   H   :   0.370000
Total charge:   0.000000

****ORCA TERMINATED NORMALLY****
`

const gaussianLog = `
 Entering Gaussian System, Link 0=g16
 #p B3LYP/6-311++G(d,p) opt pop=(chelpg,npa,hirshfeld)
 Charge =  0 Multiplicity = 1
                         Standard orientation:
 ---------------------------------------------------------------------
 Center     Atomic      Atomic             Coordinates (Angstroms)
 Number     Number       Type             X           Y           Z
 ---------------------------------------------------------------------
      1          8           0        0.000000    0.000000    0.110000
      2          1           0        0.000000    0.760000   -0.470000
      3          1           0        0.000000   -0.760000   -0.470000
 ---------------------------------------------------------------------
 Mulliken charges:
               1
     1  O   -0.580000
     2  H    0.290000
     3  H    0.290000
 Sum of Mulliken charges =   0.00000
 ESP charges:
               1
     1  O   -0.720000
     2  H    0.360000
     3  H    0.360000
 Sum of ESP charges =   0.00000
 Summary of Natural Population Analysis:
 Atom  No    Charge         Core      Valence    Rydberg      Total
   O    1   -0.91000      1.99980     6.89000    0.02020     8.91000
   H    2    0.45500      0.00000     0.54300    0.00200     0.54500
   H    3    0.45500      0.00000     0.54300    0.00200     0.54500
 =====================================================================
 Hirshfeld charges, spin densities, dipoles, and CM5 charges using IRadAn=      5:
              Q-H     S-H     Dx        Dy        Dz     Q-CM5
     1  O  -0.3200  0.0000  0.0000    0.0000   -0.1000  -0.6400
     2  H   0.1600  0.0000  0.0000    0.0500    0.0500   0.3200
     3  H   0.1600  0.0000  0.0000   -0.0500    0.0500   0.3200
               Tot  0.0000
 Normal termination of Gaussian 16.
`

const gaussianFchk = `Water fchk
SP                                        RWB97XD             Def2TZVP
Charge                                     I                0
Multiplicity                               I                1
Atomic numbers                             I   N=           3
           8           1           1
Current cartesian coordinates              R   N=           9
  0.00000000E+00  0.00000000E+00  2.00000000E-01  0.00000000E+00  1.43000000E+00
 -8.80000000E-01  0.00000000E+00 -1.43000000E+00 -8.80000000E-01
Mulliken Charges                           R   N=           3
 -6.00000000E-01  3.00000000E-01  3.00000000E-01
ESP Charges                                R   N=           3
 -7.60000000E-01  3.80000000E-01  3.80000000E-01
`

const xtbOut = `
      -----------------------------------------------------------
     |                     x T B                                 |
      -----------------------------------------------------------
  program call               : xtb water.xyz --opt --gfn 2
  total charge               : 0
  GFN2-xTB
    #   Z          covCN         q      C6AA      α(0)
    1   8 O        1.850   -0.5700    12.345     5.123
    2   1 H        0.920    0.2850     2.345     2.123
    3   1 H        0.920    0.2850     2.345     2.123
 normal termination of xtb
`

const multiwfnChg = `O   0.000000   0.000000   0.117300  -0.834000
H   0.000000   0.757200  -0.469200   0.417000
H   0.000000  -0.757200  -0.469200   0.417000
`

const mol2Text = `@<TRIPOS>MOLECULE
water
 3 2 0 0 0
SMALL
USER_CHARGES
@<TRIPOS>ATOM
      1 O1          0.0000    0.0000    0.1173 O.3       1 WAT       -0.8000
      2 H1          0.0000    0.7572   -0.4692 H         1 WAT        0.4000
      3 H2          0.0000   -0.7572   -0.4692 H         1 WAT        0.4000
@<TRIPOS>BOND
     1     1     2 1
     2     1     3 1
`

test("ORCA parser dynamically detects arbitrary method/basis and all charge schemes", () => {
  const parsed = parseQmOutput(orcaMultiScheme, "water.out")
  assert.equal(parsed.software, "orca")
  assert.equal(parsed.method, "wB97X-D3")
  assert.equal(parsed.basis, "def2-TZVPP")
  assert.equal(parsed.terminatedNormally, true)
  assert.equal(parsed.parsedTotalCharge, 0)
  assert.equal(parsed.multiplicity, 1)
  assert.equal(parsed.coordinates.length, 3)
  assert.deepEqual(parsed.availableSchemes.sort(), ["CHELPG", "Hirshfeld", "Loewdin", "Mulliken"])
  assert.equal(parsed.defaultScheme, "CHELPG")
  assert.equal(parsed.chargeSets.CHELPG[0].charge, -0.74)
  assert.equal(parsed.chargeSets.Hirshfeld[0].charge, -0.31)
  assert.equal(parsed.chargeSets.Loewdin[0].charge, -0.41)
  assert.equal(parsed.chargeSets.Mulliken[0].charge, -0.52)
})

test("Gaussian .log parser extracts coordinates, route metadata, and Mulliken/ESP/NPA/Hirshfeld/CM5", () => {
  const parsed = parseQmOutput(gaussianLog, "water.log")
  assert.equal(parsed.software, "gaussian")
  assert.equal(parsed.method, "B3LYP")
  assert.equal(parsed.basis, "6-311++G(d,p)")
  assert.equal(parsed.terminatedNormally, true)
  assert.equal(parsed.coordinates.length, 3)
  assert.equal(parsed.coordinates[0].element, "O")
  assert.deepEqual(parsed.availableSchemes.sort(), ["CM5", "ESP", "Hirshfeld", "Mulliken", "NPA"])
  assert.equal(parsed.chargeSets.ESP[0].charge, -0.72)
  assert.equal(parsed.chargeSets.NPA[0].charge, -0.91)
  assert.equal(parsed.chargeSets.CM5[0].charge, -0.64)
})

test("Gaussian .fchk parser converts Bohr coordinates to Angstrom and reads ESP/Mulliken", () => {
  const parsed = parseQmOutput(gaussianFchk, "water.fchk")
  assert.equal(parsed.software, "gaussian-fchk")
  assert.equal(parsed.method, "RWB97XD")
  assert.equal(parsed.basis, "Def2TZVP")
  assert.equal(parsed.coordinates.length, 3)
  assert.ok(Math.abs(parsed.coordinates[0].z - 0.2 * 0.529177210903) < 1e-8)
  assert.deepEqual(parsed.availableSchemes.sort(), ["ESP", "Mulliken"])
  assert.equal(parsed.chargeSets.ESP[0].charge, -0.76)
})

test("xTB, Multiwfn .chg, MOL2, and CSV charge parsers all work seamlessly", () => {
  const xtb = parseQmOutput(xtbOut, "xtb.out")
  assert.equal(xtb.software, "xtb")
  assert.equal(xtb.chargeSets.xTB[0].charge, -0.57)
  assert.equal(xtb.terminatedNormally, true)

  const chg = parseQmOutput(multiwfnChg, "resp.chg")
  assert.equal(chg.software, "multiwfn")
  assert.equal(chg.coordinates.length, 3)
  assert.equal(chg.chargeSets["Multiwfn (.chg)"][0].charge, -0.834)

  const mol2 = parseQmOutput(mol2Text, "water.mol2")
  assert.equal(mol2.software, "mol2")
  assert.equal(mol2.bonds?.length, 2)
  assert.equal(mol2.chargeSets.MOL2[0].charge, -0.8)

  const csvParsed = parseQmOutput("index,element,charge\n1,O,-0.82\n2,H,0.41\n3,H,0.41\n", "custom_charges.csv")
  assert.equal(csvParsed.software, "csv-table")
  assert.equal(csvParsed.chargeSets["Custom table"][0].charge, -0.82)
})

test("Geometry parser supports XYZ, PDB, GRO (nm -> Angstrom), and MOL2", () => {
  const gro = `Water\n2\n    1SOL     O1    1   0.000   0.000   0.000\n    1SOL     H1    2   0.100   0.000   0.000\n   1.00000   1.00000   1.00000\n`
  const parsedGro = parseGeometryFile(gro, "water.gro")
  assert.equal(parsedGro.format, "gro")
  assert.equal(parsedGro.atoms[1].x, 1.0) // 0.1 nm -> 1.0 Angstrom

  const parsedMol2 = parseGeometryFile(mol2Text, "water.mol2")
  assert.equal(parsedMol2.format, "mol2")
  assert.equal(parsedMol2.bonds?.length, 2)
})
