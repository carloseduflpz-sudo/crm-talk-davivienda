import type { LucideIcon } from "lucide-react";
import { EmptyState, PageHeader } from "../components/ui";

/** Pantalla reservada para un módulo que llega en una fase posterior. */
export function Placeholder({ title, subtitle, icon, phase, children }: { title: string; subtitle: string; icon: LucideIcon; phase: string; children: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState icon={icon} title={`Llega en la ${phase}`}>
        {children}
      </EmptyState>
    </>
  );
}
