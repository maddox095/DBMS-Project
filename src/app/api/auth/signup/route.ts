import type { NextRequest } from "next/server";
import { signup } from "@/server/auth";
import { respond } from "@/server/http";

export function POST(request: NextRequest) {
  return respond(() => signup(request));
}
