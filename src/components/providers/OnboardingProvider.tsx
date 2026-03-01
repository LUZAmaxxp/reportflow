"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePipelineSSE } from "@/components/pipeline/PipelineSSEProvider";

interface OnboardingStep {
  key: "first_login" | "first_extraction" | "first_report";
  completed: boolean;
}

interface OnboardingContextValue {
  steps: OnboardingStep[];
  dismissed: boolean;
  dismiss: () => void;
  completeStep: (key: OnboardingStep["key"]) => void;
}

const OnboardingContext = createContext<OnboardingContextValue>({
  steps: [],
  dismissed: false,
  dismiss: () => {},
  completeStep: () => {},
});

export function useOnboarding() {
  return useContext(OnboardingContext);
}

function getStorageKey(userId: string) {
  return `reportflow:onboarding:${userId}`;
}

interface OnboardingProviderProps {
  children: ReactNode;
  userId: string;
}

export default function OnboardingProvider({ children, userId }: OnboardingProviderProps) {
  const { subscribe } = usePipelineSSE();
  const [steps, setSteps] = useState<OnboardingStep[]>([
    { key: "first_login", completed: false },
    { key: "first_extraction", completed: false },
    { key: "first_report", completed: false },
  ]);
  const [dismissed, setDismissed] = useState(false);

  // Load persisted state from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(getStorageKey(userId));
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.dismissed) setDismissed(true);
        if (Array.isArray(parsed.steps)) setSteps(parsed.steps);
      }
    } catch {}
  }, [userId]);

  const persist = useCallback(
    (newSteps: OnboardingStep[], newDismissed: boolean) => {
      try {
        localStorage.setItem(
          getStorageKey(userId),
          JSON.stringify({ steps: newSteps, dismissed: newDismissed })
        );
      } catch {}
    },
    [userId]
  );

  const dismiss = useCallback(() => {
    setDismissed(true);
    persist(steps, true);
  }, [steps, persist]);

  const completeStep = useCallback(
    (key: OnboardingStep["key"]) => {
      setSteps((prev) => {
        const updated = prev.map((s) =>
          s.key === key ? { ...s, completed: true } : s
        );
        persist(updated, dismissed);
        return updated;
      });
    },
    [dismissed, persist]
  );

  // Auto-complete first_login on mount
  useEffect(() => {
    completeStep("first_login");
  }, [completeStep]);

  // Listen for SSE events to auto-complete steps
  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      if (event.type === "extraction_complete") {
        completeStep("first_extraction");
      }
      if ((event as any).type === "notification") {
        const payload = event as any;
        if (payload.notificationType === "report_ready") {
          completeStep("first_report");
        }
      }
    });
    return unsubscribe;
  }, [subscribe, completeStep]);

  return (
    <OnboardingContext.Provider value={{ steps, dismissed, dismiss, completeStep }}>
      {children}
    </OnboardingContext.Provider>
  );
}
