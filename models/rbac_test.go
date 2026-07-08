package models

import (
	"fmt"

	check "gopkg.in/check.v1"
)

type PermissionCheck map[string]bool

func (s *ModelsSuite) TestHasPermission(c *check.C) {

	permissionTests := map[string]PermissionCheck{
		RoleAdmin: PermissionCheck{
			PermissionModifySystem:  true,
			PermissionModifyObjects: true,
			PermissionViewObjects:   true,
			PermissionManageUsers:   true,
			PermissionManageWebhooks: true,
			PermissionApproveCampaign: true,
			PermissionManageTrainingContent: true,
			PermissionReviewPublishTrainingContent: true,
			PermissionAssignRemedialTraining: true,
			PermissionViewTrainingCompletion: true,
		},
		RoleUser: PermissionCheck{
			PermissionModifySystem:  false,
			PermissionModifyObjects: true,
			PermissionViewObjects:   true,
			PermissionManageUsers:   false,
			PermissionManageWebhooks: false,
			PermissionCreateCampaignDraft: true,
			PermissionManageTrainingContent: false,
		},
		RoleSecurityManager: PermissionCheck{
			PermissionModifySystem:  false,
			PermissionModifyObjects: true,
			PermissionViewObjects:   true,
			PermissionManageUsers:   false,
			PermissionManageWebhooks: true,
			PermissionApproveCampaign: true,
			PermissionManageTrainingContent: true,
			PermissionReviewPublishTrainingContent: true,
			PermissionAssignRemedialTraining: true,
			PermissionViewTrainingCompletion: true,
		},
		RoleCampaignCreator: PermissionCheck{
			PermissionModifyObjects: true,
			PermissionManageTemplates: true,
			PermissionCreateCampaignDraft: true,
			PermissionApproveCampaign: false,
			PermissionManageTrainingContent: true,
			PermissionReviewPublishTrainingContent: false,
		},
		RoleApprover: PermissionCheck{
			PermissionModifyObjects: true,
			PermissionApproveCampaign: true,
			PermissionCreateCampaignDraft: false,
			PermissionReviewPublishTrainingContent: true,
		},
		RoleReporter: PermissionCheck{
			PermissionModifyObjects: false,
			PermissionExportReports: true,
			PermissionViewAuditLogs: false,
			PermissionViewTrainingCompletion: true,
			PermissionManageTrainingContent: false,
		},
		RoleDepartmentManager: PermissionCheck{
			PermissionViewRecipientPII: true,
			PermissionExportReports: true,
			PermissionManageRecipientGroups: false,
			PermissionAssignRemedialTraining: true,
			PermissionViewTrainingCompletion: true,
		},
		RoleAuditor: PermissionCheck{
			PermissionViewAuditLogs: true,
			PermissionExportReports: true,
			PermissionManageUsers: false,
			PermissionViewTrainingCompletion: true,
		},
	}

	for r, checks := range permissionTests {
		// Create the user with the provided role
		role, err := GetRoleBySlug(r)
		c.Assert(err, check.Equals, nil)
		user := User{
			Username: fmt.Sprintf("test-%s", r),
			Hash:     "12345",
			ApiKey:   fmt.Sprintf("%s-key", r),
			RoleID:   role.ID,
		}
		PutUser(&user)

		// Perform the permission checks
		for permission, expected := range checks {
			access, err := user.HasPermission(permission)
			fmt.Printf("Checking %s -> %s\n", r, permission)
			c.Assert(err, check.Equals, nil)
			c.Assert(access, check.Equals, expected)
		}
	}
}

func (s *ModelsSuite) TestGetRoleBySlug(c *check.C) {
	roles := []string{
		RoleAdmin,
		RoleUser,
		RoleSecurityManager,
		RoleCampaignCreator,
		RoleApprover,
		RoleReporter,
		RoleDepartmentManager,
		RoleAuditor,
	}
	for _, role := range roles {
		got, err := GetRoleBySlug(role)
		c.Assert(err, check.Equals, nil)
		c.Assert(got.Slug, check.Equals, role)
	}
	_, err := GetRoleBySlug("bogus")
	c.Assert(err, check.NotNil)
}

func (s *ModelsSuite) TestPermissionHelpers(c *check.C) {
	role, err := GetRoleBySlug(RoleSecurityManager)
	c.Assert(err, check.Equals, nil)
	user := User{
		Username: "test-permission-helpers",
		Hash:     "12345",
		ApiKey:   "permission-helpers-key",
		RoleID:   role.ID,
	}
	c.Assert(PutUser(&user), check.Equals, nil)

	access, err := user.HasAnyPermission(PermissionManageUsers, PermissionManageWebhooks)
	c.Assert(err, check.Equals, nil)
	c.Assert(access, check.Equals, true)

	access, err = user.HasAllPermissions(PermissionManageWebhooks, PermissionApproveCampaign)
	c.Assert(err, check.Equals, nil)
	c.Assert(access, check.Equals, true)

	access, err = user.HasAllPermissions(PermissionManageWebhooks, PermissionManageUsers)
	c.Assert(err, check.Equals, nil)
	c.Assert(access, check.Equals, false)

	slugs, err := user.GetPermissionSlugs()
	c.Assert(err, check.Equals, nil)
	c.Assert(slugs, check.DeepEquals, []string{
		PermissionAssignRemedialTraining,
		PermissionApproveCampaign,
		PermissionCreateCampaignDraft,
		PermissionExportReports,
		PermissionLaunchCampaign,
		PermissionManageLandingPages,
		PermissionManageRecipientGroups,
		PermissionManageRetentionPolicy,
		PermissionManageSendingProfiles,
		PermissionManageTemplates,
		PermissionManageTrainingContent,
		PermissionManageWebhooks,
		PermissionModifyObjects,
		PermissionPauseCompleteCampaign,
		PermissionReviewPublishTrainingContent,
		PermissionViewAuditLogs,
		PermissionViewObjects,
		PermissionViewRecipientPII,
		PermissionViewTrainingCompletion,
	})
}
