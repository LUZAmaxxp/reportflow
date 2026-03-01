import { Skeleton } from "@/components/ui/skeleton";

type SkeletonVariant =
  | "dashboard"
  | "documents-list"
  | "observation-list"
  | "report-detail"
  | "chat"
  | "settings";

interface StatusSkeletonProps {
  variant: SkeletonVariant;
}

export default function StatusSkeleton({ variant }: StatusSkeletonProps) {
  switch (variant) {
    case "dashboard":
      return (
        <div className="space-y-6">
          <Skeleton className="h-4 w-64 rounded" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px] rounded-lg" />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-[200px] rounded-lg" />
            <Skeleton className="h-[200px] rounded-lg" />
          </div>
        </div>
      );

    case "documents-list":
      return (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full rounded" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded" />
          ))}
        </div>
      );

    case "observation-list":
      return (
        <div className="space-y-3">
          <Skeleton className="h-10 w-48 rounded" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded" />
          ))}
        </div>
      );

    case "report-detail":
      return (
        <div className="space-y-4">
          <Skeleton className="h-8 w-80 rounded" />
          <Skeleton className="h-4 w-40 rounded" />
          <Skeleton className="h-[400px] w-full rounded-lg" />
        </div>
      );

    case "chat":
      return (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
              <Skeleton className="h-12 w-3/5 rounded-lg" />
            </div>
          ))}
          <Skeleton className="h-10 w-full rounded mt-4" />
        </div>
      );

    case "settings":
      return (
        <div className="space-y-4">
          <Skeleton className="h-6 w-48 rounded" />
          <Skeleton className="h-[100px] w-full rounded-lg" />
          <Skeleton className="h-[100px] w-full rounded-lg" />
          <Skeleton className="h-[150px] w-full rounded-lg" />
        </div>
      );

    default:
      return <Skeleton className="h-[200px] w-full rounded-lg" />;
  }
}
