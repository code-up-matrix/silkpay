"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone">
      <h1>Let’s try that again.</h1>
      <p>The workspace could not load. No payment status has been assumed.</p>
      <Button onClick={reset}>Reload workspace</Button>
    </main>
  );
}
