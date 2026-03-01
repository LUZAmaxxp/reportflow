/**
 * Generates 3 minimal but realistic mock ESG PDF documents for demo.
 *
 * Design:
 *  - Light: 1–2 pages each, concise tables, minimal prose
 *  - Complete: covers E, S, G pillars the extraction pipeline expects
 *  - Conflict-ready: Doc 1 & Doc 3 both report 2025 GHG / renewable share
 *    with slight discrepancies to trigger conflict detection in the demo
 *    (GHG total: 65 970 vs 66 200 | renewable: 42% vs 43%)
 *  - French ESG vocabulary matches the sparse keyword bag
 *
 * Run: npx tsx scripts/mock-data/generate-esg-pdfs.ts
 */
import PDFDocument from "pdfkit";
import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = path.join(__dirname, "output");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Use LiberationSans (ships with pdfjs-dist) for reliable French accent rendering.
// pdfkit's built-in Helvetica uses WinAnsiEncoding which can produce garbled text
// when rasterized by pdfjs-dist → PaddleOCR.
const FONT_DIR = path.join(__dirname, "..", "..", "node_modules", "pdfjs-dist", "standard_fonts");
const FONT_REGULAR = path.join(FONT_DIR, "LiberationSans-Regular.ttf");
const FONT_BOLD = path.join(FONT_DIR, "LiberationSans-Bold.ttf");

// ─── Helpers ────────────────────────────────────────────────────────

function createDoc(filename: string): { doc: PDFKit.PDFDocument; finish: () => void } {
  const filePath = path.join(OUTPUT_DIR, filename);
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: filename } });
  // Register embedded TTF fonts
  doc.registerFont("Sans", FONT_REGULAR);
  doc.registerFont("Sans-Bold", FONT_BOLD);
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);
  return {
    doc,
    finish: () => {
      doc.end();
      stream.on("finish", () => console.log(`  ✓ ${filePath}`));
    },
  };
}

function title(doc: PDFKit.PDFDocument, text: string) {
  doc.fontSize(20).font("Sans-Bold").text(text, { align: "center" });
  doc.moveDown(0.4);
}

function subtitle(doc: PDFKit.PDFDocument, text: string) {
  doc.fontSize(14).font("Sans-Bold").text(text);
  doc.moveDown(0.2);
}

function body(doc: PDFKit.PDFDocument, text: string) {
  doc.fontSize(10).font("Sans").text(text, { lineGap: 2 });
  doc.moveDown(0.3);
}

/**
 * Draws a full bordered table with header row and data rows.
 * Each cell is a rect with text rendered inside — reliable across all fonts.
 */
function drawTable(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  colWidths: number[],
  options?: { headerBg?: string; stripeBg?: string }
) {
  const ROW_H = 20;
  const PAD = 4;
  const x0 = 50;
  const headerBg = options?.headerBg ?? "#2d5c3e";
  const stripeBg = options?.stripeBg ?? "#f4f8f5";
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);

  // Ensure table fits on page; if not, add a page
  const totalHeight = (1 + rows.length) * ROW_H + 4;
  if (doc.y + totalHeight > doc.page.height - 50) {
    doc.addPage();
  }

  // ── Header row ──
  let y = doc.y;
  doc.rect(x0, y, tableWidth, ROW_H).fill(headerBg);
  doc.fontSize(8).font("Sans-Bold").fillColor("#ffffff");
  let xOff = 0;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], x0 + xOff + PAD, y + 5, {
      width: colWidths[i] - PAD * 2,
      height: ROW_H,
      align: i === 0 ? "left" : "right",
      lineBreak: false,
    });
    xOff += colWidths[i];
  }

  // ── Data rows ──
  doc.fillColor("#000000");
  for (let r = 0; r < rows.length; r++) {
    y += ROW_H;
    // Alternating stripe
    if (r % 2 === 0) {
      doc.save().rect(x0, y, tableWidth, ROW_H).fill(stripeBg).restore();
    }
    // Cell borders
    doc.save().rect(x0, y, tableWidth, ROW_H).stroke("#cccccc").restore();

    doc.fontSize(8).font("Sans").fillColor("#1a1a1a");
    xOff = 0;
    for (let i = 0; i < rows[r].length; i++) {
      doc.text(rows[r][i], x0 + xOff + PAD, y + 5, {
        width: colWidths[i] - PAD * 2,
        height: ROW_H,
        align: i === 0 ? "left" : "right",
        lineBreak: false,
      });
      xOff += colWidths[i];
    }
  }

  // Outer border
  doc.save()
    .rect(x0, doc.y, tableWidth, (1 + rows.length) * ROW_H)
    .stroke("#999999")
    .restore();

  doc.y = y + ROW_H + 8;
}

// ─── Doc 1: Rapport RSE 2025  (Environment + Social — 2 pages) ─────

