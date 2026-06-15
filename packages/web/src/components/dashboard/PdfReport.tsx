import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { fmtNumber } from "@trs/engine";
import type { TrsMetrics, DailyTrs, ProductTrs, SixBigLoss } from "@/lib/api";

const s = StyleSheet.create({
  page: { padding: 30, fontSize: 9, fontFamily: "Helvetica" },
  header: { fontSize: 16, fontWeight: "bold", marginBottom: 4 },
  subheader: { fontSize: 10, color: "#666", marginBottom: 12 },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: "bold", marginBottom: 4, borderBottomWidth: 1, borderBottomColor: "#ddd", paddingBottom: 2 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#eee", paddingVertical: 2 },
  headerRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#333", paddingVertical: 3, fontWeight: "bold", backgroundColor: "#f3f4f6" },
  cell: { flex: 1, textAlign: "right", paddingHorizontal: 2 },
  cellLeft: { flex: 2, textAlign: "left", paddingHorizontal: 2, flexWrap: "wrap" },
  kpiRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  kpiCard: { flex: 1, borderWidth: 1, borderColor: "#ddd", borderRadius: 4, padding: 6, alignItems: "center" },
  kpiLabel: { fontSize: 8, color: "#666", marginBottom: 2 },
  kpiValue: { fontSize: 14, fontWeight: "bold" },
  footer: { position: "absolute", bottom: 20, left: 30, right: 30, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#999" },
  normeNote: { fontSize: 7, color: "#888", marginTop: 4, fontStyle: "italic" },
});

function pct(v: number): string { return `${(v * 100).toFixed(1)}%`; }
function dur(min: number): string {
  if (min === 0) return "0 min";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}

interface Props {
  total: TrsMetrics;
  daily: DailyTrs[];
  equipmentName: string;
  equipmentCode?: string;
  from: string;
  to: string;
  byProduct?: ProductTrs[];
  sixLosses?: SixBigLoss[];
}

export default function PdfReport({ total, daily, equipmentName, equipmentCode, from, to, byProduct, sixLosses }: Props) {
  const equip = equipmentCode ? `${equipmentName} (${equipmentCode})` : equipmentName;
  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <Text style={s.header}>Rapport TRS — {equip}</Text>
        <Text style={s.subheader}>Période : {from} → {to} | Généré le {new Date().toLocaleDateString("fr-FR")}</Text>

        {/* KPI Cards */}
        <View style={s.kpiRow}>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>TRS</Text>
            <Text style={[s.kpiValue, { color: total.TRS >= 0.75 ? "#22c55e" : total.TRS >= 0.55 ? "#f97316" : "#ef4444" }]}>{pct(total.TRS)}</Text>
          </View>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>DO</Text>
            <Text style={s.kpiValue}>{pct(total.DO)}</Text>
          </View>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>TP</Text>
            <Text style={s.kpiValue}>{pct(total.TP)}</Text>
          </View>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>TQ</Text>
            <Text style={s.kpiValue}>{pct(total.TQ)}</Text>
          </View>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>TRG</Text>
            <Text style={s.kpiValue}>{pct(total.TRG)}</Text>
          </View>
        </View>

        {/* Time Buckets */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Décomposition NF E 60-182</Text>
          <View style={s.headerRow}>
            <Text style={s.cellLeft}>Indicateur</Text>
            <Text style={s.cell}>Durée</Text>
            <Text style={s.cell}>% de tT</Text>
          </View>
          {[
            ["tT (Temps total 24h)", dur(total.tT), "100 %"],
            ["  Fermeture", dur(total.fermeture), `${((total.fermeture / total.tT) * 100).toFixed(1)} %`],
            ["tO (Ouverture)", dur(total.tO), `${((total.tO / total.tT) * 100).toFixed(1)} %`],
            ["  tAP (Arrêts planifiés)", dur(total.tAP), `${((total.tAP / total.tT) * 100).toFixed(1)} %`],
            ["tR (Temps requis)", dur(Math.round(total.tR)), `${((total.tR / total.tT) * 100).toFixed(1)} %`],
            ["  Arrêts non planifiés", dur(total.totalUnplannedMin), `${((total.totalUnplannedMin / total.tT) * 100).toFixed(1)} %`],
            ["tF (Fonctionnement)", dur(Math.round(total.tF)), `${((total.tF / total.tT) * 100).toFixed(1)} %`],
            ["tN (Nominal)", dur(Math.round(total.tN)), `${((total.tN / total.tT) * 100).toFixed(1)} %`],
            ["tU (Utile / Valeur ajoutée)", dur(Math.round(total.tU)), `${((total.tU / total.tT) * 100).toFixed(1)} %`],
          ].map(([label, duration, pctOfTT], i) => (
            <View key={i} style={s.row}>
              <Text style={s.cellLeft}>{label}</Text>
              <Text style={s.cell}>{duration}</Text>
              <Text style={s.cell}>{pctOfTT}</Text>
            </View>
          ))}
          <View style={s.row}>
            <Text style={[s.cellLeft, { fontWeight: "bold" }]}>Lots / NPR / NPB / NPC</Text>
            <Text style={s.cell}>{total.lotCount}</Text>
            <Text style={s.cell}>{fmtNumber(total.totalProduced)} / {fmtNumber(total.totalConforming)} / {fmtNumber(total.totalRebut)}</Text>
          </View>
        </View>

        {/* Daily breakdown */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Détail journalier ({daily.length} jour(s))</Text>
          <View style={s.headerRow}>
            <Text style={s.cellLeft}>Date</Text>
            <Text style={s.cell}>Lots</Text>
            <Text style={s.cell}>NPR</Text>
            <Text style={s.cell}>tR</Text>
            <Text style={s.cell}>DO</Text>
            <Text style={s.cell}>TP</Text>
            <Text style={s.cell}>TQ</Text>
            <Text style={s.cell}>TRS</Text>
          </View>
          {daily.map((d, i) => (
            <View key={i} wrap={false}>
              <View style={s.row}>
                <Text style={s.cellLeft}>{d.date}</Text>
                <Text style={s.cell}>{d.lotCount}</Text>
                <Text style={s.cell}>{fmtNumber(d.totalProduced)}</Text>
                <Text style={s.cell}>{dur(Math.round(d.tR))}</Text>
                <Text style={s.cell}>{pct(d.DO)}</Text>
                <Text style={s.cell}>{pct(d.TP)}</Text>
                <Text style={s.cell}>{pct(d.TQ)}</Text>
                <Text style={s.cell}>{pct(d.TRS)}</Text>
              </View>
              {d.notes && (
                <View style={{ paddingLeft: 8, paddingBottom: 2 }}>
                  <Text style={{ fontSize: 7, color: "#6b7280", fontStyle: "italic" }}>📝 {d.notes}</Text>
                </View>
              )}
            </View>
          ))}
          {/* Total row */}
          <View style={[s.row, { fontWeight: "bold", borderTopWidth: 1, borderTopColor: "#333" }]}>
            <Text style={[s.cellLeft, { fontWeight: "bold" }]}>TOTAL</Text>
            <Text style={[s.cell, { fontWeight: "bold" }]}>{total.lotCount}</Text>
            <Text style={[s.cell, { fontWeight: "bold" }]}>{fmtNumber(total.totalProduced)}</Text>
            <Text style={[s.cell, { fontWeight: "bold" }]}>{dur(Math.round(total.tR))}</Text>
            <Text style={[s.cell, { fontWeight: "bold" }]}>{pct(total.DO)}</Text>
            <Text style={[s.cell, { fontWeight: "bold" }]}>{pct(total.TP)}</Text>
            <Text style={[s.cell, { fontWeight: "bold" }]}>{pct(total.TQ)}</Text>
            <Text style={[s.cell, { fontWeight: "bold" }]}>{pct(total.TRS)}</Text>
          </View>
        </View>

        {/* By Product (if available) */}
        {byProduct && byProduct.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>TRS par produit ({byProduct.length} produit(s))</Text>
            <View style={s.headerRow}>
              <Text style={s.cellLeft}>Produit</Text>
              <Text style={s.cell}>Lots</Text>
              <Text style={s.cell}>NPR</Text>
              <Text style={s.cell}>NPC</Text>
              <Text style={s.cell}>DO</Text>
              <Text style={s.cell}>TP</Text>
              <Text style={s.cell}>TQ</Text>
              <Text style={s.cell}>TRS</Text>
            </View>
            {byProduct.map((p, i) => (
              <View key={i} style={s.row}>
                <Text style={s.cellLeft}>{p.productName}</Text>
                <Text style={s.cell}>{p.lotCount}</Text>
                <Text style={s.cell}>{fmtNumber(p.totalProduced)}</Text>
                <Text style={s.cell}>{fmtNumber(p.totalRebut)}</Text>
                <Text style={s.cell}>{pct(p.DO)}</Text>
                <Text style={s.cell}>{pct(p.TP)}</Text>
                <Text style={s.cell}>{pct(p.TQ)}</Text>
                <Text style={s.cell}>{pct(p.TRS)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Six Big Losses (if available) */}
        {sixLosses && sixLosses.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>6 Grandes Pertes (Nakajima/TPM)</Text>
            <View style={s.headerRow}>
              <Text style={s.cellLeft}>Perte</Text>
              <Text style={s.cell}>Composante</Text>
              <Text style={s.cell}>Durée</Text>
              <Text style={s.cell}>% tT</Text>
            </View>
            {sixLosses.map((l, i) => (
              <View key={i} style={s.row}>
                <Text style={s.cellLeft}>{l.label}</Text>
                <Text style={s.cell}>{l.oeeComponent === "availability" ? "DO" : l.oeeComponent === "performance" ? "TP" : "TQ"}</Text>
                <Text style={s.cell}>{dur(l.minutes)}</Text>
                <Text style={s.cell}>{l.pctOfTotal.toFixed(1)}%</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={s.normeNote}>Calculs conformes NF E 60-182 — TRS = DO × TP × TQ = tU/tR</Text>

        {/* GMP Signature block */}
        <View style={{ marginTop: 20, borderTopWidth: 1, borderTopColor: "#ccc", paddingTop: 10 }}>
          <Text style={{ fontSize: 9, fontWeight: "bold", marginBottom: 8 }}>Signatures — Confidentiel</Text>
          <View style={{ flexDirection: "row", gap: 24 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 8, color: "#555", marginBottom: 2 }}>Rédigé par :</Text>
              <View style={{ borderBottomWidth: 0.5, borderBottomColor: "#333", height: 20, marginBottom: 2 }} />
              <Text style={{ fontSize: 7, color: "#888" }}>Nom / Date</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 8, color: "#555", marginBottom: 2 }}>Vérifié par :</Text>
              <View style={{ borderBottomWidth: 0.5, borderBottomColor: "#333", height: 20, marginBottom: 2 }} />
              <Text style={{ fontSize: 7, color: "#888" }}>Nom / Date</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 8, color: "#555", marginBottom: 2 }}>Approuvé par :</Text>
              <View style={{ borderBottomWidth: 0.5, borderBottomColor: "#333", height: 20, marginBottom: 2 }} />
              <Text style={{ fontSize: 7, color: "#888" }}>Nom / Date</Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text>TRS Compteur — DPI</Text>
          <Text>Confidentiel — Usage interne uniquement</Text>
        </View>
      </Page>
    </Document>
  );
}
