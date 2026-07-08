-- +goose Up
-- SQL in section 'Up' is executed when this migration is applied

UPDATE "roles"
SET "name" = '系統管理員',
    "description" = 'System Admin role with full enterprise platform permissions'
WHERE "slug" = 'admin';

UPDATE "roles"
SET "name" = '一般使用者（舊版）',
    "description" = 'Legacy user role kept for backward compatibility'
WHERE "slug" = 'user';

INSERT INTO "roles" ("slug", "name", "description")
SELECT 'security_manager', '資安管理者', 'Security Manager role for security awareness operations'
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "slug" = 'security_manager');

INSERT INTO "roles" ("slug", "name", "description")
SELECT 'campaign_creator', '演練建立者', 'Campaign Creator role for drafts and training assets'
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "slug" = 'campaign_creator');

INSERT INTO "roles" ("slug", "name", "description")
SELECT 'approver', '審核者', 'Approver role for reviewing campaign readiness'
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "slug" = 'approver');

INSERT INTO "roles" ("slug", "name", "description")
SELECT 'reporter', '報表檢視者', 'Reporter role for report review and export'
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "slug" = 'reporter');

INSERT INTO "roles" ("slug", "name", "description")
SELECT 'department_manager', '部門主管', 'Department Manager role for department-level review'
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "slug" = 'department_manager');

INSERT INTO "roles" ("slug", "name", "description")
SELECT 'auditor', '稽核員', 'Auditor role for audit and compliance review'
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "slug" = 'auditor');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'manage_users', '管理使用者與管理員', 'Manage users and administrators'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'manage_users');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'manage_recipient_groups', '管理受測對象群組', 'Manage recipient groups'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'manage_recipient_groups');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'view_recipient_pii', '檢視受測對象個資', 'View recipient personally identifiable information'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'view_recipient_pii');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'manage_templates', '管理郵件模板', 'Create, edit, and delete email templates'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'manage_templates');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'manage_landing_pages', '管理教育頁與演練頁', 'Create, edit, and delete landing pages'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'manage_landing_pages');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'manage_sending_profiles', '管理寄送設定', 'Create, edit, and delete sending profiles'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'manage_sending_profiles');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'create_campaign_draft', '建立演練草稿', 'Create campaign drafts'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'create_campaign_draft');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'approve_campaign', '審核演練活動', 'Approve campaign drafts'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'approve_campaign');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'launch_campaign', '啟動演練活動', 'Launch campaigns'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'launch_campaign');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'pause_complete_campaign', '暫停或完成演練活動', 'Pause or complete campaigns'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'pause_complete_campaign');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'export_reports', '匯出報表', 'Export reports'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'export_reports');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'manage_retention_policy', '管理資料保留政策', 'Manage retention policy'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'manage_retention_policy');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'manage_webhooks', '管理 Webhooks', 'Manage webhooks'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'manage_webhooks');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'view_audit_logs', '檢視稽核紀錄', 'View audit logs'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'view_audit_logs');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'manage_training_content', '管理訓練內容', 'Manage training content'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'manage_training_content');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'review_publish_training_content', '審核與發布訓練內容', 'Review and publish training content'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'review_publish_training_content');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'assign_remedial_training', '指派補強訓練', 'Assign remedial training'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'assign_remedial_training');

