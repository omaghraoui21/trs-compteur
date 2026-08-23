import { type LucideIcon } from "lucide-react";

export default function EmptyState({ icon: Icon, iconCls = "text-gray-300", title, description }: {
  icon: LucideIcon;
  iconCls?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="bg-white rounded-xl border p-12 text-center">
      <Icon className={`h-12 w-12 mx-auto mb-3 ${iconCls}`} aria-hidden="true" />
      <p className="font-semibold text-gray-700">{title}</p>
      {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
    </div>
  );
}
