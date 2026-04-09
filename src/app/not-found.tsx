export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-12">
      <div>
        <h1 className="text-3xl font-semibold">Page unavailable</h1>
        <p className="mt-4 text-muted-foreground">
          This route is either protected or not part of the current phase.
        </p>
      </div>
    </main>
  );
}