function generateRSEReport() {
  const { doc, finish } = createDoc("Rapport_RSE_2025_GreenCorp.pdf");

  title(doc, "Rapport RSE 2025");
  doc.fontSize(11).font("Sans").text("GreenCorp Industries S.A.", { align: "center" });
  doc.fontSize(9).font("Sans").text("Période : 1er janvier 2025 — 31 décembre 2025", { align: "center" });
  doc.moveDown(0.8);

  // ── GHG ──
  subtitle(doc, "1. Émissions de gaz à effet de serre (GES)");
  body(doc, "Méthodologie GHG Protocol — périmètre opérationnel.");
  drawTable(doc,
    ["Catégorie", "2024 (tCO2e)", "2025 (tCO2e)", "Variation"],
    [
      ["Scope 1 — Émissions directes", "13 200", "12 450", "-5,7%"],
      ["Scope 2 — Énergie indirecte", "9 100", "8 320", "-8,6%"],
      ["Scope 3 — Chaîne de valeur", "48 500", "45 200", "-6,8%"],
      ["Total GES", "70 800", "65 970", "-6,8%"],
    ],
    [200, 95, 95, 95],
  );
  body(doc, "Intensité carbone : 0,231 tCO2e/k€ de CA (vs 0,252 en 2024). Objectif SBTi 2030 : -42% vs 2019.");

  // ── Energy ──
  subtitle(doc, "2. Consommation énergétique");
  drawTable(doc,
    ["Source", "MWh", "Part (%)"],
    [
      ["Électricité renouvelable", "65 520", "42,0%"],
      ["Gaz naturel", "52 000", "33,3%"],
      ["Électricité réseau", "28 080", "18,0%"],
      ["Fioul", "7 800", "5,0%"],
      ["Biomasse", "2 600", "1,7%"],
      ["Total", "156 000", "100%"],
    ],
    [200, 130, 130],
  );

  // ── Water ──
  subtitle(doc, "3. Eau");
  drawTable(doc,
    ["Indicateur", "Valeur", "Unité"],
    [
      ["Prélèvement total", "890 000", "m³"],
      ["Eau recyclée", "249 200", "m³"],
      ["Taux de recyclage", "28", "%"],
    ],
    [200, 130, 130],
  );

  // ── Waste ──
  subtitle(doc, "4. Déchets");
  drawTable(doc,
    ["Indicateur", "Valeur", "Unité"],
    [
      ["Déchets totaux", "2 340", "tonnes"],
      ["Taux de valorisation", "67", "%"],
      ["Déchets dangereux", "186", "tonnes"],
    ],
    [200, 130, 130],
  );

  // ── Page 2: Social ──
  doc.addPage();

  subtitle(doc, "5. Effectif et diversité");
  drawTable(doc,
    ["Indicateur", "Valeur", "Unité"],
    [
      ["Effectif total (ETP)", "1 250", "collaborateurs"],
      ["Part de femmes", "38", "%"],
      ["Femmes en postes de direction", "29", "%"],
      ["Taux de rotation", "8,2", "%"],
    ],
    [200, 130, 130],
  );

  subtitle(doc, "6. Santé et sécurité au travail");
  drawTable(doc,
    ["Indicateur", "2024", "2025"],
    [
      ["Accidents avec arrêt", "15", "12"],
      ["Taux de fréquence (TF)", "5,8", "4,6"],
      ["Taux de gravité (TG)", "0,32", "0,27"],
      ["Accidents mortels", "0", "0"],
    ],
    [200, 130, 130],
  );

  subtitle(doc, "7. Formation");
  drawTable(doc,
    ["Indicateur", "Valeur", "Unité"],
    [
      ["Heures de formation", "28 400", "heures"],
      ["Heures / collaborateur", "22,7", "h/ETP"],
      ["Budget formation", "1 420 000", "€"],
      ["Taux d'accès à la formation", "82", "%"],
    ],
    [200, 130, 130],
  );

  body(doc, "Rapport établi selon les standards GRI 2021, vérifié par Deloitte Sustainability.");

  finish();
}

// ─── Doc 2: Bilan Carbone 2024  (Detailed carbon — 1 page) ─────────

