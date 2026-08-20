import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while a route segment streams in.
 *
 * The shapes deliberately match the dashboard's real layout so the transition
 * settles rather than reflows — a generic spinner would be less work and a
 * worse experience.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8" aria-busy>
      <span className="sr-only" role="status">
        Loading
      </span>

      <div className="mb-6 space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[74px] rounded-xl" />
        ))}
      </div>

      <Skeleton className="mb-3 h-4 w-24" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-[118px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
