package models

import (
	"crypto/rand"
	"encoding/hex"
	"time"
)

const (
	IntegrationTypeWebhook     = "webhook"
	IntegrationTypeSIEM        = "siem"
	IntegrationTypeLMS         = "lms"
	IntegrationTypeIDP         = "idp"
	IntegrationTypeHRDirectory = "hr_directory"
	IntegrationTypeChatOps     = "chatops"

	IntegrationStatusDisabled = "disabled"
	IntegrationStatusEnabled  = "enabled"
	IntegrationStatusError    = "error"

	IntegrationSchemaVersion = "2026-07-08"
)

type EnterpriseIntegration struct {
	Id              int64     `json:"id"`
	Type            string    `json:"type"`
	Name            string    `json:"name"`
	Status          string    `json:"status"`
	ConfigJSON      string    `json:"config_json"`
	SecretReference string    `json:"secret_reference"`
	CreatedBy       int64     `json:"created_by"`
	UpdatedBy       int64     `json:"updated_by"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type WebhookDeliveryLog struct {
	Id            int64     `json:"id"`
	IntegrationId int64     `json:"integration_id"`
	EventType     string    `json:"event_type"`
	EventId       string    `json:"event_id"`
	Status        string    `json:"status"`
	AttemptCount  int       `json:"attempt_count"`
	LastError     string    `json:"last_error"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type IntegrationEventPayload struct {
	SchemaVersion string            `json:"schema_version"`
	EventId       string            `json:"event_id"`
	EventType     string            `json:"event_type"`
	Timestamp     time.Time         `json:"timestamp"`
	CampaignId    int64             `json:"campaign_id,omitempty"`
	RecipientId   string            `json:"recipient_result_id,omitempty"`
	Data          map[string]string `json:"data,omitempty"`
}

func PostEnterpriseIntegration(integration *EnterpriseIntegration) error {
	now := time.Now().UTC()
	if integration.Status == "" {
		integration.Status = IntegrationStatusDisabled
	}
	if integration.CreatedAt.IsZero() {
		integration.CreatedAt = now
	}
	integration.UpdatedAt = now
	return db.Save(integration).Error
}

func GetEnterpriseIntegrations() ([]EnterpriseIntegration, error) {
	integrations := []EnterpriseIntegration{}
	err := db.Order("type asc, name asc").Find(&integrations).Error
	return integrations, err
}

func SanitizeIntegrationForResponse(integration EnterpriseIntegration) EnterpriseIntegration {
	integration.ConfigJSON = ""
	return integration
}

func SanitizeIntegrationsForResponse(integrations []EnterpriseIntegration) []EnterpriseIntegration {
	for i := range integrations {
		integrations[i] = SanitizeIntegrationForResponse(integrations[i])
	}
	return integrations
}

func NewIntegrationEventPayload(eventType string, campaignID int64, recipientID string, data map[string]string) IntegrationEventPayload {
	return IntegrationEventPayload{
		SchemaVersion: IntegrationSchemaVersion,
		EventId:       newIntegrationEventID(),
		EventType:     eventType,
		Timestamp:     time.Now().UTC(),
		CampaignId:    campaignID,
		RecipientId:   recipientID,
		Data:          SanitizeIntegrationData(data),
	}
}

func SanitizeIntegrationData(data map[string]string) map[string]string {
	safe := map[string]string{}
	for key, value := range data {
		if IsSensitiveFieldName(key) {
			continue
		}
		safe[key] = value
	}
	return safe
}

func newIntegrationEventID() string {
	random := make([]byte, 16)
	_, err := rand.Read(random)
	if err != nil {
		return "event"
	}
	return hex.EncodeToString(random)
}
