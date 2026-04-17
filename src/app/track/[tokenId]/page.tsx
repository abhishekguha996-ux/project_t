import { PatientTrackClient } from "@/components/patient/patient-track-client";

export const dynamic = "force-dynamic";

export default async function TrackPage({
  params
}: {
  params: Promise<{ tokenId: string }>;
}) {
  const { tokenId } = await params;

  return <PatientTrackClient tokenId={tokenId} />;
}
