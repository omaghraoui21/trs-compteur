import { useState, useEffect, useCallback } from "react";
import { api, type AdminRoom, type AdminEquipment, type AdminProduct, type AdminDowntimeCategory, type ProductEquipmentCadence } from "@/lib/api";
import { Settings, Building2, Cpu, Package, AlertTriangle, Plus, Pencil, Trash2, X, Check, ToggleLeft, ToggleRight, Gauge } from "lucide-react";

type Tab = "rooms" | "equipments" | "products" | "downtimes" | "cadences";

const TABS: { key: Tab; label: string; icon: typeof Building2 }[] = [
  { key: "rooms", label: "Locaux", icon: Building2 },
  { key: "equipments", label: "Équipements", icon: Cpu },
  { key: "products", label: "Produits", icon: Package },
  { key: "cadences", label: "Cadences", icon: Gauge },
  { key: "downtimes", label: "Arrêts", icon: AlertTriangle },
];

const FAMILLES = [
  "Panne équipement",
  "Intervention maintenance",
  "Attente et transition",
  "Utilités",
  "Contrôle qualité",
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>("rooms");

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="h-6 w-6 text-blue-700" />
        <h1 className="text-2xl font-bold text-gray-800">Configuration</h1>
      </div>

      <div className="flex overflow-x-auto border-b mb-6 -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition ${
              activeTab === tab.key
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "rooms" && <RoomsPanel />}
      {activeTab === "equipments" && <EquipmentsPanel />}
      {activeTab === "products" && <ProductsPanel />}
      {activeTab === "cadences" && <CadencesPanel />}
      {activeTab === "downtimes" && <DowntimesPanel />}
    </div>
  );
}

// ─── Rooms Panel ──────────────────────────────────────────

