import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircleIcon } from "lucide-react";
import { fr } from "@/lib/messages/fr";

interface ErrorAlertProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  supportLink?: string;
}

export default function ErrorAlert({
  title,
  message,
  onRetry,
  supportLink,
}: ErrorAlertProps) {
  return (
    <Alert variant="destructive">
      <AlertCircleIcon className="h-4 w-4" />
      <AlertTitle>{title ?? fr.errors.title}</AlertTitle>
      <AlertDescription className="mt-2">
        <p>{message}</p>
        <div className="mt-3 flex gap-2">
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {fr.common.retry}
            </Button>
          )}
          {supportLink && (
            <Button variant="link" size="sm" asChild>
              <a href={supportLink} target="_blank" rel="noopener noreferrer">
                {fr.errors.support}
              </a>
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
