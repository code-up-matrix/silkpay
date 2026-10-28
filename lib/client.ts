export async function api<T = Record<string, unknown>>(
  path: string,
  data?: unknown,
  method?: string,
): Promise<T> {
  const multipart = data instanceof FormData;
  const response = await fetch("/api/" + path, {
    method: method || (data === undefined ? "GET" : "POST"),
    headers:
      data === undefined || multipart
        ? {}
        : { "Content-Type": "application/json" },
    body:
      data === undefined ? undefined : multipart ? data : JSON.stringify(data),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({
    error: "The service could not respond. Please try again.",
  }));
  if (!response.ok)
    throw new Error(result.error || "The request could not be completed.");
  return result;
}
export function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
