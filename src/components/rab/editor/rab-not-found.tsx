import { FileQuestion } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ButtonLink } from "@/components/ui/button";

/** Shown when the requested RAB document id does not exist. */
export function RabNotFound({ id }: { id: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface shadow-card">
      <EmptyState
        icon={FileQuestion}
        title="Dokumen RAB tidak ditemukan"
        description={`Dokumen dengan ID "${id}" tidak tersedia. Mungkin sudah dihapus atau tautannya salah.`}
        action={
          <ButtonLink href="/rab" variant="secondary">
            Kembali ke daftar RAB
          </ButtonLink>
        }
      />
    </div>
  );
}
