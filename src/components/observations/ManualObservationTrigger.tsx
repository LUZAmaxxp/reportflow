"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import ManualObservationForm from "@/components/observations/ManualObservationForm";

export default function ManualObservationTrigger() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon className="mr-1 h-4 w-4" />
        Ajouter manuellement
      </Button>
      <ManualObservationForm
        open={open}
        onOpenChange={setOpen}
        onSuccess={() => {
          // Trigger page refresh by navigating (server component will re-render)
          window.location.reload();
        }}
      />
    </>
  );
}
