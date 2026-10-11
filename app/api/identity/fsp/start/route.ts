import { fspStartResponse } from "@/lib/fsp-http";
export async function POST(request: Request) {
  return fspStartResponse(request);
}
