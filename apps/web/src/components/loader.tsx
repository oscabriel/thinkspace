import { Loader2 } from "lucide-react";

export default function Loader() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Loader2
        aria-label="Loading"
        className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
      />
    </div>
  );
}
