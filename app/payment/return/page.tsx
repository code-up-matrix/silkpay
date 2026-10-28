"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { api } from "@/lib/client";
export default function PaymentReturn() {
  const started = useRef(false);
  const [result, setResult] = useState<"loading" | "success" | "error">(
      "loading",
    ),
    [message, setMessage] = useState(
      "Checking the approval directly with PayPal Sandbox.",
    );
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const p = new URLSearchParams(window.location.search),
      milestone = p.get("milestone"),
      orderId = p.get("token");
    if (!milestone || !orderId) {
      setResult("error");
      setMessage(
        "The approval return is incomplete. Open your order and refresh the payment status.",
      );
      return;
    }
    api(
      p.get("intent") === "CAPTURE"
        ? "paypal/approve-order"
        : `milestones/${encodeURIComponent(milestone)}/authorize`,
      p.get("intent") === "CAPTURE"
        ? { milestoneId: milestone, orderId }
        : { orderId },
    )
      .then(() => {
        setResult("success");
        setMessage(
          p.get("intent") === "CAPTURE"
            ? "PayPal Sandbox confirmed checkout approval. Funds have not been captured or held. Submit supplier evidence, complete inspection, then confirm capture within the checkout window."
            : "PayPal Sandbox confirmed the payment hold. Your supplier can now submit evidence for review. No settlement has been assumed.",
        );
        window.history.replaceState(null, "", "/payment/return");
      })
      .catch((e) => {
        setResult("error");
        setMessage(e.message);
      });
  }, [started]);
  return (
    <main className="standalone">
      <Brand />
      <div className="status-symbol">
        {result === "loading" ? (
          <LoaderCircle size={27} className="spin" />
        ) : result === "success" ? (
          <CheckCircle2 size={29} />
        ) : (
          <TriangleAlert size={28} />
        )}
      </div>
      <h1>
        {result === "loading"
          ? "Confirming your checkout…"
          : result === "success"
            ? "Your checkout is confirmed."
            : "Approval needs attention."}
      </h1>
      <p role="status">{message}</p>
      <Link className="button button-primary" href="/">
        Return to workspace <ArrowRight size={16} />
      </Link>
    </main>
  );
}
