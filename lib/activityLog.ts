import { type NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

export type ActivityActionType =
  | "claim_create"
  | "claim_delete"
  | "dismiss_create"
  | "dismiss_delete"
  | "anchor_create"
  | "anchor_delete"
  | "transfer_claim_create"
  | "transfer_claim_delete"
  | "user_dismiss_create"
  | "user_dismiss_delete";

export type ActivityActor = "user" | "auto";

export type ActivityPayload = Record<string, unknown>;

export async function insertActivityLog(
  sql: Sql,
  params: {
    id: string;
    action_type: ActivityActionType;
    actor: ActivityActor;
    csv_upload_id?: string | null;
    bulk_action_id?: string | null;
    parent_action_id?: string | null;
    payload: ActivityPayload;
  }
): Promise<void> {
  await sql`
    INSERT INTO reconciliation_activity_log
      (id, action_type, actor, csv_upload_id, bulk_action_id, parent_action_id, payload)
    VALUES
      (${params.id}::uuid,
       ${params.action_type},
       ${params.actor},
       ${params.csv_upload_id ?? null}::uuid,
       ${params.bulk_action_id ?? null}::uuid,
       ${params.parent_action_id ?? null}::uuid,
       ${params.payload})
  `;
}
