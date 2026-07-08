package models

import check "gopkg.in/check.v1"

func (s *ModelsSuite) TestPostEnterpriseIntegrationDefaultsAndSanitizes(c *check.C) {
	integration := EnterpriseIntegration{
		Type:            IntegrationTypeSIEM,
		Name:            "SIEM Export",
		ConfigJSON:      `{"endpoint":"https://siem.example.test","api_key":"secret"}`,
		SecretReference: "secret://siem/export",
		CreatedBy:       1,
		UpdatedBy:       1,
	}
	c.Assert(PostEnterpriseIntegration(&integration), check.Equals, nil)
	c.Assert(integration.Id, check.Not(check.Equals), int64(0))
	c.Assert(integration.Status, check.Equals, IntegrationStatusDisabled)

	got, err := GetEnterpriseIntegrations()
	c.Assert(err, check.Equals, nil)
	c.Assert(len(got), check.Equals, 1)
	safe := SanitizeIntegrationForResponse(got[0])
	c.Assert(safe.ConfigJSON, check.Equals, "")
	c.Assert(safe.SecretReference, check.Equals, "secret://siem/export")
}

func (s *ModelsSuite) TestIntegrationPayloadExcludesSensitiveValues(c *check.C) {
	payload := NewIntegrationEventPayload("recipient.submitted_simulated_form", int64(42), "abc123", map[string]string{
		"username": "learner@example.com",
		"password": "not-allowed",
		"otp":      "123456",
		"outcome":  "submitted",
	})
	c.Assert(payload.SchemaVersion, check.Equals, IntegrationSchemaVersion)
	c.Assert(payload.EventType, check.Equals, "recipient.submitted_simulated_form")
	c.Assert(payload.CampaignId, check.Equals, int64(42))
	c.Assert(payload.RecipientId, check.Equals, "abc123")
	c.Assert(payload.Data["username"], check.Equals, "learner@example.com")
	c.Assert(payload.Data["outcome"], check.Equals, "submitted")
	_, ok := payload.Data["password"]
	c.Assert(ok, check.Equals, false)
	_, ok = payload.Data["otp"]
	c.Assert(ok, check.Equals, false)
}