function RoomsPanel() {
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", name: "", description: "" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setRooms(await api.admin.listRooms()); } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setForm({ code: "", name: "", description: "" }); setShowForm(false); setEditingId(null); setError(""); };

  const startEdit = (r: AdminRoom) => {
    setForm({ code: r.code, name: r.name, description: r.description || "" });
    setEditingId(r.id); setShowForm(true);
  };

  const save = async () => {
    setError("");
    try {
      if (editingId) {
        await api.admin.updateRoom(editingId, form);
      } else {
        await api.admin.createRoom(form);
      }
      resetForm(); load();
    } catch (e: any) { setError(e.message); }
  };

  const remove = async (id: string) => {
    if (!confirm("Désactiver ce local ?")) return;
    try { await api.admin.deleteRoom(id); load(); } catch (e: any) { setError(e.message); }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">{rooms.length} locaux</p>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary"><Plus className="h-4 w-4" /> Ajouter</button>
      </div>

      {error && <ErrorBanner msg={error} onClose={() => setError("")} />}

      {showForm && (
        <FormCard title={editingId ? "Modifier local" : "Nouveau local"} onCancel={resetForm} onSave={save}>
          <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="LOCAL-XXX" />
          <Field label="Nom" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Nom du local" />
          <Field label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="Description (optionnel)" />
        </FormCard>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-gray-500"><th className="py-2 px-3">Code</th><th className="py-2 px-3">Nom</th><th className="py-2 px-3">Description</th><th className="py-2 px-3">Statut</th><th className="py-2 px-3 w-24">Actions</th></tr></thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id} className={`border-b hover:bg-gray-50 ${!r.isActive ? "opacity-50" : ""}`}>
                <td className="py-2 px-3 font-mono text-xs">{r.code}</td>
                <td className="py-2 px-3 font-medium">{r.name}</td>
                <td className="py-2 px-3 text-gray-500">{r.description || "—"}</td>
                <td className="py-2 px-3"><StatusBadge active={r.isActive} /></td>
                <td className="py-2 px-3">
                  <div className="flex gap-1">
                    <IconBtn icon={Pencil} onClick={() => startEdit(r)} title="Modifier" />
                    {r.isActive && <IconBtn icon={Trash2} onClick={() => remove(r.id)} title="Désactiver" className="text-red-500 hover:bg-red-50" />}
                    {!r.isActive && <IconBtn icon={Check} onClick={async () => { await api.admin.updateRoom(r.id, { isActive: true }); load(); }} title="Réactiver" className="text-green-600 hover:bg-green-50" />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Equipments Panel ──────────────────────────────────────

function EquipmentsPanel() {
  const [items, setItems] = useState<AdminEquipment[]>([]);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", name: "", roomId: "", equipmentType: "blistereuse", trsObjective: "75", defaultCadenceUnit: "u/min", microStopThresholdMin: "5" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eq, rm] = await Promise.all([api.admin.listEquipments(), api.admin.listRooms()]);
      setItems(eq); setRooms(rm.filter(r => r.isActive));
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setForm({ code: "", name: "", roomId: "", equipmentType: "blistereuse", trsObjective: "75", defaultCadenceUnit: "u/min", microStopThresholdMin: "5" }); setShowForm(false); setEditingId(null); setError(""); };

  const startEdit = (e: AdminEquipment) => {
    setForm({ code: e.code, name: e.name, roomId: e.roomId, equipmentType: e.equipmentType || "blistereuse", trsObjective: e.trsObjective, defaultCadenceUnit: e.defaultCadenceUnit, microStopThresholdMin: String(e.microStopThresholdMin ?? 5) });
    setEditingId(e.id); setShowForm(true);
  };

  const save = async () => {
    setError("");
    try {
      const val = Number(form.microStopThresholdMin); const payload = { ...form, microStopThresholdMin: isNaN(val) ? 5 : val };
      if (editingId) {
        await api.admin.updateEquipment(editingId, payload);
      } else {
        await api.admin.createEquipment(payload);
      }
      resetForm(); load();
    } catch (e: any) { setError(e.message); }
  };

  const remove = async (id: string) => {
    if (!confirm("Désactiver cet équipement ?")) return;
    try { await api.admin.deleteEquipment(id); load(); } catch (e: any) { setError(e.message); }
  };

  const roomName = (roomId: string) => rooms.find(r => r.id === roomId)?.name || roomId;

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">{items.length} équipements</p>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary"><Plus className="h-4 w-4" /> Ajouter</button>
      </div>

      {error && <ErrorBanner msg={error} onClose={() => setError("")} />}

      {showForm && (
        <FormCard title={editingId ? "Modifier équipement" : "Nouvel équipement"} onCancel={resetForm} onSave={save}>
          <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="BLI-XXX" />
          <Field label="Nom" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Nom de l'équipement" />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Local</label>
            <select value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })} className="input-field">
              <option value="">Sélectionner un local</option>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select value={form.equipmentType} onChange={(e) => setForm({ ...form, equipmentType: e.target.value })} className="input-field">
              <option value="blistereuse">Blistereuse</option>
              <option value="geluleuse">Géluleuse</option>
            </select>
          </div>
          <Field label="Objectif TRS (%)" value={form.trsObjective} onChange={(v) => setForm({ ...form, trsObjective: v })} type="number" />
          <Field label="Seuil micro-arrêts (min)" value={form.microStopThresholdMin} onChange={(v) => setForm({ ...form, microStopThresholdMin: v })} type="number" />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Unité cadence</label>
            <select value={form.defaultCadenceUnit} onChange={(e) => setForm({ ...form, defaultCadenceUnit: e.target.value })} className="input-field">
              <option value="u/min">u/min</option>
              <option value="u/h">u/h</option>
            </select>
          </div>
        </FormCard>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-gray-500"><th className="py-2 px-3">Code</th><th className="py-2 px-3">Nom</th><th className="py-2 px-3">Local</th><th className="py-2 px-3">Type</th><th className="py-2 px-3">Obj. TRS</th><th className="py-2 px-3">Micro-arrêt</th><th className="py-2 px-3">Statut</th><th className="py-2 px-3 w-24">Actions</th></tr></thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id} className={`border-b hover:bg-gray-50 ${!e.isActive ? "opacity-50" : ""}`}>
                <td className="py-2 px-3 font-mono text-xs">{e.code}</td>
                <td className="py-2 px-3 font-medium">{e.name}</td>
                <td className="py-2 px-3">{roomName(e.roomId)}</td>
                <td className="py-2 px-3 capitalize">{e.equipmentType || "—"}</td>
                <td className="py-2 px-3">{e.trsObjective}%</td>
                <td className="py-2 px-3">{e.microStopThresholdMin ?? 5} min</td>
                <td className="py-2 px-3"><StatusBadge active={e.isActive} /></td>
                <td className="py-2 px-3">
                  <div className="flex gap-1">
                    <IconBtn icon={Pencil} onClick={() => startEdit(e)} title="Modifier" />
                    {e.isActive && <IconBtn icon={Trash2} onClick={() => remove(e.id)} title="Désactiver" className="text-red-500 hover:bg-red-50" />}
                    {!e.isActive && <IconBtn icon={Check} onClick={async () => { await api.admin.updateEquipment(e.id, { isActive: true }); load(); }} title="Réactiver" className="text-green-600 hover:bg-green-50" />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Products Panel ──────────────────────────────────────

function ProductsPanel() {
  const [items, setItems] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", name: "", defaultCadence: "", cadenceUnit: "u/min", unit: "blisters" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await api.admin.listProducts()); } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setForm({ code: "", name: "", defaultCadence: "", cadenceUnit: "u/min", unit: "blisters" }); setShowForm(false); setEditingId(null); setError(""); };

  const startEdit = (p: AdminProduct) => {
    setForm({ code: p.code, name: p.name, defaultCadence: p.defaultCadence || "", cadenceUnit: p.cadenceUnit, unit: p.unit });
    setEditingId(p.id); setShowForm(true);
  };

  const save = async () => {
    setError("");
    try {
      if (editingId) {
        await api.admin.updateProduct(editingId, { ...form, defaultCadence: form.defaultCadence || undefined });
      } else {
        await api.admin.createProduct({ ...form, defaultCadence: form.defaultCadence || undefined });
      }
      resetForm(); load();
    } catch (e: any) { setError(e.message); }
  };

  const remove = async (id: string) => {
    if (!confirm("Désactiver ce produit ?")) return;
    try { await api.admin.deleteProduct(id); load(); } catch (e: any) { setError(e.message); }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">{items.length} produits</p>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary"><Plus className="h-4 w-4" /> Ajouter</button>
      </div>

      {error && <ErrorBanner msg={error} onClose={() => setError("")} />}

      {showForm && (
        <FormCard title={editingId ? "Modifier produit" : "Nouveau produit"} onCancel={resetForm} onSave={save}>
          <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="PROD-XXX" />
          <Field label="Nom" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Nom du produit" />
          <Field label="Cadence par défaut" value={form.defaultCadence} onChange={(v) => setForm({ ...form, defaultCadence: v })} type="number" placeholder="100" />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Unité cadence</label>
            <select value={form.cadenceUnit} onChange={(e) => setForm({ ...form, cadenceUnit: e.target.value })} className="input-field">
              <option value="u/min">u/min</option>
              <option value="u/h">u/h</option>
            </select>
          </div>
          <Field label="Unité produit" value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} placeholder="blisters, gélules..." />
        </FormCard>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-gray-500"><th className="py-2 px-3">Code</th><th className="py-2 px-3">Nom</th><th className="py-2 px-3">Cadence</th><th className="py-2 px-3">Unité</th><th className="py-2 px-3">Statut</th><th className="py-2 px-3 w-24">Actions</th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className={`border-b hover:bg-gray-50 ${!p.isActive ? "opacity-50" : ""}`}>
                <td className="py-2 px-3 font-mono text-xs">{p.code}</td>
                <td className="py-2 px-3 font-medium">{p.name}</td>
                <td className="py-2 px-3">{p.defaultCadence ? `${p.defaultCadence} ${p.cadenceUnit}` : "—"}</td>
                <td className="py-2 px-3">{p.unit}</td>
                <td className="py-2 px-3"><StatusBadge active={p.isActive} /></td>
                <td className="py-2 px-3">
                  <div className="flex gap-1">
                    <IconBtn icon={Pencil} onClick={() => startEdit(p)} title="Modifier" />
                    {p.isActive && <IconBtn icon={Trash2} onClick={() => remove(p.id)} title="Désactiver" className="text-red-500 hover:bg-red-50" />}
                    {!p.isActive && <IconBtn icon={Check} onClick={async () => { await api.admin.updateProduct(p.id, { isActive: true }); load(); }} title="Réactiver" className="text-green-600 hover:bg-green-50" />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Cadences Panel (Product × Equipment) ────────────────

function CadencesPanel() {
  const [cadences, setCadences] = useState<ProductEquipmentCadence[]>([]);
  const [productsList, setProductsList] = useState<AdminProduct[]>([]);
  const [equipmentsList, setEquipmentsList] = useState<AdminEquipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ productId: "", equipmentId: "", cadenceValue: "", cadenceUnit: "u/min", trsObjective: "" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p, e] = await Promise.all([api.admin.listCadences(), api.admin.listProducts(), api.admin.listEquipments()]);
      setCadences(c); setProductsList(p.filter(x => x.isActive)); setEquipmentsList(e.filter(x => x.isActive));
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setForm({ productId: "", equipmentId: "", cadenceValue: "", cadenceUnit: "u/min", trsObjective: "" }); setShowForm(false); setError(""); };

  const save = async () => {
    setError("");
    if (!form.productId || !form.equipmentId || !form.cadenceValue) { setError("Tous les champs sont requis"); return; }
    try {
      await api.admin.upsertCadence({ productId: form.productId, equipmentId: form.equipmentId, cadenceValue: Number(form.cadenceValue), cadenceUnit: form.cadenceUnit, trsObjective: form.trsObjective ? Number(form.trsObjective) : undefined });
      resetForm(); load();
    } catch (e: any) { setError(e.message); }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer cette cadence ?")) return;
    try { await api.admin.deleteCadence(id); load(); } catch (e: any) { setError(e.message); }
  };

  const productName = (id: string) => productsList.find(p => p.id === id)?.name || id;
  const equipmentName = (id: string) => equipmentsList.find(e => e.id === id)?.name || id;

  if (loading) return <Spinner />;

  // Group by equipment
  const grouped = cadences.reduce<Record<string, ProductEquipmentCadence[]>>((acc, c) => {
    const name = equipmentName(c.equipmentId);
    (acc[name] ||= []).push(c);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <p className="text-sm text-gray-500">{cadences.length} cadences configurées</p>
          <p className="text-xs text-gray-400 mt-1">Cadence théorique par couple produit × équipement. Pré-remplit automatiquement le formulaire opérateur.</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary"><Plus className="h-4 w-4" /> Ajouter</button>
      </div>

      {error && <ErrorBanner msg={error} onClose={() => setError("")} />}

      {showForm && (
        <FormCard title="Cadence produit × équipement" onCancel={resetForm} onSave={save}>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Produit</label>
            <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className="input-field">
              <option value="">Sélectionner un produit</option>
              {productsList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Équipement</label>
            <select value={form.equipmentId} onChange={(e) => setForm({ ...form, equipmentId: e.target.value })} className="input-field">
              <option value="">Sélectionner un équipement</option>
              {equipmentsList.map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
            </select>
          </div>
          <Field label="Cadence" value={form.cadenceValue} onChange={(v) => setForm({ ...form, cadenceValue: v })} type="number" placeholder="100" />
          <Field label="Objectif TRS (%) — optionnel" value={form.trsObjective} onChange={(v) => setForm({ ...form, trsObjective: v })} type="number" placeholder="85" />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Unité</label>
            <select value={form.cadenceUnit} onChange={(e) => setForm({ ...form, cadenceUnit: e.target.value })} className="input-field">
              <option value="u/min">u/min</option>
              <option value="u/h">u/h</option>
            </select>
          </div>
        </FormCard>
      )}

      {Object.entries(grouped).map(([eqName, items]) => (
        <div key={eqName} className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <Cpu className="h-4 w-4" /> {eqName}
            <span className="text-xs font-normal text-gray-400">({items.length} produits)</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-gray-500"><th className="py-2 px-3">Produit</th><th className="py-2 px-3">Cadence</th><th className="py-2 px-3">Unité</th><th className="py-2 px-3">Obj. TRS</th><th className="py-2 px-3 w-16">Action</th></tr></thead>
              <tbody>
                {items.map(c => (
                  <tr key={c.id} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-3 font-medium">{productName(c.productId)}</td>
                    <td className="py-2 px-3">{c.cadenceValue}</td>
                    <td className="py-2 px-3">{c.cadenceUnit}</td>
                    <td className="py-2 px-3">{c.trsObjective ? `${c.trsObjective}%` : "—"}</td>
                    <td className="py-2 px-3">
                      <IconBtn icon={Trash2} onClick={() => remove(c.id)} title="Supprimer" className="text-red-500 hover:bg-red-50" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {cadences.length === 0 && (
        <div className="bg-gray-50 rounded-lg p-8 text-center text-gray-400 text-sm">
          Aucune cadence configurée. Ajoutez des cadences pour pré-remplir automatiquement le formulaire opérateur.
        </div>
      )}
    </div>
  );
}

// ─── Downtimes Panel (with planned/unplanned toggle) ─────

function DowntimesPanel() {
  const [items, setItems] = useState<AdminDowntimeCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", label: "", famille: FAMILLES[0], isPlanned: false, appliesToEquipmentType: "" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await api.admin.listDowntimeCategories()); } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setForm({ code: "", label: "", famille: FAMILLES[0], isPlanned: false, appliesToEquipmentType: "" }); setShowForm(false); setEditingId(null); setError(""); };

  const startEdit = (c: AdminDowntimeCategory) => {
    setForm({ code: c.code, label: c.label, famille: c.famille, isPlanned: c.isPlanned, appliesToEquipmentType: c.appliesToEquipmentType || "" });
    setEditingId(c.id); setShowForm(true);
  };

  const save = async () => {
    setError("");
    try {
      if (editingId) {
        await api.admin.updateDowntimeCategory(editingId, { ...form, appliesToEquipmentType: form.appliesToEquipmentType || null });
      } else {
        await api.admin.createDowntimeCategory({ ...form, appliesToEquipmentType: form.appliesToEquipmentType || undefined });
      }
      resetForm(); load();
    } catch (e: any) { setError(e.message); }
  };

  const remove = async (id: string) => {
    if (!confirm("Désactiver cette catégorie ?")) return;
    try { await api.admin.deleteDowntimeCategory(id); load(); } catch (e: any) { setError(e.message); }
  };

  const togglePlanned = async (cat: AdminDowntimeCategory) => {
    try {
      await api.admin.updateDowntimeCategory(cat.id, { isPlanned: !cat.isPlanned });
      load();
    } catch (e: any) { setError(e.message); }
  };

  if (loading) return <Spinner />;

  // Group by famille
  const grouped = items.reduce<Record<string, AdminDowntimeCategory[]>>((acc, c) => {
    (acc[c.famille] ||= []).push(c);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <p className="text-sm text-gray-500">{items.length} catégories d'arrêts</p>
          <p className="text-xs text-gray-400 mt-1">
            <span className="inline-block w-3 h-3 rounded bg-amber-100 border border-amber-300 mr-1 align-middle" /> Planifié (affecte tAP)
            <span className="inline-block w-3 h-3 rounded bg-red-100 border border-red-300 ml-3 mr-1 align-middle" /> Non planifié (affecte tF)
          </p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary"><Plus className="h-4 w-4" /> Ajouter</button>
      </div>

      {error && <ErrorBanner msg={error} onClose={() => setError("")} />}

      {showForm && (
        <FormCard title={editingId ? "Modifier catégorie" : "Nouvelle catégorie"} onCancel={resetForm} onSave={save}>
          <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="XX-CODE" />
          <Field label="Label" value={form.label} onChange={(v) => setForm({ ...form, label: v })} placeholder="Nom de l'arrêt" />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Famille</label>
            <select value={form.famille} onChange={(e) => setForm({ ...form, famille: e.target.value })} className="input-field">
              {FAMILLES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Équipement cible</label>
            <select value={form.appliesToEquipmentType} onChange={(e) => setForm({ ...form, appliesToEquipmentType: e.target.value })} className="input-field">
              <option value="">Tous les équipements</option>
              <option value="blistereuse">Blistereuse uniquement</option>
              <option value="geluleuse">Géluleuse uniquement</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setForm({ ...form, isPlanned: !form.isPlanned })} className="flex items-center gap-2">
              {form.isPlanned ? <ToggleRight className="h-6 w-6 text-amber-600" /> : <ToggleLeft className="h-6 w-6 text-gray-400" />}
              <span className="text-sm">{form.isPlanned ? "Arrêt planifié" : "Arrêt non planifié"}</span>
            </button>
          </div>
        </FormCard>
      )}

      {Object.entries(grouped).map(([famille, cats]) => (
        <div key={famille} className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            {famille}
            <span className="text-xs font-normal text-gray-400">({cats.length})</span>
          </h3>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-gray-500"><th className="py-2 px-3">Code</th><th className="py-2 px-3">Label</th><th className="py-2 px-3">Équipement</th><th className="py-2 px-3 text-center">Planifié</th><th className="py-2 px-3">Statut</th><th className="py-2 px-3 w-24">Actions</th></tr></thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.id} className={`border-b hover:bg-gray-50 ${!c.isActive ? "opacity-50" : ""}`}>
                  <td className="py-2 px-3 font-mono text-xs">{c.code}</td>
                  <td className="py-2 px-3 font-medium">{c.label}</td>
                  <td className="py-2 px-3 capitalize">{c.appliesToEquipmentType || "Tous"}</td>
                  <td className="py-2 px-3 text-center">
                    <button onClick={() => togglePlanned(c)} className="inline-flex items-center gap-1" title={c.isPlanned ? "Planifié → cliquez pour changer" : "Non planifié → cliquez pour changer"}>
                      {c.isPlanned ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
                          <ToggleRight className="h-3.5 w-3.5" /> Planifié
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-300">
                          <ToggleLeft className="h-3.5 w-3.5" /> Non planifié
                        </span>
                      )}
                    </button>
                  </td>
                  <td className="py-2 px-3"><StatusBadge active={c.isActive} /></td>
                  <td className="py-2 px-3">
                    <div className="flex gap-1">
                      <IconBtn icon={Pencil} onClick={() => startEdit(c)} title="Modifier" />
                      {c.isActive && <IconBtn icon={Trash2} onClick={() => remove(c.id)} title="Désactiver" className="text-red-500 hover:bg-red-50" />}
                      {!c.isActive && <IconBtn icon={Check} onClick={async () => { await api.admin.updateDowntimeCategory(c.id, { isActive: true }); load(); }} title="Réactiver" className="text-green-600 hover:bg-green-50" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ))}

      <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <h4 className="text-sm font-semibold text-blue-800 mb-2">Règles de calcul TRS (NF E 60-182)</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-blue-700">
          <div>
            <p className="font-medium mb-1">Arrêts planifiés :</p>
            <p>Soustraits du temps d'ouverture (tO) pour obtenir le temps requis (tR).</p>
            <p className="font-mono mt-1">tR = tO − tAP</p>
          </div>
          <div>
            <p className="font-medium mb-1">Arrêts non planifiés :</p>
            <p>Soustraits du temps requis (tR) pour obtenir le temps de fonctionnement (tF).</p>
            <p className="font-mono mt-1">tF = tR − Σ(arrêts non planifiés)</p>
          </div>
          <div className="col-span-2 border-t border-blue-200 pt-2">
            <p className="font-medium">TRS = DO × TP × TQ</p>
            <p>DO = tF/tR (Disponibilité) · TP = tN/tF (Performance) · TQ = conformes/produits (Qualité)</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared UI Components ──────────────────────────────────

function Spinner() {
  return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
}

function StatusBadge({ active }: { active: boolean }) {
  return active
    ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Actif</span>
    : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Inactif</span>;
}

function ErrorBanner({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
      <span className="text-sm text-red-700">{msg}</span>
      <button onClick={onClose}><X className="h-4 w-4 text-red-400" /></button>
    </div>
  );
}

function IconBtn({ icon: Icon, onClick, title, className = "text-gray-500 hover:bg-gray-100" }: { icon: typeof Pencil; onClick: () => void; title: string; className?: string }) {
  return <button onClick={onClick} title={title} className={`p-1.5 rounded transition ${className}`}><Icon className="h-3.5 w-3.5" /></button>;
}

function FormCard({ title, children, onCancel, onSave }: { title: string; children: React.ReactNode; onCancel: () => void; onSave: () => void }) {
  return (
    <div className="mb-6 p-4 bg-white border rounded-lg shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">{children}</div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 border rounded hover:bg-gray-50">Annuler</button>
        <button onClick={onSave} className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded hover:bg-blue-700">Enregistrer</button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input-field" />
    </div>
  );
}
