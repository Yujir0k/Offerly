import { currentAccount } from "@/lib/auth";
import { query } from "@/db";
import { fspConfiguration } from "@/lib/fsp-oidc";
import { fspMessages } from "@/lib/fsp-errors";
export const dynamic = "force-dynamic";
export async function GET() {
  let available = false,
    issuer = "";
  try {
    issuer = fspConfiguration().issuer;
    available = true;
  } catch {}
  const account = await currentAccount();
  const link =
    account && !account.demo && issuer
      ? (
          await query(
            "SELECT participant_id,linked_at FROM external_identities WHERE user_id=$1 AND issuer=$2",
            [account.id, issuer],
          )
        ).rows[0]
      : null;
  return Response.json(
    {
      provider: "ФСП ID",
      available,
      linked: !!link,
      participantId: link?.participant_id || null,
      linkedAt: link?.linked_at || null,
      message: available ? null : fspMessages.unavailable,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