INSERT INTO "permissions" ("slug", "name", "description")
SELECT 'view_training_completion', '檢視訓練完成狀態', 'View training completion'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'view_training_completion');

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" AS r, "permissions" AS p
WHERE r.slug = 'admin'
AND p.slug IN (
    'view_objects', 'modify_objects', 'modify_system',
    'manage_users', 'manage_recipient_groups', 'view_recipient_pii',
    'manage_templates', 'manage_landing_pages', 'manage_sending_profiles',
    'create_campaign_draft', 'approve_campaign', 'launch_campaign',
    'pause_complete_campaign', 'export_reports', 'manage_retention_policy',
    'manage_webhooks', 'view_audit_logs', 'manage_training_content',
    'review_publish_training_content', 'assign_remedial_training',
    'view_training_completion'
)
AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" AS rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" AS r, "permissions" AS p
WHERE r.slug = 'user'
AND p.slug IN (
    'view_objects', 'modify_objects',
    'manage_recipient_groups', 'manage_templates', 'manage_landing_pages',
    'manage_sending_profiles', 'create_campaign_draft', 'launch_campaign',
    'pause_complete_campaign', 'export_reports'
)
AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" AS rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" AS r, "permissions" AS p
WHERE r.slug = 'security_manager'
AND p.slug IN (
    'view_objects', 'modify_objects', 'manage_recipient_groups',
    'view_recipient_pii', 'manage_templates', 'manage_landing_pages',
    'manage_sending_profiles', 'create_campaign_draft', 'approve_campaign',
    'launch_campaign', 'pause_complete_campaign', 'export_reports',
    'manage_retention_policy', 'manage_webhooks', 'view_audit_logs',
    'manage_training_content', 'review_publish_training_content',
    'assign_remedial_training', 'view_training_completion'
)
AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" AS rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" AS r, "permissions" AS p
WHERE r.slug = 'campaign_creator'
AND p.slug IN (
    'view_objects', 'modify_objects', 'manage_recipient_groups',
    'view_recipient_pii', 'manage_templates', 'manage_landing_pages',
    'manage_sending_profiles', 'create_campaign_draft',
    'manage_training_content'
)
AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" AS rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" AS r, "permissions" AS p
WHERE r.slug = 'approver'
AND p.slug IN (
    'view_objects', 'modify_objects', 'view_recipient_pii',
    'approve_campaign', 'launch_campaign', 'pause_complete_campaign',
    'export_reports', 'review_publish_training_content'
)
AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" AS rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" AS r, "permissions" AS p
WHERE r.slug = 'reporter'
AND p.slug IN ('view_objects', 'export_reports', 'view_training_completion')
AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" AS rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" AS r, "permissions" AS p
WHERE r.slug = 'department_manager'
AND p.slug IN (
    'view_objects', 'view_recipient_pii', 'export_reports',
    'assign_remedial_training', 'view_training_completion'
)
AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" AS rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" AS r, "permissions" AS p
WHERE r.slug = 'auditor'
AND p.slug IN (
    'view_objects', 'export_reports', 'view_audit_logs',
    'view_training_completion'
)
AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" AS rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

-- +goose Down
-- SQL section 'Down' is executed when this migration is rolled back

DELETE FROM "role_permissions"
WHERE "permission_id" IN (
    SELECT "id" FROM "permissions"
    WHERE "slug" IN (
        'manage_users', 'manage_recipient_groups', 'view_recipient_pii',
        'manage_templates', 'manage_landing_pages', 'manage_sending_profiles',
        'create_campaign_draft', 'approve_campaign', 'launch_campaign',
        'pause_complete_campaign', 'export_reports', 'manage_retention_policy',
        'manage_webhooks', 'view_audit_logs', 'manage_training_content',
        'review_publish_training_content', 'assign_remedial_training',
        'view_training_completion'
    )
)
OR "role_id" IN (
    SELECT "id" FROM "roles"
    WHERE "slug" IN (
        'security_manager', 'campaign_creator', 'approver', 'reporter',
        'department_manager', 'auditor'
    )
);

DELETE FROM "permissions"
WHERE "slug" IN (
    'manage_users', 'manage_recipient_groups', 'view_recipient_pii',
    'manage_templates', 'manage_landing_pages', 'manage_sending_profiles',
    'create_campaign_draft', 'approve_campaign', 'launch_campaign',
    'pause_complete_campaign', 'export_reports', 'manage_retention_policy',
    'manage_webhooks', 'view_audit_logs', 'manage_training_content',
    'review_publish_training_content', 'assign_remedial_training',
    'view_training_completion'
);

DELETE FROM "roles"
WHERE "slug" IN (
    'security_manager', 'campaign_creator', 'approver', 'reporter',
    'department_manager', 'auditor'
);
