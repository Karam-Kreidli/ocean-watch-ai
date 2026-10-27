import type { ReactNode } from "react";

/** Login and sign-up: on wide screens a still from survey footage beside the form; phones get the form only. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lg:grid lg:grid-cols-2">
      <aside className="relative hidden h-screen overflow-hidden lg:sticky lg:top-0 lg:block">
        {/* the mask fades the right edge into whatever the page shows there, so there's no seam */}
        <div className="absolute inset-0 [mask-image:linear-gradient(to_right,black_45%,transparent)]">
          <img src="/auth-still.jpg" alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-background/50" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/50" />
        </div>
        <div className="absolute inset-x-12 bottom-12 max-w-md space-y-3">
          <p className="font-display text-4xl leading-tight">Every fish in the frame, found, followed and named.</p>
          <p className="text-xs text-muted-foreground">Footage: OzFish dataset, AIMS (CC BY 3.0 AU)</p>
        </div>
      </aside>
      {children}
    </div>
  );
}
