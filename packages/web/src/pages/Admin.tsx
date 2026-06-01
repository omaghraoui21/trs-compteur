import { useState, useEffect, useCallback } from "react";
import { api, type AdminRoom, type AdminEquipment, type AdminProduct, type AdminDowntimeCategory, type AdminPhaseTemplate, type ProductEquipmentCadence, type AdminUser } from "@/lib/api";
import { PHASE_CATEGORY_KEYS, PHASE_CATEGORY_LABELS, PHASE_EVENT_TYPES } from "@trs/engine";
import { Settings, Building2, Cpu, Package, AlertTriangle, Plus, Pencil, Trash2, X, Check, ToggleLeft, ToggleRight, Gauge, Clock, List, Network, ChevronDown, ChevronRight, Users, KeyRound } from "lucide-react";
import { TableSkeleton } from "@/components/Skeleton";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/Toast";

type Tab = "rooms" | "equipments" | "products" | "phases" | "downtimes" | "cadences" | "users";

const TABS: { key: Tab; label: string; icon: typeof Building2; adminOnly?: boolean }[] = [
  { key: "rooms", label: "Locaux", icon: Building2 },
  { key: "equipments", label: "Équipements", icon: Cpu },
  { key: "products", label: "Produits", icon: Package },
  { key: "cadences", label: "Cadences", icon: Gauge },
  { key: "phases", label: "Phases", icon: Clock },
  { key: "downtimes", label: "Arrêts", icon: AlertTriangle },
  { key: "users", label: "Utilisateurs", icon: Users, adminOnly: true },
];

// Phase category keys, labels, and selectable event types come from @trs/engine
// (single source of truth shared with the API). "arret_planifie" = planned
// stops (pause, APR) which reduce tR (not tF); unplanned stops live in the
// Arrêts tab because they must be linked to a lot.

const FAMILLES = [
  "Panne équipement",
  "Intervention maintenance",
  "Attente et transition",
  "Utilités",
  "Contrôle qualité",
];

