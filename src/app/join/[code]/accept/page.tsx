import { AcceptInviteClient } from "@/components/join/accept-invite-client";

export default async function AcceptInvitePage({
  params
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-6 py-10">
      <AcceptInviteClient code={code.toUpperCase()} />
    </main>
  );
}
