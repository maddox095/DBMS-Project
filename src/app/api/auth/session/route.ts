import type { NextRequest } from "next/server";
import { authenticatedSession } from "@/server/auth";
import { json, respond } from "@/server/http";

export function GET(request: NextRequest) {
  return respond(async () => {
    const session = await authenticatedSession(request);
    const response = json(session ?? { user: null, organization: null });
    response.cookies.set("exchange_demo", "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    if (!session)
      response.cookies.set("exchange_session", "", {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 0,
      });
    return response;
  });
}