export default function AdminPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("rooms");
  const visibleTabs = TABS.filter((t) => !t.adminOnly || user?.role === "admin");

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="h-6 w-6 text-blue-700" />
        <h1 className="text-2xl font-bold text-gray-800">Configuration</h1>
      </div>

      <div className="flex overflow-x-auto border-b mb-6 -mx-4 px-4 sm:mx-0 sm:px-0">
        {visibleTabs.map((tab) => (
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
      {activeTab === "phases" && <PhasesPanel />}
      {activeTab === "downtimes" && <DowntimesPanel />}
      {activeTab === "users" && user?.role === "admin" && <UsersPanel currentUserId={user.id} />}
    </div>
  );
}

// ─── Users panel (admin-only) ───────────────────────────────────

const ROLE_LABELS: Record<string, string> = { operator: "Opérateur", supervisor: "Superviseur", admin: "Admin" };
const ROLE_BADGE: Record<string, string> = {
  operator: "bg-gray-100 text-gray-600", supervisor: "bg-blue-100 text-blue-700", admin: "bg-purple-100 text-purple-700",
};

function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: "", displayName: "", password: "", role: "operator" });
  const [pwFor, setPwFor] = useState<AdminUser | null>(null);
  const [newPw, setNewPw] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await api.admin.listUsers()); }
    catch (e: any) { toast.error(e.message || "Chargement des utilisateurs échoué"); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try {
      await api.admin.createUser(form);
      toast.success("Utilisateur créé");
      setCreating(false);
      setForm({ email: "", displayName: "", password: "", role: "operator" });
      load();
    } catch (e: any) { toast.error(e.message || "Création échouée"); }
  };

  const toggleActive = async (u: AdminUser) => {
    try { await api.admin.updateUser(u.id, { isActive: !u.isActive }); load(); }
    catch (e: any) { toast.error(e.message || "Mise à jour échouée"); }
  };

  const changeRole = async (u: AdminUser, role: string) => {
    try { await api.admin.updateUser(u.id, { role }); load(); }
    catch (e: any) { toast.error(e.message || "Changement de rôle échoué"); }
  };

  const resetPassword = async () => {
    if (!pwFor) return;
    try {
      await api.admin.resetUserPassword(pwFor.id, newPw);
      toast.success(`Mot de passe réinitialisé pour ${pwFor.displayName}`);
      setPwFor(null); setNewPw("");
    } catch (e: any) { toast.error(e.message || "Réinitialisation échouée"); }
  };

  if (loading) return <TableSkeleton />;

  return (
    <div>
      <div className="flex justify-end mb-3">
        {!creating && (
          <button onClick={() => setCreating(true)} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        )}
      </div>

      {creating && (
        <FormCard title="Nouvel utilisateur" onCancel={() => setCreating(false)} onSave={create}>
          <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="prenom@dpi.local" />
          <Field label="Nom affiché" value={form.displayName} onChange={(v) => setForm({ ...form, displayName: v })} placeholder="Jean Dupont" />
          <Field label="Mot de passe" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} placeholder="6 caractères min." />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rôle</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input-field">
              <option value="operator">Opérateur</option>
              <option value="supervisor">Superviseur</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </FormCard>
      )}

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="rtable w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2">Nom</th>
              <th className="text-left px-4 py-2">Email</th>
              <th className="text-left px-4 py-2">Rôle</th>
              <th className="text-left px-4 py-2">Statut</th>
              <th className="text-right px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <tr key={u.id} className="border-t">
                  <td data-label="Nom" className="px-4 py-2 font-medium">{u.displayName}{isSelf && <span className="ml-1 text-xs text-gray-400">(vous)</span>}</td>
                  <td data-label="Email" className="px-4 py-2 text-gray-500">{u.email}</td>
                  <td data-label="Rôle" className="px-4 py-2">
                    <select
                      value={u.role}
                      disabled={isSelf}
                      onChange={(e) => changeRole(u, e.target.value)}
                      className={`text-xs px-2 py-1 rounded ${ROLE_BADGE[u.role]} disabled:opacity-60`}
                    >
                      <option value="operator">{ROLE_LABELS.operator}</option>
                      <option value="supervisor">{ROLE_LABELS.supervisor}</option>
                      <option value="admin">{ROLE_LABELS.admin}</option>
                    </select>
                  </td>
                  <td data-label="Statut" className="px-4 py-2">
                    <button onClick={() => toggleActive(u)} disabled={isSelf} className="inline-flex items-center gap-1 disabled:opacity-40">
                      {u.isActive
                        ? <><ToggleRight className="h-4 w-4 text-green-600" /> <span className="text-green-700 text-xs">Actif</span></>
                        : <><ToggleLeft className="h-4 w-4 text-gray-400" /> <span className="text-gray-400 text-xs">Inactif</span></>}
                    </button>
                  </td>
                  <td data-label="Actions" className="px-4 py-2 text-right">
                    <button onClick={() => { setPwFor(u); setNewPw(""); }} title="Réinitialiser le mot de passe" className="p-1.5 rounded text-gray-500 hover:bg-gray-100">
                      <KeyRound className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pwFor && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setPwFor(null)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">Réinitialiser le mot de passe</h3>
            <p className="text-sm text-gray-500 mb-3">{pwFor.displayName} · {pwFor.email}</p>
            <Field label="Nouveau mot de passe" type="password" value={newPw} onChange={setNewPw} placeholder="6 caractères min." />
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setPwFor(null)} className="px-3 py-1.5 text-sm text-gray-600 border rounded hover:bg-gray-50">Annuler</button>
              <button onClick={resetPassword} disabled={newPw.length < 6} className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50">Réinitialiser</button>
            </div>
          </div>
        </div>
      )}
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
        <table className="rtable w-full text-sm">
          <thead><tr className="border-b text-left text-gray-500"><th className="py-2 px-3">Code</th><th className="py-2 px-3">Nom</th><th className="py-2 px-3">Description</th><th className="py-2 px-3">Statut</th><th className="py-2 px-3 w-24">Actions</th></tr></thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id} className={`border-b hover:bg-gray-50 ${!r.isActive ? "opacity-50" : ""}`}>
                <td data-label="Code" className="py-2 px-3 font-mono text-xs">{r.code}</td>
                <td data-label="Nom" className="py-2 px-3 font-medium">{r.name}</td>
                <td data-label="Description" className="py-2 px-3 text-gray-500">{r.description || "—"}</td>
                <td data-label="Statut" className="py-2 px-3"><StatusBadge active={r.isActive} /></td>
                <td data-label="Actions" className="py-2 px-3">
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
        <table className="rtable w-full text-sm">
          <thead><tr className="border-b text-left text-gray-500"><th className="py-2 px-3">Code</th><th className="py-2 px-3">Nom</th><th className="py-2 px-3">Local</th><th className="py-2 px-3">Type</th><th className="py-2 px-3">Obj. TRS</th><th className="py-2 px-3">Micro-arrêt</th><th className="py-2 px-3">Statut</th><th className="py-2 px-3 w-24">Actions</th></tr></thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id} className={`border-b hover:bg-gray-50 ${!e.isActive ? "opacity-50" : ""}`}>
                <td data-label="Code" className="py-2 px-3 font-mono text-xs">{e.code}</td>
                <td data-label="Nom" className="py-2 px-3 font-medium">{e.name}</td>
                <td data-label="Local" className="py-2 px-3">{roomName(e.roomId)}</td>
                <td data-label="Type" className="py-2 px-3 capitalize">{e.equipmentType || "—"}</td>
                <td data-label="Obj. TRS" className="py-2 px-3">{e.trsObjective}%</td>
                <td data-label="Micro-arrêt" className="py-2 px-3">{e.microStopThresholdMin ?? 5} min</td>
                <td data-label="Statut" className="py-2 px-3"><StatusBadge active={e.isActive} /></td>
                <td data-label="Actions" className="py-2 px-3">
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
        <table className="rtable w-full text-sm">
          <thead><tr className="border-b text-left text-gray-500"><th className="py-2 px-3">Code</th><th className="py-2 px-3">Nom</th><th className="py-2 px-3">Cadence</th><th className="py-2 px-3">Unité</th><th className="py-2 px-3">Statut</th><th className="py-2 px-3 w-24">Actions</th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className={`border-b hover:bg-gray-50 ${!p.isActive ? "opacity-50" : ""}`}>
                <td data-label="Code" className="py-2 px-3 font-mono text-xs">{p.code}</td>
                <td data-label="Nom" className="py-2 px-3 font-medium">{p.name}</td>
                <td data-label="Cadence" className="py-2 px-3">{p.defaultCadence ? `${p.defaultCadence} ${p.cadenceUnit}` : "—"}</td>
                <td data-label="Unité" className="py-2 px-3">{p.unit}</td>
                <td data-label="Statut" className="py-2 px-3"><StatusBadge active={p.isActive} /></td>
                <td data-label="Actions" className="py-2 px-3">
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
            <table className="rtable w-full text-sm">
              <thead><tr className="border-b text-left text-gray-500"><th className="py-2 px-3">Produit</th><th className="py-2 px-3">Cadence</th><th className="py-2 px-3">Unité</th><th className="py-2 px-3">Obj. TRS</th><th className="py-2 px-3 w-16">Action</th></tr></thead>
              <tbody>
                {items.map(c => (
                  <tr key={c.id} className="border-b hover:bg-gray-50">
                    <td data-label="Produit" className="py-2 px-3 font-medium">{productName(c.productId)}</td>
                    <td data-label="Cadence" className="py-2 px-3">{c.cadenceValue}</td>
                    <td data-label="Unité" className="py-2 px-3">{c.cadenceUnit}</td>
                    <td data-label="Obj. TRS" className="py-2 px-3">{c.trsObjective ? `${c.trsObjective}%` : "—"}</td>
                    <td data-label="Action" className="py-2 px-3">
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

function PhasesPanel() {
  const [items, setItems] = useState<AdminPhaseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const emptyForm = { code: "", label: "", category: PHASE_CATEGORY_KEYS[0] as string, eventType: "custom" as string, requiresComment: false, appliesToEquipmentType: "", sortOrder: "0" };
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await api.admin.listPhaseTemplates()); } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setForm(emptyForm); setShowForm(false); setEditingId(null); setError(""); };

  const startEdit = (p: AdminPhaseTemplate) => {
    setForm({
      code: p.code, label: p.label, category: p.category, eventType: p.eventType,
      requiresComment: p.requiresComment, appliesToEquipmentType: p.appliesToEquipmentType || "",
      sortOrder: String(p.sortOrder),
    });
    setEditingId(p.id); setShowForm(true);
  };

  const save = async () => {
    setError("");
    try {
      const payload = {
        code: form.code, label: form.label, category: form.category, eventType: form.eventType,
        isPlanned: true,
        requiresComment: form.requiresComment,
        appliesToEquipmentType: form.appliesToEquipmentType || null,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (editingId) {
        await api.admin.updatePhaseTemplate(editingId, payload);
      } else {
        await api.admin.createPhaseTemplate(payload);
      }
      resetForm(); load();
    } catch (e: any) { setError(e.message); }
  };

  const remove = async (id: string) => {
    if (!confirm("Désactiver cette phase ?")) return;
    try { await api.admin.deletePhaseTemplate(id); load(); } catch (e: any) { setError(e.message); }
  };

  if (loading) return <Spinner />;

  const grouped = items.reduce<Record<string, AdminPhaseTemplate[]>>((acc, p) => {
    (acc[p.category] ||= []).push(p);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
        <div>
          <p className="text-sm text-gray-500">{items.length} phases configurées <span className="ml-1 align-middle text-[10px] font-semibold uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Hérité</span></p>
          <p className="text-xs text-gray-400 mt-1">
            Modèle hérité. L'opérateur ne saisit plus de phases : tout est déclaré via
            « Déclarer un arrêt » (planifié / non planifié). Conservé pour les données historiques.
          </p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary shrink-0"><Plus className="h-4 w-4" /> Ajouter</button>
      </div>

      {error && <ErrorBanner msg={error} onClose={() => setError("")} />}

      {showForm && (
        <FormCard title={editingId ? "Modifier la phase" : "Nouvelle phase"} onCancel={resetForm} onSave={save}>
          <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="PH-CODE" />
          <Field label="Label" value={form.label} onChange={(v) => setForm({ ...form, label: v })} placeholder="Nom de la phase" />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input-field">
              {PHASE_CATEGORY_KEYS.map(k => <option key={k} value={k}>{PHASE_CATEGORY_LABELS[k]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type d'événement (TRS)</label>
            <select value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value })} className="input-field">
              {PHASE_EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
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
          <Field label="Ordre d'affichage" value={form.sortOrder} onChange={(v) => setForm({ ...form, sortOrder: v })} type="number" placeholder="10" />
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setForm({ ...form, requiresComment: !form.requiresComment })} className="flex items-center gap-2">
              {form.requiresComment ? <ToggleRight className="h-6 w-6 text-blue-600" /> : <ToggleLeft className="h-6 w-6 text-gray-400" />}
              <span className="text-sm">Commentaire obligatoire</span>
            </button>
          </div>
        </FormCard>
      )}

      {PHASE_CATEGORY_KEYS.filter(k => grouped[k]?.length).map((cat) => (
        <div key={cat} className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            {PHASE_CATEGORY_LABELS[cat]}
            <span className="text-xs font-normal text-gray-400">({grouped[cat].length})</span>
          </h3>
          <div className="overflow-x-auto">
          <table className="rtable w-full text-sm">
            <thead><tr className="border-b text-left text-gray-500"><th className="py-2 px-3">Code</th><th className="py-2 px-3">Label</th><th className="py-2 px-3">Équipement</th><th className="py-2 px-3">Type</th><th className="py-2 px-3">Statut</th><th className="py-2 px-3 w-24">Actions</th></tr></thead>
            <tbody>
              {grouped[cat].map((p) => (
                <tr key={p.id} className={`border-b hover:bg-gray-50 ${!p.isActive ? "opacity-50" : ""}`}>
                  <td data-label="Code" className="py-2 px-3 font-mono text-xs">{p.code}</td>
                  <td data-label="Label" className="py-2 px-3 font-medium">{p.label}{p.requiresComment && <span className="ml-1 text-red-500" title="Commentaire obligatoire">*</span>}</td>
                  <td data-label="Équipement" className="py-2 px-3 capitalize">{p.appliesToEquipmentType || "Tous"}</td>
                  <td data-label="Type" className="py-2 px-3 font-mono text-xs text-gray-500">{p.eventType}</td>
                  <td data-label="Statut" className="py-2 px-3"><StatusBadge active={p.isActive} /></td>
                  <td data-label="Actions" className="py-2 px-3">
                    <div className="flex gap-1">
                      <IconBtn icon={Pencil} onClick={() => startEdit(p)} title="Modifier" />
                      {p.isActive && <IconBtn icon={Trash2} onClick={() => remove(p.id)} title="Désactiver" className="text-red-500 hover:bg-red-50" />}
                      {!p.isActive && <IconBtn icon={Check} onClick={async () => { await api.admin.updatePhaseTemplate(p.id, { isActive: true }); load(); }} title="Réactiver" className="text-green-600 hover:bg-green-50" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ))}

      <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-200 text-xs text-blue-700">
        <h4 className="text-sm font-semibold text-blue-800 mb-1">Modèle actuel : tout est un arrêt</h4>
        <p>La notion de <strong>phase</strong> est <strong>héritée</strong>. Désormais l'opérateur ne déclare que des <strong>arrêts planifiés</strong> (changement de série, nettoyage, pause, maintenance préventive → réduisent le temps requis tR) et des <strong>arrêts non planifiés</strong> (pannes, attentes → réduisent le temps de fonctionnement tF). Le temps de marche est le reste. Cet onglet ne sert qu'à gérer d'anciennes données de phase et peut rester vide.</p>
      </div>
    </div>
  );
}

function DowntimesPanel() {
  const [items, setItems] = useState<AdminDowntimeCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", label: "", famille: FAMILLES[0], isPlanned: false, appliesToEquipmentType: "" });
  const [error, setError] = useState("");
  const [treeView, setTreeView] = useState(false);

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
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
        <div>
          <p className="text-sm text-gray-500">{items.length} catégories d'arrêts</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 mt-1">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-amber-100 border border-amber-300" /> Planifié (affecte tAP)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-red-100 border border-red-300" /> Non planifié (affecte tF)
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded border overflow-hidden text-xs">
            <button
              onClick={() => setTreeView(false)}
              className={`px-2.5 py-1.5 flex items-center gap-1 transition ${!treeView ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}
            >
              <List className="h-3 w-3" /> Liste
            </button>
            <button
              onClick={() => setTreeView(true)}
              className={`px-2.5 py-1.5 flex items-center gap-1 border-l transition ${treeView ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}
            >
              <Network className="h-3 w-3" /> Arbre
            </button>
          </div>
          <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary shrink-0"><Plus className="h-4 w-4" /> Ajouter</button>
        </div>
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

      {treeView ? (
        <DowntimeTree categories={items} />
      ) : (
        Object.entries(grouped).map(([famille, cats]) => (
          <div key={famille} className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              {famille}
              <span className="text-xs font-normal text-gray-400">({cats.length})</span>
            </h3>
            <div className="overflow-x-auto">
            <table className="rtable w-full text-sm">
              <thead><tr className="border-b text-left text-gray-500"><th className="py-2 px-3">Code</th><th className="py-2 px-3">Label</th><th className="py-2 px-3">Équipement</th><th className="py-2 px-3 text-center">Planifié</th><th className="py-2 px-3">Statut</th><th className="py-2 px-3 w-24">Actions</th></tr></thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.id} className={`border-b hover:bg-gray-50 ${!c.isActive ? "opacity-50" : ""}`}>
                    <td data-label="Code" className="py-2 px-3 font-mono text-xs">{c.code}</td>
                    <td data-label="Label" className="py-2 px-3 font-medium">{c.label}</td>
                    <td data-label="Équipement" className="py-2 px-3 capitalize">{c.appliesToEquipmentType || "Tous"}</td>
                    <td data-label="Planifié" className="py-2 px-3 text-center">
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
                    <td data-label="Statut" className="py-2 px-3"><StatusBadge active={c.isActive} /></td>
                    <td data-label="Actions" className="py-2 px-3">
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
        ))
      )}

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

// ─── Downtime Tree View ───────────────────────────────────

const TREE_BRANCHES = [
  { isPlanned: false, label: "Non planifié", color: "#ef4444", bgClass: "bg-red-50", borderClass: "border-red-200", connectorColor: "#fca5a5" },
  { isPlanned: true,  label: "Planifié",     color: "#d97706", bgClass: "bg-amber-50", borderClass: "border-amber-200", connectorColor: "#fcd34d" },
] as const;

function DowntimeTree({ categories }: { categories: AdminDowntimeCategory[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (key: string) =>
    setCollapsed(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });

  return (
    <div className="mb-6 space-y-3">
      {TREE_BRANCHES.map(branch => {
        const branchCats = categories.filter(c => c.isPlanned === branch.isPlanned);
        if (branchCats.length === 0) return null;

        const byFamille = branchCats.reduce<Record<string, AdminDowntimeCategory[]>>((acc, c) => {
          (acc[c.famille] ||= []).push(c);
          return acc;
        }, {});

        return (
          <div key={String(branch.isPlanned)}>
            {/* Branch root */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${branch.bgClass} border ${branch.borderClass}`}>
              <span className="font-semibold text-sm" style={{ color: branch.color }}>{branch.label}</span>
              <span className="text-xs text-gray-400 font-normal">{branchCats.length} raison{branchCats.length > 1 ? "s" : ""}</span>
            </div>

            {/* Famille nodes */}
            <div className="ml-5 border-l-2 pl-0" style={{ borderColor: branch.connectorColor }}>
              {Object.entries(byFamille).map(([famille, cats]) => {
                const nodeKey = `${branch.isPlanned}-${famille}`;
                const isCollapsed = collapsed.has(nodeKey);
                const activeCount = cats.filter(c => c.isActive).length;

                return (
                  <div key={famille} className="mt-1">
                    {/* Famille toggle */}
                    <button
                      onClick={() => toggle(nodeKey)}
                      className="flex items-center gap-1.5 w-full text-left px-3 py-1.5 hover:bg-gray-50 rounded-r transition"
                    >
                      <span className="text-gray-300 mr-0.5">├─</span>
                      {isCollapsed
                        ? <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                        : <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />}
                      <span className="text-xs font-medium text-gray-700">{famille}</span>
                      <span className="text-xs text-gray-400">({activeCount}/{cats.length})</span>
                    </button>

                    {/* Leaf reason nodes */}
                    {!isCollapsed && (
                      <div className="ml-8 border-l border-gray-200">
                        {cats.map((c, i) => (
                          <div
                            key={c.id}
                            className={`flex items-center gap-2 px-3 py-1 text-xs ${!c.isActive ? "opacity-40" : ""}`}
                          >
                            <span className="text-gray-300 shrink-0">{i === cats.length - 1 ? "└─" : "├─"}</span>
                            <span className="font-medium text-gray-800">{c.label}</span>
                            <span className="font-mono text-gray-400">{c.code}</span>
                            {c.appliesToEquipmentType && (
                              <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 capitalize">{c.appliesToEquipmentType}</span>
                            )}
                            {!c.isActive && (
                              <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">inactif</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {categories.length === 0 && (
        <div className="bg-gray-50 rounded-lg p-8 text-center text-gray-400 text-sm">
          Aucune catégorie d'arrêt configurée.
        </div>
      )}
    </div>
  );
}

// ─── Shared UI Components ──────────────────────────────────

function Spinner() {
  return <div className="py-4"><TableSkeleton /></div>;
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

function FormCard({ title, children, onCancel, onSave }: { title: string; children: React.ReactNode; onCancel: () => void; onSave: () => void | Promise<void> }) {
  // Guards against double-submit centrally for every admin panel: the button is
  // disabled while the (possibly async) onSave is in flight.
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try { await onSave(); } finally { setSaving(false); }
  };
  return (
    <div className="mb-6 p-4 bg-white border rounded-lg shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">{children}</div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} disabled={saving} className="px-3 py-1.5 text-sm text-gray-600 border rounded hover:bg-gray-50 disabled:opacity-50">Annuler</button>
        <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50">{saving ? "Enregistrement…" : "Enregistrer"}</button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-field"
        inputMode={type === "number" ? "numeric" : undefined}
      />
    </div>
  );
}
