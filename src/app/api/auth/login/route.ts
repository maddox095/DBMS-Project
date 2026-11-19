import type { NextRequest } from "next/server";
import { login } from "@/server/auth";
import { respond } from "@/server/http";

export function POST(request: NextRequest) {
  return respond(() => login(request));
}
