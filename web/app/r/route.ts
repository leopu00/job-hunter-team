import { handleCampaignHit } from "@/lib/campaign-landing";

// Porta d'ingresso degli annunci Reddit. La logica sta in `campaign-landing`
// perché /r e /t devono comportarsi in modo identico: due copie divergerebbero.
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleCampaignHit("r", request);
}

export function HEAD(request: Request) {
  return handleCampaignHit("r", request);
}
