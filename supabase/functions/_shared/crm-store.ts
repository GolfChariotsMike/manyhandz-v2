/**
 * Service-role helpers for mh_crm_connections.
 * Public select never returns encrypted columns.
 */

export type CrmConnectionRow = {
  id: string;
  customer_id: string;
  platform: string;
  is_active: boolean | null;
  last_synced_at: string | null;
  jobs_synced_count: number | null;
  oauth_account_id?: string | null;
  oauth_account_name?: string | null;
  oauth_access_token_encrypted?: string | null;
  oauth_refresh_token_encrypted?: string | null;
  oauth_token_expires_at?: string | null;
  servicem8_api_key_encrypted?: string | null;
};

export const PUBLIC_CONNECTION_COLUMNS =
  "id,customer_id,platform,is_active,last_synced_at,jobs_synced_count,oauth_account_id,oauth_account_name";

export const SECRET_CONNECTION_COLUMNS =
  `${PUBLIC_CONNECTION_COLUMNS},servicem8_api_key_encrypted,oauth_access_token_encrypted,oauth_refresh_token_encrypted,oauth_token_expires_at`;

export function publicConnection(row: Record<string, unknown>) {
  return {
    id: row.id,
    customer_id: row.customer_id,
    platform: row.platform,
    is_active: row.is_active,
    last_synced_at: row.last_synced_at ?? null,
    jobs_synced_count: row.jobs_synced_count ?? 0,
    account_name: row.oauth_account_name ?? null,
    account_id: row.oauth_account_id ?? null,
  };
}

export type AdminLike = {
  from(table: string): {
    select(cols: string): Query;
    upsert(row: Record<string, unknown>, opts?: Record<string, unknown>): Query;
    update(row: Record<string, unknown>): Query;
  };
};

type Query = {
  eq(col: string, val: unknown): Query;
  in(col: string, val: unknown[]): Query;
  maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
  then?: (resolve: (v: { data: unknown; error: { message: string } | null }) => void) => Promise<unknown>;
};

export async function loadActivePlatform(
  admin: AdminLike,
  customerId: string,
  platform: string,
  columns = SECRET_CONNECTION_COLUMNS,
): Promise<CrmConnectionRow | null> {
  const { data, error } = await admin
    .from("mh_crm_connections")
    .select(columns)
    .eq("customer_id", customerId)
    .eq("platform", platform)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;
  return data as CrmConnectionRow;
}
