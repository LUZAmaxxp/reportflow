"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UploadIcon } from "lucide-react";
import Link from "next/link";
import { fr } from "@/lib/messages/fr";

/**
 * First-run welcome state and upload CTA when there are no documents.
 */
export default function OnboardingWelcomeCard() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <UploadIcon className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold mb-2">
          {fr.onboarding.welcome.title}
        </h2>
        <p className="text-sm text-muted-foreground mb-6 max-w-md">
          {fr.onboarding.welcome.description}
        </p>
        <Button asChild>
          <Link href="/documents">
            <UploadIcon className="mr-2 h-4 w-4" />
            {fr.onboarding.welcome.cta}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
