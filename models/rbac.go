package models

import "sort"

/*
Design:

Gophish implements simple Role-Based-Access-Control (RBAC) to control access to
certain resources.

By default, Gophish has two separate roles, with each user being assigned to
a single role:

* Admin  - Can modify all objects as well as system-level configuration
* User   - Can modify all objects

It's important to note that these are global roles. In the future, we'll likely
add the concept of teams, which will include their own roles and permission
system similar to these global permissions.

Each role maps to one or more permissions, making it easy to add more granular
permissions over time.

This is supported through a simple API on a user object,
`HasPermission(Permission)`, which returns a boolean and an error.
This API checks the role associated with the user to see if that role has the
requested permission.
*/

const (
	// RoleAdmin is used for Gophish system administrators. Users with this
	// role have the ability to manage all objects within Gophish, as well as
	// system-level configuration, such as users and URLs.
	RoleAdmin = "admin"
	// RoleSystemAdmin is the enterprise platform name for the built-in admin
	// role. It intentionally keeps the legacy admin slug for compatibility.
	RoleSystemAdmin = RoleAdmin
	// RoleUser is used for standard Gophish users. Users with this role can
	// create, manage, and view Gophish objects and campaigns.
	RoleUser = "user"
	// RoleSecurityManager manages enterprise security awareness operations.
	RoleSecurityManager = "security_manager"
	// RoleCampaignCreator creates campaign drafts and training assets.
	RoleCampaignCreator = "campaign_creator"
	// RoleApprover reviews and approves campaign drafts.
	RoleApprover = "approver"
	// RoleReporter reviews and exports training reports.
	RoleReporter = "reporter"
	// RoleDepartmentManager reviews department-level recipients and outcomes.
	RoleDepartmentManager = "department_manager"
	// RoleAuditor reviews audit and compliance evidence.
	RoleAuditor = "auditor"

	// PermissionViewObjects determines if a role can view standard Gophish
	// objects such as campaigns, groups, landing pages, etc.
	PermissionViewObjects = "view_objects"
	// PermissionModifyObjects determines if a role can create and modify
	// standard Gophish objects.
	PermissionModifyObjects = "modify_objects"
	// PermissionModifySystem determines if a role can manage system-level
	// configuration.
	PermissionModifySystem = "modify_system"

	// PermissionManageUsers determines if a role can manage admins and users.
	PermissionManageUsers = "manage_users"
	// PermissionManageRecipientGroups determines if a role can manage groups.
	PermissionManageRecipientGroups = "manage_recipient_groups"
	// PermissionViewRecipientPII determines if a role can view recipient PII.
	PermissionViewRecipientPII = "view_recipient_pii"
	// PermissionManageTemplates determines if a role can manage email templates.
	PermissionManageTemplates = "manage_templates"
	// PermissionManageLandingPages determines if a role can manage landing pages.
	PermissionManageLandingPages = "manage_landing_pages"
	// PermissionManageSendingProfiles determines if a role can manage profiles.
	PermissionManageSendingProfiles = "manage_sending_profiles"
	// PermissionCreateCampaignDraft determines if a role can draft campaigns.
	PermissionCreateCampaignDraft = "create_campaign_draft"
	// PermissionApproveCampaign determines if a role can approve campaigns.
	PermissionApproveCampaign = "approve_campaign"
	// PermissionLaunchCampaign determines if a role can launch campaigns.
	PermissionLaunchCampaign = "launch_campaign"
	// PermissionPauseCompleteCampaign determines if a role can pause or complete campaigns.
	PermissionPauseCompleteCampaign = "pause_complete_campaign"
	// PermissionExportReports determines if a role can export reports.
	PermissionExportReports = "export_reports"
	// PermissionManageRetentionPolicy determines if a role can manage retention policy.
	PermissionManageRetentionPolicy = "manage_retention_policy"
	// PermissionManageWebhooks determines if a role can manage webhooks.
	PermissionManageWebhooks = "manage_webhooks"
	// PermissionViewAuditLogs determines if a role can view audit logs.
	PermissionViewAuditLogs = "view_audit_logs"
	// PermissionManageTrainingContent determines if a role can manage training content.
	PermissionManageTrainingContent = "manage_training_content"
	// PermissionReviewPublishTrainingContent determines if a role can review and publish training content.
	PermissionReviewPublishTrainingContent = "review_publish_training_content"
	// PermissionAssignRemedialTraining determines if a role can assign remedial training.
	PermissionAssignRemedialTraining = "assign_remedial_training"
	// PermissionViewTrainingCompletion determines if a role can view training completion.
	PermissionViewTrainingCompletion = "view_training_completion"
)

// Role represents a user role within Gophish. Each user has a single role
// which maps to a set of permissions.
type Role struct {
	ID          int64        `json:"-"`
	Slug        string       `json:"slug"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Permissions []Permission `json:"-" gorm:"many2many:role_permissions;"`
}

// Permission determines what a particular role can do. Each role may have one
// or more permissions.
type Permission struct {
	ID          int64  `json:"id"`
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// GetRoleBySlug returns a role that can be assigned to a user.
func GetRoleBySlug(slug string) (Role, error) {
	role := Role{}
	err := db.Where("slug=?", slug).First(&role).Error
	return role, err
}

func (u *User) roleID() int64 {
	if u.RoleID != 0 {
		return u.RoleID
	}
	return u.Role.ID
}

// GetPermissions returns the permissions associated with the user's role.
func (u *User) GetPermissions() ([]Permission, error) {
	perm := []Permission{}
	err := db.Model(Role{ID: u.roleID()}).Association("Permissions").Find(&perm).Error
	return perm, err
}

// GetPermissionSlugs returns a stable, sorted list of permission slugs for the
// user's role. This is intended for API/UI introspection, not authorization
// decisions.
func (u *User) GetPermissionSlugs() ([]string, error) {
	perm, err := u.GetPermissions()
	if err != nil {
		return nil, err
	}
	slugs := make([]string, 0, len(perm))
	for _, p := range perm {
		slugs = append(slugs, p.Slug)
	}
	sort.Strings(slugs)
	return slugs, nil
}

// HasPermission checks to see if the user has a role with the requested
// permission.
func (u *User) HasPermission(slug string) (bool, error) {
	return u.HasAnyPermission(slug)
}

// HasAnyPermission checks if the user's role has at least one of the requested
// permissions.
func (u *User) HasAnyPermission(slugs ...string) (bool, error) {
	if len(slugs) == 0 {
		return false, nil
	}
	perm := []Permission{}
	err := db.Model(Role{ID: u.roleID()}).Where("slug IN (?)", slugs).Association("Permissions").Find(&perm).Error
	if err != nil {
		return false, err
	}
	// Gorm doesn't return an ErrRecordNotFound whe scanning into a slice, so
	// we need to check the length (ref jinzhu/gorm#228)
	if len(perm) == 0 {
		return false, nil
	}
	return true, nil
}

// HasAllPermissions checks if the user's role has every requested permission.
func (u *User) HasAllPermissions(slugs ...string) (bool, error) {
	if len(slugs) == 0 {
		return true, nil
	}
	perm, err := u.GetPermissions()
	if err != nil {
		return false, err
	}
	have := map[string]bool{}
	for _, p := range perm {
		have[p.Slug] = true
	}
	for _, slug := range slugs {
		if !have[slug] {
			return false, nil
		}
	}
	return true, nil
}
