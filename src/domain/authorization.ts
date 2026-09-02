import type { AccessRole } from "../infrastructure/platform-store.js";

export type Permission =
  | "manage_settings"
  | "manage_users"
  | "manage_audiences"
  | "view_audiences"
  | "manage_templates"
  | "view_templates"
  | "review_templates"
  | "manage_connectors"
  | "view_connectors"
  | "manage_campaigns"
  | "view_campaigns"
  | "review_campaigns"
  | "operate_delivery"
  | "view_reports"
  | "generate_reports"
  | "view_scope_settings"
  | "import_evidence"
  | "export_audit";

const ROLE_PERMISSIONS: Record<AccessRole, ReadonlySet<Permission>> = {
  system_admin: new Set<Permission>([
    "manage_settings",
    "manage_users",
    "manage_audiences",
    "view_audiences",
    "manage_templates",
    "view_templates",
    "review_templates",
    "manage_connectors",
    "view_connectors",
    "manage_campaigns",
    "view_campaigns",
    "review_campaigns",
    "operate_delivery",
    "view_reports",
    "generate_reports",
    "view_scope_settings",
    "import_evidence",
    "export_audit",
  ]),
  campaign_creator: new Set<Permission>([
    "manage_audiences",
    "view_audiences",
    "manage_templates",
    "view_templates",
    "manage_campaigns",
    "view_campaigns",
    "view_connectors",
    "view_reports",
  ]),
  reviewer: new Set<Permission>([
    "review_templates",
    "view_templates",
    "review_campaigns",
    "view_campaigns",
    "view_reports",
  ]),
  report_viewer: new Set<Permission>(["view_campaigns", "view_reports", "generate_reports"]),
};

export function roleHasPermission(role: AccessRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
