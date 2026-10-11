import { demoFspStatus } from '@/lib/fsp-demo';
export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json(await demoFspStatus(), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
