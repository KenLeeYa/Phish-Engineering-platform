package models

import "time"

const (
	AuditActionCampaignCreated  = "campaign.created"
	AuditActionCampaignDeleted  = "campaign.deleted"
	AuditActionCampaignSubmitted = "campaign.submitted_for_approval"
	AuditActionCampaignApproved = "campaign.approved"
	AuditActionCampaignRejected = "campaign.rejected"
	AuditActionCampaignLaunched = "campaign.launched"
	AuditActionCampaignCompleted = "campaign.completed"
)

// AuditLog records sensitive administrative actions for enterprise review.
type AuditLog struct {
	ID               int64     `json:"id"`
	Timestamp        time.Time `json:"timestamp"`
	ActorUserID      int64     `json:"actor_user_id"`
	ActorRole        string    `json:"actor_role"`
	Action           string    `json:"action"`
	EntityType       string    `json:"entity_type"`
	EntityID         int64     `json:"entity_id"`
	BeforeSummary    string    `json:"before_summary"`
	AfterSummary     string    `json:"after_summary"`
	IPAddress        string    `json:"ip_address"`
	UserAgent        string    `json:"user_agent"`
	RequestID        string    `json:"request_id"`
	HashChainPrevious string    `json:"hash_chain_previous"`
	HashChainCurrent  string    `json:"hash_chain_current"`
}

// InsertAuditLog stores a basic audit event. Hash-chain continuity is reserved
// for a follow-up hardening PR.
func InsertAuditLog(a *AuditLog) error {
	if a.Timestamp.IsZero() {
		a.Timestamp = time.Now().UTC()
	}
	return db.Save(a).Error
}

// GetAuditLogs returns audit records for tests and future audit-log UI/API work.
func GetAuditLogs() ([]AuditLog, error) {
	logs := []AuditLog{}
	err := db.Order("timestamp asc, id asc").Find(&logs).Error
	return logs, err
}
