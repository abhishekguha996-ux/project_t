import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function subscribeToClinicChannel(
  channelName: string,
  onSubscribe?: () => void
) {
  const client = getSupabaseBrowserClient();
  const channel = client.channel(channelName);

  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      onSubscribe?.();
    }
  });

  return () => {
    void client.removeChannel(channel);
  };
}
