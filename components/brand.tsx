export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "brand-small" : ""}`}>
      <svg
        width="32"
        height="36"
        viewBox="0 0 32 36"
        fill="none"
        aria-hidden="true"
      >
        <path d="M10 3h18l-5 9H13l-3 5H0L10 3Z" fill="#0070BA" />
        <path d="M22 33H4l5-9h10l3-5h10L22 33Z" fill="#003087" />
        <path d="m10 17 13-5-1 7-13 5 1-7Z" fill="#53B6DF" />
      </svg>
      <span>
        silk<span>pay</span>
        <span className="brand-dot">.</span>
      </span>
    </span>
  );
}
export function ProductArt({ product }: { product: string }) {
  let kind = product.toLowerCase();
  return (
    <span
      className={`product-art ${kind.includes("ceramic") ? "art-sand" : kind.includes("bottle") ? "art-mint" : kind.includes("tote") ? "art-rose" : "art-blue"}`}
    >
      <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
        {kind.includes("ceramic") ? (
          <>
            <path
              d="M16 20h30L36 39H27L16 20Z"
              fill="#D8C0A5"
              stroke="#9F7F60"
              strokeWidth="1.5"
            />
            <path
              d="M22 42h22l-3 12H25l-3-12Z"
              fill="#F8F3E9"
              stroke="#9F7F60"
              strokeWidth="1.5"
            />
            <path d="M44 43h4c6 0 5 7-5 7" stroke="#9F7F60" strokeWidth="2" />
            <ellipse
              cx="31"
              cy="20"
              rx="15"
              ry="4"
              fill="#EAD9C4"
              stroke="#9F7F60"
              strokeWidth="1.5"
            />
          </>
        ) : kind.includes("bottle") ? (
          <>
            <rect
              x="24"
              y="15"
              width="17"
              height="39"
              rx="6"
              fill="#A7BBB7"
              stroke="#607E78"
              strokeWidth="1.5"
            />
            <rect x="27" y="10" width="11" height="7" rx="2" fill="#526B65" />
            <path
              d="M29 24v22"
              stroke="#DFE8E5"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </>
        ) : kind.includes("tote") ? (
          <>
            <path
              d="m16 25 3 29h28l2-29H16Z"
              fill="#E5D5C3"
              stroke="#AF9580"
              strokeWidth="1.5"
            />
            <path
              d="M25 29V17c0-10 15-10 15 0v12"
              stroke="#AF9580"
              strokeWidth="3"
            />
            <path d="M29 39h8M33 35v8" stroke="#939F85" strokeWidth="2" />
          </>
        ) : kind.includes("linen") ? (
          <>
            <path
              d="m14 22 31-7 7 33-31 7-7-33Z"
              fill="#E2DCCF"
              stroke="#AD9D84"
              strokeWidth="1.5"
            />
            <path
              d="m14 22 11 6 20-13M25 28l-4 27M25 28l27 20"
              stroke="#C4B59D"
              strokeWidth="1.2"
            />
          </>
        ) : (
          <>
            <path
              d="m23 13-14 9 7 12 8-5v25h22V29l7 5 7-12-15-9c-6 7-16 7-22 0Z"
              transform="translate(-3 0)"
              fill="#D9E4DF"
              stroke="#8FA99E"
              strokeWidth="1.5"
            />
            <path
              d="M20 13c1 10 19 10 22 0"
              stroke="#8FA99E"
              strokeWidth="1.5"
            />
            <path d="M23 45h18" stroke="#B8CBC1" />
          </>
        )}
      </svg>
    </span>
  );
}
