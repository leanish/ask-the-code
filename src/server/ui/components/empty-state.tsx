export interface EmptyStateProps {
  title: string;
  body?: string;
}

export function EmptyState({ title, body }: EmptyStateProps) {
  return (
    <div class="empty-state">
      <strong>{title}</strong>
      {body ? <div>{body}</div> : null}
    </div>
  );
}
