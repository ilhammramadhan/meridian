export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