function generateBilanCarbone() {
  const { doc, finish } = createDoc("Bilan_Carbone_2024_GreenCorp.pdf");

  title(doc, "Bilan Carbone® 2024");
  doc.fontSize(11).font("Sans").text("GreenCorp Industries S.A.", { align: "center" });
  doc.fontSize(9).font("Sans").text("Méthodologie Bilan Carbone® V9 — ADEME | Périmètre opérationnel", { align: "center" });
  doc.moveDown(0.8);

  subtitle(doc, "1. Détail par poste d'émissions");
  drawTable(doc,
    ["Poste", "tCO2e", "Part (%)", "Scope"],
    [
      ["Combustion fixe", "8 450", "11,9%", "1"],
      ["Combustion mobile", "3 750", "5,3%", "1"],
      ["Émissions fugitives", "1 000", "1,4%", "1"],
      ["Total Scope 1", "13 200", "18,6%", "1"],
      ["Électricité réseau", "6 500", "9,2%", "2"],
      ["Chaleur achetée", "2 600", "3,7%", "2"],
      ["Total Scope 2", "9 100", "12,9%", "2"],
      ["Achats biens & services", "22 100", "31,2%", "3"],
      ["Fret amont", "8 900", "12,6%", "3"],
      ["Déplacements pro.", "3 200", "4,5%", "3"],
      ["Domicile-travail", "4 800", "6,8%", "3"],
      ["Déchets", "1 950", "2,8%", "3"],
      ["Utilisation produits", "5 100", "7,2%", "3"],
      ["Fin de vie produits", "2 450", "3,5%", "3"],
      ["Total Scope 3", "48 500", "68,5%", "3"],
      ["TOTAL", "70 800", "100%", "—"],
    ],
    [170, 100, 100, 100],
  );

  subtitle(doc, "2. Intensité carbone");
  drawTable(doc,
    ["Indicateur", "2023", "2024", "Variation"],
    [
      ["Intensité / CA (tCO2e/M€)", "276", "248", "-10,1%"],
      ["Intensité / ETP (tCO2e/ETP)", "60,6", "56,6", "-6,6%"],
      ["Intensité / unité (kgCO2e/u)", "3,42", "3,15", "-7,9%"],
    ],
    [170, 100, 100, 100],
  );

  body(doc, "Bilan réalisé par EcoAct, vérifié par un OTI accrédité COFRAC. Période : 1er janvier — 31 décembre 2024.");

  finish();
}

// ─── Doc 3: Rapport Annuel 2025  (Financial + ESG summary — 1 page) ─
// ⚠ Intentional discrepancies vs Doc 1 to demo conflict detection:
//   GHG total = 66 200 (Doc 1 = 65 970)  |  Renewable = 43% (Doc 1 = 42%)

function generateAnnualReport() {
  const { doc, finish } = createDoc("Rapport_Annuel_2025_GreenCorp.pdf");

  title(doc, "Rapport Annuel 2025");
  doc.fontSize(11).font("Sans").text("GreenCorp Industries S.A.", { align: "center" });
  doc.fontSize(9).font("Sans").text("Exercice clos le 31 décembre 2025", { align: "center" });
  doc.moveDown(0.8);

  subtitle(doc, "Chiffres clés financiers");
  drawTable(doc,
    ["Indicateur", "2024", "2025", "Variation"],
    [
      ["Chiffre d'affaires (M€)", "274", "285", "+4,2%"],
      ["EBITDA (M€)", "38,2", "41,5", "+8,6%"],
      ["Résultat net (M€)", "17,4", "18,5", "+6,3%"],
      ["Investissements (M€)", "22,1", "28,3", "+28,1%"],
      ["Effectif (ETP)", "1 215", "1 250", "+2,9%"],
    ],
    [200, 95, 95, 95],
  );

  subtitle(doc, "Performance ESG");
  body(doc, "Synthèse des indicateurs extra-financiers clés pour l'exercice 2025.");
  drawTable(doc,
    ["Indicateur", "2024", "2025", "Objectif 2026"],
    [
      ["Émissions GES totales (tCO2e)", "70 800", "66 200", "62 000"],
      ["Part énergie renouvelable (%)", "36", "43", "50"],
      ["Consommation eau (milliers m³)", "920", "890", "850"],
      ["Taux valorisation déchets (%)", "61", "67", "72"],
      ["Part femmes effectif (%)", "36", "38", "40"],
      ["Taux fréquence accidents", "5,8", "4,6", "4,0"],
      ["Heures formation / ETP", "20,1", "22,7", "25,0"],
    ],
    [200, 95, 95, 95],
  );

  subtitle(doc, "Gouvernance");
  drawTable(doc,
    ["Indicateur", "Valeur"],
    [
      ["Membres du conseil d'administration", "9"],
      ["Administrateurs indépendants", "4 (44%)"],
      ["Écart salarial H/F médian", "3,9%"],
      ["Collaborateurs handicapés", "4,5%"],
      ["Score EcoVadis", "72/100"],
      ["Note CDP Climate Change", "B+"],
    ],
    [300, 185],
  );

  body(doc, "Rapport validé par le Conseil d'administration du 15 mars 2026.");

  finish();
}

// ─── Run ─────────────────────────────────────────────────────────────

console.log("Generating mock ESG PDFs…\n");
generateRSEReport();
generateBilanCarbone();
generateAnnualReport();
console.log("\nDone → " + OUTPUT_DIR);
