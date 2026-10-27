"use client";
import { useEffect, useState } from "react";
import { ArrowRight, ShieldCheck, LoaderCircle } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client";
export default function Invite() {
  const [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    if (value) setToken(value);
    else
      setError("This invitation is incomplete. Ask your buyer for a new link.");
  }, []);
  async function join() {
    setBusy(true);
    setError("");
    try {
      await api("invitations/join", { token });
      window.history.replaceState(null, "", "/invite");
      window.location.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to open invitation.");
      setBusy(false);
    }
  }
  return (
    <main className="standalone">
      <Brand />
      <div className="status-symbol">
        <ShieldCheck size={29} />
      </div>
      <h1>
        A shared view.
        <br />A smoother partnership.
      </h1>
      <p>
        Your buyer invited you to a SilkPay Sandbox purchase order. Join to view
        the agreed specifications, upload fulfillment proof and follow each
        milestone.
      </p>
      <div className="info-box">
        <ShieldCheck size={20} />
        <p>
          This one-time link gives access to one order for seven days. Joining
          replaces any SilkPay workspace session in this browser. Use a separate
          browser profile when testing buyer and supplier roles.
        </p>
      </div>
      {error && (
        <div className="warning-box" role="alert">
          {error}
        </div>
      )}
      <Button
        style={{ marginTop: 22 }}
        disabled={!token || busy}
        onClick={join}
      >
        {busy ? (
          <LoaderCircle className="spin" size={17} />
        ) : (
          <>
            Join as supplier <ArrowRight size={16} />
          </>
        )}
      </Button>
    </main>
  );
}
