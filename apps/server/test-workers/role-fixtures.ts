import { env } from "cloudflare:test";

/** Demote the resolved caller to a plain member so an owner/admin gate rejects them (E8.2 tests). */
export const demoteToMember = (memberId: string) =>
  env.DB.prepare("UPDATE member SET role = 'member' WHERE id = ?1")
    .bind(memberId)
    .run();
