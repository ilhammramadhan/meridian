import { Button } from "@/components/ui/button";

export function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Prev
      </Button>
      <span className="px-2 text-sm text-muted-foreground">
        {page} / {pageCount}
      </span>
      <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
        Next
      </Button>
    </div>
  );
}
