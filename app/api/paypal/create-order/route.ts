import { checkout } from "@/lib/checkout";
export const runtime = "nodejs";
export const maxDuration = 120;
export const POST = (request: Request) => checkout(request, "create");
