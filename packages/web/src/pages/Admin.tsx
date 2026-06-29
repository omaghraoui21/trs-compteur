import { useState, useEffect, useCallback, useMemo, Fragment, useRef } from "react";
import { api, type AdminRoom, type AdminEquipment, type AdminProduct, type AdminDowntimeCategory, type ProductEquipmentCadence, type AdminUser, type AuditLogEntry } from "@/lib/api";
import { Settings, Building2, Cpu, Package, AlertTriangle, Plus, Pencil, Trash2, X, Check, ToggleLeft, ToggleRight, Gauge, List, Network, ChevronDown, ChevronRight, Users, KeyRound, ScrollText, ChevronLeft } from "lucide-react";
import { TableSkeleton } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/Toast";

type Tab = "rooms" | "equipments" | "products" | "cadences" | "downtimes" | "users" | "audit";

const TABS: { key: Tab; label: string; icon: typeof Building2; adminOnly?: boolean }[] = [
  { key: "rooms", label: "Locaux", icon: Building2 },
  { key: "equipments", label: "Équipements", icon: Cpu },
  { key: "products", label: "Produits", icon: Package },
  { key: "cadences", label: "Cadences", icon: Gauge },
  { key: "downtimes", label: "Arrêts", icon: AlertTriangle },
  { key: "users", label: "Utilisateurs", icon: Users, adminOnly: true },
  { key: "audit", label: "Journal d'audit", icon: ScrollText },
];

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
        <Settings className="h-6 w-6 text-blue-700" aria-hidden="true" />
        <h1 className="text-xl font-bold text-gray-800">Configuration</h1>
      </div>

      <div role="tablist" className="flex overflow-x-auto border-b mb-6 -mx-4 px-4 sm:mx-0 sm:px-0">
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition ${
              activeTab === tab.key
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            <tab.icon className="h-4 w-4" aria-hidden="true" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "rooms" && <RoomsPanel />}
      {activeTab === "equipments" && <EquipmentsPanel />}
      {activeTab === "products" && <ProductsPanel />}
      {activeTab === "cadences" && <CadencesPanel />}
      {activeTab === "downtimes" && <DowntimesPanel />}
      {activeTab === "users" && user?.role === "admin" && <UsersPanel currentUserId={user.id} />}
      {activeTab === "audit" && <AuditLogPanel />}
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
  const pwDialogRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await api.admin.listUsers()); }
    catch (e: any) { toast.error(e.message || "Chargement des utilisateurs échoué"); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  // Move focus into the reset-password dialog on open so keyboard users land
  // there and the Escape handler fires (it relies on a focused element inside
  // the overlay) — same pattern as ConfirmDeleteModal.
  useEffect(() => { if (pwFor) pwDialogRef.current?.querySelector("input")?.focus(); }, [pwFor]);

  const create = async () => {
    try {
      await api.admin.createUser(form);
      toast.success("Utilisateur créé");
      setCreating(false);
      setForm({ email: "", displayName: "", password: "", role: "operator" });
      load();
    } catch (e: any) { toast.error(e.message || "Création échouée"); }
  };

  // Deactivation goes through the shared accessible confirmation modal (same as
  // every other admin panel); reactivation is immediate.
  const { ask: askDeactivate, modal: deactivateModal } = useConfirmDelete({
    label: "Désactiver l'utilisateur ? Il ne pourra plus se connecter.",
    del: (id) => api.admin.updateUser(id, { isActive: false }),
    done: (n) => `${n} désactivé`,
    reload: load,
    onError: (m) => toast.error(m || "Mise à jour échouée"),
  });

  const toggleActive = async (u: AdminUser) => {
    if (u.isActive) { askDeactivate(u.id, u.displayName); return; }
    try { await api.admin.updateUser(u.id, { isActive: true }); load(); }
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
      {deactivateModal}
      <div className="flex justify-end mb-3">
        {!creating && (
          <button onClick={() => setCreating(true)} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" aria-hidden="true" /> Ajouter
          </button>
        )}
      </div>

      {creating && (
        <FormCard title="Nouvel utilisateur" onCancel={() => setCreating(false)} onSave={create}>
          <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="prenom@dpi.local" />
          <Field label="Nom affiché" value={form.displayName} onChange={(v) => setForm({ ...form, displayName: v })} placeholder="Jean Dupont" />
          <Field label="Mot de passe" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} placeholder="6 caractères min." />
          <div>
            <label htmlFor="user-role" className="block text-sm font-medium text-gray-700 mb-1">Rôle</label>
            <select id="user-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input-field">
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
              <th scope="col" className="text-left px-4 py-2">Nom</th>
              <th scope="col" className="text-left px-4 py-2">Email</th>
              <th scope="col" className="text-left px-4 py-2">Rôle</th>
              <th scope="col" className="text-left px-4 py-2">Statut</th>
              <th scope="col" className="text-right px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <tr key={u.id} className="border-t">
                  <td data-label="Nom" className="px-4 py-2 font-medium">{u.displayName}{isSelf && <span className="ml-1 text-xs text-gray-500">(vous)</span>}</td>
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
                        ? <><ToggleRight className="h-4 w-4 text-green-600" aria-hidden="true" /> <span className="text-green-700 text-xs">Actif</span></>
                        : <><ToggleLeft className="h-4 w-4 text-gray-500" aria-hidden="true" /> <span className="text-gray-500 text-xs">Inactif</span></>}
                    </button>
                  </td>
                  <td data-label="Actions" className="px-4 py-2 text-right">
                    <button onClick={() => { setPwFor(u); setNewPw(""); }} title="Réinitialiser le mot de passe" aria-label="Réinitialiser le mot de passe" className="p-1.5 rounded text-gray-500 hover:bg-gray-100">
                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pwFor && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          role="presentation"
          onClick={() => setPwFor(null)}
          onKeyDown={e => { if (e.key === "Escape") setPwFor(null); }}
        >
          <div
            ref={pwDialogRef}
            className="bg-white rounded-xl p-5 w-full max-w-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pw-reset-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="pw-reset-title" className="font-semibold mb-1">Réinitialiser le mot de passe</h3>
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
  const toast = useToast();
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

  const { ask: remove, modal: deleteModal } = useConfirmDelete({
    label: "Désactiver le local ?", del: api.admin.deleteRoom,
    done: n => `Local "${n}" désactivé`, reload: load, onError: setError,
  });

  if (loading) return <Spinner />;

  return (
    <div>
      {deleteModal}
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">{rooms.length} locaux</p>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary"><Plus className="h-4 w-4" aria-hidden="true" /> Ajouter</button>
      </div>

      {error && <ErrorBanner msg={error} onClose={() => setError("")} />}

      {showForm && (
        <FormCard title={editingId ? "Modifier local" : "Nouveau local"} onCancel={resetForm} onSave={save}>
          <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="LOCAL-XXX" />
          <Field label="Nom" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Nom du local" />
          <Field label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="Description (optionnel)" />
        </FormCard>
      )}

      {rooms.length === 0 && !showForm ? (
        <EmptyState icon={Building2} title="Aucun local" description="Cliquez sur Ajouter pour créer votre premier local." />
      ) : (
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
                      {r.isActive && <IconBtn icon={Trash2} onClick={() => remove(r.id, r.name)} title="Désactiver" className="text-red-500 hover:bg-red-50" />}
                      {!r.isActive && <IconBtn icon={Check} onClick={async () => { try { await api.admin.updateRoom(r.id, { isActive: true }); toast.success(`Local "${r.name}" réactivé`); load(); } catch (e: any) { setError(e.message); } }} title="Réactiver" className="text-green-600 hover:bg-green-50" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Equipments Panel ──────────────────────────────────────

function EquipmentsPanel() {
  const toast = useToast();
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

  const { ask: remove, modal: deleteModal } = useConfirmDelete({
    label: "Désactiver l'équipement ?", del: api.admin.deleteEquipment,
    done: n => `Équipement "${n}" désactivé`, reload: load, onError: setError,
  });

  const roomName = (roomId: string) => rooms.find(r => r.id === roomId)?.name || roomId;

  if (loading) return <Spinner />;

  return (
    <div>
      {deleteModal}
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">{items.length} équipements</p>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary"><Plus className="h-4 w-4" aria-hidden="true" /> Ajouter</button>
      </div>

      {error && <ErrorBanner msg={error} onClose={() => setError("")} />}

      {showForm && (
        <FormCard title={editingId ? "Modifier équipement" : "Nouvel équipement"} onCancel={resetForm} onSave={save}>
          <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="BLI-XXX" />
          <Field label="Nom" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Nom de l'équipement" />
          <div>
            <label htmlFor="equip-room" className="block text-sm font-medium text-gray-700 mb-1">Local</label>
            <select id="equip-room" value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })} className="input-field">
              <option value="">Sélectionner un local</option>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="equip-type" className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select id="equip-type" value={form.equipmentType} onChange={(e) => setForm({ ...form, equipmentType: e.target.value })} className="input-field">
              <option value="blistereuse">Blistéreuse</option>
              <option value="geluleuse">Géluleuse</option>
            </select>
          </div>
          <Field label="Objectif TRS (%)" value={form.trsObjective} onChange={(v) => setForm({ ...form, trsObjective: v })} type="number" />
          <Field label="Seuil micro-arrêts (min)" value={form.microStopThresholdMin} onChange={(v) => setForm({ ...form, microStopThresholdMin: v })} type="number" />
          <div>
            <label htmlFor="equip-cadence-unit" className="block text-sm font-medium text-gray-700 mb-1">Unité cadence</label>
            <select id="equip-cadence-unit" value={form.defaultCadenceUnit} onChange={(e) => setForm({ ...form, defaultCadenceUnit: e.target.value })} className="input-field">
              <option value="u/min">u/min</option>
              <option value="u/h">u/h</option>
            </select>
          </div>
        </FormCard>
      )}

      {items.length === 0 && !showForm ? (
        <EmptyState icon={Cpu} title="Aucun équipement" description="Cliquez sur Ajouter pour configurer votre premier équipement." />
      ) : (
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
                      {e.isActive && <IconBtn icon={Trash2} onClick={() => remove(e.id, e.name)} title="Désactiver" className="text-red-500 hover:bg-red-50" />}
                      {!e.isActive && <IconBtn icon={Check} onClick={async () => { try { await api.admin.updateEquipment(e.id, { isActive: true }); toast.success(`Équipement "${e.name}" réactivé`); load(); } catch (err: any) { setError(err.message); } }} title="Réactiver" className="text-green-600 hover:bg-green-50" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Products Panel ──────────────────────────────────────

function ProductsPanel() {
  const toast = useToast();
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

  const { ask: remove, modal: deleteModal } = useConfirmDelete({
    label: "Désactiver le produit ?", del: api.admin.deleteProduct,
    done: n => `Produit "${n}" désactivé`, reload: load, onError: setError,
  });

  if (loading) return <Spinner />;

  return (
    <div>
      {deleteModal}
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">{items.length} produits</p>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary"><Plus className="h-4 w-4" aria-hidden="true" /> Ajouter</button>
      </div>

      {error && <ErrorBanner msg={error} onClose={() => setError("")} />}

      {showForm && (
        <FormCard title={editingId ? "Modifier produit" : "Nouveau produit"} onCancel={resetForm} onSave={save}>
          <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="PROD-XXX" />
          <Field label="Nom" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Nom du produit" />
          <Field label="Cadence par défaut" value={form.defaultCadence} onChange={(v) => setForm({ ...form, defaultCadence: v })} type="number" placeholder="100" />
          <div>
            <label htmlFor="prod-cadence-unit" className="block text-sm font-medium text-gray-700 mb-1">Unité cadence</label>
            <select id="prod-cadence-unit" value={form.cadenceUnit} onChange={(e) => setForm({ ...form, cadenceUnit: e.target.value })} className="input-field">
              <option value="u/min">u/min</option>
              <option value="u/h">u/h</option>
            </select>
          </div>
          <Field label="Unité produit" value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} placeholder="blisters, gélules..." />
        </FormCard>
      )}

      {items.length === 0 && !showForm ? (
        <EmptyState icon={Package} title="Aucun produit" description="Cliquez sur Ajouter pour enregistrer votre premier produit." />
      ) : (
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
                      {p.isActive && <IconBtn icon={Trash2} onClick={() => remove(p.id, p.name)} title="Désactiver" className="text-red-500 hover:bg-red-50" />}
                      {!p.isActive && <IconBtn icon={Check} onClick={async () => { try { await api.admin.updateProduct(p.id, { isActive: true }); toast.success(`Produit "${p.name}" réactivé`); load(); } catch (err: any) { setError(err.message); } }} title="Réactiver" className="text-green-600 hover:bg-green-50" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Cadences Panel (Product × Equipment) ────────────────

function CadencesPanel() {
  const toast = useToast();
  const [cadences, setCadences] = useState<ProductEquipmentCadence[]>([]);
  const [productsList, setProductsList] = useState<AdminProduct[]>([]);
  const [equipmentsList, setEquipmentsList] = useState<AdminEquipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ productId: "", equipmentId: "", cadenceValue: "", cadenceUnit: "u/min", trsObjective: "" });
  const [error, setError] = useState("");
  const [cadenceSearch, setCadenceSearch] = useState("");

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

  const { ask: remove, modal: deleteModal } = useConfirmDelete({
    label: "Supprimer cette cadence ?", del: api.admin.deleteCadence,
    done: n => `Cadence "${n}" supprimée`, reload: load, onError: setError,
  });

  // O(1) name lookups — avoids a .find() over the full list per cadence per render
  const productNameMap = useMemo(() => new Map(productsList.map(p => [p.id, p.name] as const)), [productsList]);
  const equipmentNameMap = useMemo(() => new Map(equipmentsList.map(e => [e.id, e.name] as const)), [equipmentsList]);
  const productName = (id: string) => productNameMap.get(id) ?? id;
  const equipmentName = (id: string) => equipmentNameMap.get(id) ?? id;

  const filteredCadences = useMemo(() => {
    const q = cadenceSearch.toLowerCase();
    if (!q) return cadences;
    return cadences.filter(c =>
      (productNameMap.get(c.productId) ?? c.productId).toLowerCase().includes(q) ||
      (equipmentNameMap.get(c.equipmentId) ?? c.equipmentId).toLowerCase().includes(q));
  }, [cadences, cadenceSearch, productNameMap, equipmentNameMap]);

  // Group filtered cadences by equipment
  const grouped = useMemo(() => {
    const g: Record<string, ProductEquipmentCadence[]> = {};
    for (const c of filteredCadences) {
      const name = equipmentNameMap.get(c.equipmentId) ?? c.equipmentId;
      (g[name] ||= []).push(c);
    }
    return g;
  }, [filteredCadences, equipmentNameMap]);

  if (loading) return <Spinner />;

  return (
    <div>
      {deleteModal}
      <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
        <div>
          <p className="text-sm text-gray-500">{cadences.length} cadences configurées</p>
          <p className="text-xs text-gray-500 mt-1">Cadence théorique par couple produit × équipement. Pré-remplit automatiquement le formulaire opérateur.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="search"
            value={cadenceSearch}
            onChange={e => setCadenceSearch(e.target.value)}
            placeholder="Chercher produit ou équipement…"
            aria-label="Filtrer les cadences"
            className="border rounded-lg px-3 py-1.5 text-sm w-56"
          />
          <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary"><Plus className="h-4 w-4" aria-hidden="true" /> Ajouter</button>
        </div>
      </div>
      {cadenceSearch && filteredCadences.length === 0 && (
        <p className="text-sm text-gray-500 py-4 text-center">Aucune cadence correspond à « {cadenceSearch} ».</p>
      )}

      {error && <ErrorBanner msg={error} onClose={() => setError("")} />}

      {showForm && (
        <FormCard title="Cadence produit × équipement" onCancel={resetForm} onSave={save}>
          <div>
            <label htmlFor="cad-product" className="block text-sm font-medium text-gray-700 mb-1">Produit</label>
            <select id="cad-product" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className="input-field">
              <option value="">Sélectionner un produit</option>
              {productsList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cad-equip" className="block text-sm font-medium text-gray-700 mb-1">Équipement</label>
            <select id="cad-equip" value={form.equipmentId} onChange={(e) => setForm({ ...form, equipmentId: e.target.value })} className="input-field">
              <option value="">Sélectionner un équipement</option>
              {equipmentsList.map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
            </select>
          </div>
          <Field label="Cadence" value={form.cadenceValue} onChange={(v) => setForm({ ...form, cadenceValue: v })} type="number" placeholder="100" />
          <Field label="Objectif TRS (%) — optionnel" value={form.trsObjective} onChange={(v) => setForm({ ...form, trsObjective: v })} type="number" placeholder="85" />
          <div>
            <label htmlFor="cad-unit" className="block text-sm font-medium text-gray-700 mb-1">Unité</label>
            <select id="cad-unit" value={form.cadenceUnit} onChange={(e) => setForm({ ...form, cadenceUnit: e.target.value })} className="input-field">
              <option value="u/min">u/min</option>
              <option value="u/h">u/h</option>
            </select>
          </div>
        </FormCard>
      )}

      {Object.entries(grouped).map(([eqName, items]) => (
        <div key={eqName} className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <Cpu className="h-4 w-4" aria-hidden="true" /> {eqName}
            <span className="text-xs font-normal text-gray-500">({items.length} produits)</span>
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
                      <IconBtn icon={Trash2} onClick={() => remove(c.id, `${productName(c.productId)} (${eqName})`)} title="Supprimer" className="text-red-500 hover:bg-red-50" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {cadences.length === 0 && (
        <div className="bg-gray-50 rounded-lg p-8 text-center text-gray-500 text-sm">
          Aucune cadence configurée. Ajoutez des cadences pour pré-remplir automatiquement le formulaire opérateur.
        </div>
      )}
    </div>
  );
}

// ─── Downtimes Panel (with planned/unplanned toggle) ─────

function DowntimesPanel() {
  const toast = useToast();
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

  const { ask: remove, modal: deleteModal } = useConfirmDelete({
    label: "Désactiver la catégorie ?", del: api.admin.deleteDowntimeCategory,
    done: n => `Catégorie "${n}" désactivée`, reload: load, onError: setError,
  });

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
      {deleteModal}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
        <div>
          <p className="text-sm text-gray-500">{items.length} catégories d'arrêts</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-1">
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
              <List className="h-3 w-3" aria-hidden="true" /> Liste
            </button>
            <button
              onClick={() => setTreeView(true)}
              className={`px-2.5 py-1.5 flex items-center gap-1 border-l transition ${treeView ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}
            >
              <Network className="h-3 w-3" aria-hidden="true" /> Arbre
            </button>
          </div>
          <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary shrink-0"><Plus className="h-4 w-4" aria-hidden="true" /> Ajouter</button>
        </div>
      </div>

      {error && <ErrorBanner msg={error} onClose={() => setError("")} />}

      {showForm && (
        <FormCard title={editingId ? "Modifier catégorie" : "Nouvelle catégorie"} onCancel={resetForm} onSave={save}>
          <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="XX-CODE" />
          <Field label="Label" value={form.label} onChange={(v) => setForm({ ...form, label: v })} placeholder="Nom de l'arrêt" />
          <div>
            <label htmlFor="dt-famille" className="block text-sm font-medium text-gray-700 mb-1">Famille</label>
            <select id="dt-famille" value={form.famille} onChange={(e) => setForm({ ...form, famille: e.target.value })} className="input-field">
              {FAMILLES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="dt-equip-target" className="block text-sm font-medium text-gray-700 mb-1">Équipement cible</label>
            <select id="dt-equip-target" value={form.appliesToEquipmentType} onChange={(e) => setForm({ ...form, appliesToEquipmentType: e.target.value })} className="input-field">
              <option value="">Tous les équipements</option>
              <option value="blistereuse">Blistéreuse uniquement</option>
              <option value="geluleuse">Géluleuse uniquement</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setForm({ ...form, isPlanned: !form.isPlanned })} aria-pressed={form.isPlanned} className="flex items-center gap-2">
              {form.isPlanned ? <ToggleRight className="h-6 w-6 text-amber-600" aria-hidden="true" /> : <ToggleLeft className="h-6 w-6 text-gray-500" aria-hidden="true" />}
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
              <span className="text-xs font-normal text-gray-500">({cats.length})</span>
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
                      <button onClick={() => togglePlanned(c)} aria-pressed={c.isPlanned} className="inline-flex items-center gap-1" title={c.isPlanned ? "Planifié → cliquez pour changer" : "Non planifié → cliquez pour changer"}>
                        {c.isPlanned ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
                            <ToggleRight className="h-3.5 w-3.5" aria-hidden="true" /> Planifié
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-300">
                            <ToggleLeft className="h-3.5 w-3.5" aria-hidden="true" /> Non planifié
                          </span>
                        )}
                      </button>
                    </td>
                    <td data-label="Statut" className="py-2 px-3"><StatusBadge active={c.isActive} /></td>
                    <td data-label="Actions" className="py-2 px-3">
                      <div className="flex gap-1">
                        <IconBtn icon={Pencil} onClick={() => startEdit(c)} title="Modifier" />
                        {c.isActive && <IconBtn icon={Trash2} onClick={() => remove(c.id, c.label)} title="Désactiver" className="text-red-500 hover:bg-red-50" />}
                        {!c.isActive && <IconBtn icon={Check} onClick={async () => { try { await api.admin.updateDowntimeCategory(c.id, { isActive: true }); toast.success(`Catégorie "${c.label}" réactivée`); load(); } catch (err: any) { setError(err.message); } }} title="Réactiver" className="text-green-600 hover:bg-green-50" />}
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
          <div className="sm:col-span-2 border-t border-blue-200 pt-2">
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

  // All famille node keys across both branches — used by collapse-all.
  const allKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const branch of TREE_BRANCHES)
      for (const c of categories)
        if (c.isPlanned === branch.isPlanned) keys.add(`${branch.isPlanned}-${c.famille}`);
    return keys;
  }, [categories]);

  return (
    <div className="mb-6 space-y-3">
      {categories.length > 0 && (
        <div className="flex justify-end gap-2 text-xs">
          <button onClick={() => setCollapsed(new Set())} className="px-2.5 py-1 border rounded text-gray-500 hover:bg-gray-50">Tout déplier</button>
          <button onClick={() => setCollapsed(new Set(allKeys))} className="px-2.5 py-1 border rounded text-gray-500 hover:bg-gray-50">Tout replier</button>
        </div>
      )}
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
              <span className="text-xs text-gray-500 font-normal">{branchCats.length} raison{branchCats.length > 1 ? "s" : ""}</span>
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
                        ? <ChevronRight className="h-3.5 w-3.5 text-gray-500 shrink-0" aria-hidden="true" />
                        : <ChevronDown className="h-3.5 w-3.5 text-gray-500 shrink-0" aria-hidden="true" />}
                      <span className="text-xs font-medium text-gray-700">{famille}</span>
                      <span className="text-xs text-gray-500">({activeCount}/{cats.length})</span>
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
                            <span className="font-mono text-gray-500">{c.code}</span>
                            {c.appliesToEquipmentType && (
                              <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 capitalize">{c.appliesToEquipmentType}</span>
                            )}
                            {!c.isActive && (
                              <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">inactif</span>
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
        <div className="bg-gray-50 rounded-lg p-8 text-center text-gray-500 text-sm">
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
      <button onClick={onClose} aria-label="Fermer"><X className="h-4 w-4 text-red-400" aria-hidden="true" /></button>
    </div>
  );
}

function IconBtn({ icon: Icon, onClick, title, className = "text-gray-500 hover:bg-gray-100" }: { icon: typeof Pencil; onClick: () => void; title: string; className?: string }) {
  return <button onClick={onClick} title={title} aria-label={title} className={`p-1.5 rounded transition ${className}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></button>;
}

function ConfirmDeleteModal({ label, name, onConfirm, onCancel }: { label: string; name: string; onConfirm: () => void; onCancel: () => void }) {
  // Move focus into the dialog on open so keyboard users land here and the
  // Escape handler (which relies on the keydown bubbling up from a focused
  // element inside the overlay) actually fires. Focusing Cancel — the safe
  // option — is the right default for a destructive confirmation.
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
         role="presentation" onClick={onCancel} onKeyDown={e => { if (e.key === "Escape") onCancel(); }}>
      <div className="bg-white rounded-xl p-5 w-full max-w-sm shadow-xl"
           role="dialog" aria-modal="true" aria-labelledby="confirm-del-title"
           onClick={e => e.stopPropagation()}>
        <h3 id="confirm-del-title" className="font-semibold mb-1">{label}</h3>
        <p className="text-sm text-gray-500 mb-4">« {name} »</p>
        <div className="flex gap-2 justify-end">
          <button ref={cancelRef} onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 border rounded hover:bg-gray-50">Annuler</button>
          <button onClick={onConfirm} className="px-3 py-1.5 text-sm text-white bg-red-600 rounded hover:bg-red-700">Confirmer</button>
        </div>
      </div>
    </div>
  );
}

// Shared delete-confirmation flow for the admin panels: owns the pending-target
// state, runs the delete on confirm with a success toast, and renders the modal.
// Each panel passes its own delete fn + success message; `ask(id, name)` opens it.
function useConfirmDelete(opts: { label: string; del: (id: string) => Promise<unknown>; done: (name: string) => string; reload: () => void; onError: (msg: string) => void }) {
  const toast = useToast();
  const [pending, setPending] = useState<{ id: string; name: string } | null>(null);
  const confirm = async () => {
    if (!pending) return;
    try { await opts.del(pending.id); toast.success(opts.done(pending.name)); opts.reload(); }
    catch (e: any) { opts.onError(e.message); }
    setPending(null);
  };
  const modal = pending
    ? <ConfirmDeleteModal label={opts.label} name={pending.name} onConfirm={confirm} onCancel={() => setPending(null)} />
    : null;
  return { ask: (id: string, name: string) => setPending({ id, name }), modal };
}

function FormCard({ title, children, onCancel, onSave }: { title: string; children: React.ReactNode; onCancel: () => void; onSave: () => void | Promise<void> }) {
  // Guards against double-submit centrally for every admin panel: the button is
  // disabled while the (possibly async) onSave is in flight.
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try { await onSave(); } finally { setSaving(false); }
  };
  useEffect(() => {
    cardRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, []);
  return (
    <div ref={cardRef} className="mb-6 p-4 bg-white border rounded-lg shadow-sm">
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
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        id={id}
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

// ─── Audit Log panel (GMP traceability, 21 CFR Part 11) ──────────────────────

const ACTION_LABELS: Record<string, string> = {
  // Auth
  LOGIN: "Connexion", LOGOUT: "Déconnexion", CHANGE_PASSWORD: "Changement mdp",
  // Sessions & lots
  OPEN_SESSION: "Ouverture session", CLOSE_SESSION: "Clôture session",
  ADD_SESSION_EVENT: "Évènement session", ADD_SESSION_DOWNTIME: "Arrêt session",
  DELETE_SESSION_DOWNTIME: "Suppression arrêt session",
  START_LOT: "Démarrage lot", CLOSE_LOT: "Clôture lot", UPDATE_LOT: "MàJ lot (opérateur)",
  CORRECT_LOT: "Correction lot", VALIDATE_LOT: "Validation lot", REJECT_LOT: "Rejet lot",
  ADD_DOWNTIME: "Ajout arrêt", DELETE_DOWNTIME: "Suppression arrêt",
  CHANGE_CADENCE: "Changement cadence",
  // Admin CRUD
  CREATE_USER: "Création user", UPDATE_USER: "MàJ user", RESET_PASSWORD: "Reset mdp",
  CREATE_ROOM: "Création local", UPDATE_ROOM: "MàJ local", DEACTIVATE_ROOM: "Désactivation local",
  CREATE_EQUIPMENT: "Création équipement", UPDATE_EQUIPMENT: "MàJ équipement", DEACTIVATE_EQUIPMENT: "Désactivation équipement",
  CREATE_PRODUCT: "Création produit", UPDATE_PRODUCT: "MàJ produit", DEACTIVATE_PRODUCT: "Désactivation produit",
  CREATE_DOWNTIME_CATEGORY: "Création catégorie", UPDATE_DOWNTIME_CATEGORY: "MàJ catégorie", DEACTIVATE_DOWNTIME_CATEGORY: "Désactivation catégorie",
  UPSERT_CADENCE: "Cadence produit/équipement", DELETE_CADENCE: "Suppression cadence",
};

const ACTION_COLOR: Record<string, string> = {
  LOGIN: "bg-blue-50 text-blue-700",
  LOGOUT: "bg-gray-100 text-gray-700",
  CORRECT_LOT: "bg-amber-100 text-amber-800",
  VALIDATE_LOT: "bg-green-100 text-green-800",
  REJECT_LOT: "bg-red-100 text-red-800",
  RESET_PASSWORD: "bg-purple-100 text-purple-800",
  DEACTIVATE_ROOM: "bg-orange-50 text-orange-700",
  DEACTIVATE_EQUIPMENT: "bg-orange-50 text-orange-700",
  DEACTIVATE_PRODUCT: "bg-orange-50 text-orange-700",
  DEACTIVATE_DOWNTIME_CATEGORY: "bg-orange-50 text-orange-700",
};

const PAGE_SIZE = 50;

function AuditLogPanel() {
  const toast = useToast();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (off: number) => {
    setLoading(true);
    try {
      const rows = await api.admin.auditLog({
        action: actionFilter || undefined,
        entityType: entityFilter || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
        limit: PAGE_SIZE,
        offset: off,
      });
      setEntries(rows);
      setOffset(off);
    } catch (err: any) {
      toast.error(err.message || "Chargement du journal échoué");
    } finally {
      setLoading(false);
    }
  }, [actionFilter, entityFilter, fromDate, toDate, toast]);

  useEffect(() => { load(0); }, [load]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <ScrollText className="h-5 w-5 text-blue-700" aria-hidden="true" />
        <h2 className="font-semibold text-gray-800">Journal d'audit — traçabilité GMP (21 CFR Part 11)</h2>
      </div>

      {/* Filters */}
      <div className="bg-white border rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label htmlFor="audit-action" className="block text-xs text-gray-500 mb-1">Action</label>
          <select id="audit-action" value={actionFilter} onChange={e => setActionFilter(e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-sm">
            <option value="">Toutes</option>
            {Object.keys(ACTION_LABELS).map(a => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="audit-entity" className="block text-xs text-gray-500 mb-1">Entité</label>
          <select id="audit-entity" value={entityFilter} onChange={e => setEntityFilter(e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-sm">
            <option value="">Toutes</option>
            {["lot", "session", "sessionEvent", "downtime", "user", "equipment", "room", "product", "downtimeCategory", "cadence"].map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="audit-from" className="block text-xs text-gray-500 mb-1">Du</label>
          <input id="audit-from" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label htmlFor="audit-to" className="block text-xs text-gray-500 mb-1">Au</label>
          <input id="audit-to" type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <button onClick={() => { setActionFilter(""); setEntityFilter(""); setFromDate(""); setToDate(""); }}
          className="text-xs text-gray-500 hover:text-gray-600 px-2 py-1.5 border rounded-lg">
          Réinitialiser
        </button>
      </div>

      {loading && <TableSkeleton />}

      {!loading && (
        <>
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide">
                  <th scope="col" className="text-left px-4 py-2.5">Date / Heure</th>
                  <th scope="col" className="text-left px-4 py-2.5">Action</th>
                  <th scope="col" className="text-left px-4 py-2.5">Acteur</th>
                  <th scope="col" className="text-left px-4 py-2.5">Entité</th>
                  <th scope="col" className="text-left px-4 py-2.5">IP</th>
                  <th scope="col" className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {entries.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-500">Aucune entrée pour ces filtres.</td></tr>
                )}
                {entries.map(e => {
                  const isExpanded = expanded === e.id;
                  const actionCls = ACTION_COLOR[e.action] ?? "bg-gray-100 text-gray-700";
                  return (
                    <Fragment key={e.id}>
                      <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : e.id)}>
                        <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap font-mono">
                          {new Date(e.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${actionCls}`}>
                            {ACTION_LABELS[e.action] ?? e.action}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-700">{e.actorEmail}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">
                          {e.entityType}{e.entityId && <span className="text-gray-300 ml-1">#{e.entityId.slice(0, 8)}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 font-mono">{e.ipAddress ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-gray-500" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-500" aria-hidden="true" />}
                        </td>
                      </tr>
                      {isExpanded && e.payload && (
                        <tr>
                          <td colSpan={6} className="px-4 py-2 bg-gray-50 border-b">
                            <pre className="text-[11px] text-gray-600 whitespace-pre-wrap break-all font-mono max-h-40 overflow-auto">
                              {(() => { try { return JSON.stringify(JSON.parse(e.payload), null, 2); } catch { return e.payload; } })()}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
            <span>{entries.length === 0 ? "Aucun résultat" : `${offset + 1}–${offset + entries.length}`}</span>
            <div className="flex gap-2">
              <button disabled={offset === 0} onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
                className="flex items-center gap-1 px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Préc.
              </button>
              <button disabled={entries.length < PAGE_SIZE} onClick={() => load(offset + PAGE_SIZE)}
                className="flex items-center gap-1 px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">
                Suiv. <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
