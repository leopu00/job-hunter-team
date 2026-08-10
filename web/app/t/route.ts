import { handleCampaignHit } from "@/lib/campaign-landing";

// Porta d'ingresso degli annunci TikTok. Vedi `/r`: stessa logica condivisa.
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleCampaignHit("t", request);
}

export function HEAD(request: Request) {
  return handleCampaignHit("t", request);
}
