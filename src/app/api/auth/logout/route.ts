import type { NextRequest } from "next/server";
import { logout } from "@/server/auth";
import { respond } from "@/server/http";

export function POST(request: NextRequest) {
  return respond(() => logout(request));
}
