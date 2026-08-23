export async function loadWorkspaceApiKeys(postgres, workspaceId) {
  const result = await postgres.query(
    `select k.id, k.name, k.key_prefix, k.scopes, k.last_used_at,
            k.expires_at, k.created_at,
            count(distinct l.id)::integer as api_actions,
            count(distinct t.id)::integer as posts_created,
            (count(distinct t.id) filter (where t.status = 'scheduled'))::integer as posts_scheduled,
            (count(distinct p.id) filter (where p.status = 'live'))::integer as posts_published
     from api_keys k
     left join api_audit_logs l on l.api_key_id = k.id
     left join transmissions t
       on l.action = 'post.create'
      and l.resource_type = 'transmission'
      and t.id = l.resource_id
      and t.workspace_id = k.workspace_id
     left join projections p
       on p.transmission_id = t.id
      and p.workspace_id = k.workspace_id
     where k.workspace_id = $1 and k.revoked_at is null
     group by k.id
     order by k.created_at desc`,
    [workspaceId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    prefix: row.key_prefix,
    scopes: row.scopes,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).getTime() : undefined,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : undefined,
    createdAt: new Date(row.created_at).getTime(),
    stats: {
      apiActions: Number(row.api_actions ?? 0),
      postsCreated: Number(row.posts_created ?? 0),
      postsScheduled: Number(row.posts_scheduled ?? 0),
      postsPublished: Number(row.posts_published ?? 0),
    },
  }));
}
