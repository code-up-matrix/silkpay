import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone">
      <h1>This page isn’t here.</h1>
      <p>Your purchase orders are in your workspace.</p>
      <Link className="button button-primary" href="/">
        Go to workspace
      </Link>
    </main>
  );
}
